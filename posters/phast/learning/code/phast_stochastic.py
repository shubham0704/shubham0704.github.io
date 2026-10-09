"""Stochastic port-Hamiltonian transition and energy-accounting utilities.

The external port in this module is intentionally *calibrated*, not learned
jointly with the PHAST operators.  It keeps environmental drift and diffusion
separate from fluctuation-dissipation noise so experiments can test whether
that distinction is supported by interventions or multiple environments.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Union

import torch
from torch import Tensor


TensorField = Union[Tensor, Callable[[Tensor], Tensor]]


def _evaluate(field: TensorField, x: Tensor, *, name: str) -> Tensor:
    value = field(x) if callable(field) else field
    try:
        return torch.as_tensor(value, dtype=x.dtype, device=x.device)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"{name} must evaluate to a tensor-like value") from exc


def _expand_batch(value: Tensor, batch_shape: torch.Size, event_ndim: int) -> Tensor:
    event_shape = value.shape[-event_ndim:]
    return value.expand(*batch_shape, *event_shape)


@dataclass(frozen=True)
class ExternalPortEvaluation:
    """Environmental terms evaluated at one state or state batch."""

    state_map: Tensor
    effort: Tensor
    effort_diffusion: Tensor
    drift: Tensor
    diffusion: Tensor
    covariance: Tensor


@dataclass(frozen=True)
class ExternalStochasticPort:
    """Known or independently calibrated environmental forcing channel.

    ``state_map`` is :math:`G_e`, ``effort`` is :math:`f_e`, and
    ``effort_diffusion`` is :math:`L_e`.  Each value may be a constant tensor
    or a callable of the current state ``x``.  The induced state-space terms
    are :math:`G_e f_e` and :math:`B_e = G_e L_e`.
    """

    state_map: TensorField
    effort: TensorField
    effort_diffusion: TensorField

    def evaluate(self, x: Tensor) -> ExternalPortEvaluation:
        state_map = _evaluate(self.state_map, x, name="state_map")
        effort = _evaluate(self.effort, x, name="effort")
        effort_diffusion = _evaluate(
            self.effort_diffusion, x, name="effort_diffusion"
        )

        if state_map.ndim < 2:
            raise ValueError("state_map must have shape (..., state_dim, port_dim)")
        if effort.ndim < 1:
            raise ValueError("effort must have shape (..., port_dim)")
        if effort_diffusion.ndim < 2:
            raise ValueError(
                "effort_diffusion must have shape (..., port_dim, noise_dim)"
            )
        if state_map.shape[-2] != x.shape[-1]:
            raise ValueError(
                "state_map state dimension must match the final dimension of x"
            )
        port_dim = state_map.shape[-1]
        if effort.shape[-1] != port_dim:
            raise ValueError("effort port dimension must match state_map")
        if effort_diffusion.shape[-2] != port_dim:
            raise ValueError(
                "effort_diffusion port dimension must match state_map"
            )

        batch_shape = torch.broadcast_shapes(
            x.shape[:-1],
            state_map.shape[:-2],
            effort.shape[:-1],
            effort_diffusion.shape[:-2],
        )
        state_map = _expand_batch(state_map, batch_shape, 2)
        effort = _expand_batch(effort, batch_shape, 1)
        effort_diffusion = _expand_batch(effort_diffusion, batch_shape, 2)

        drift = (state_map @ effort.unsqueeze(-1)).squeeze(-1)
        diffusion = state_map @ effort_diffusion
        covariance = diffusion @ diffusion.transpose(-2, -1)
        return ExternalPortEvaluation(
            state_map=state_map,
            effort=effort,
            effort_diffusion=effort_diffusion,
            drift=drift,
            diffusion=diffusion,
            covariance=covariance,
        )


@dataclass(frozen=True)
class ItoTransition:
    """Drift and factorized covariance of an Itô state transition."""

    drift: Tensor
    diffusion: Tensor
    covariance: Tensor
    thermal_covariance: Tensor
    external_covariance: Tensor
    external: Optional[ExternalPortEvaluation]


@dataclass(frozen=True)
class EnergyLedgerTerms:
    """Named drift and martingale terms in the stochastic energy balance."""

    dissipated_power: Tensor
    control_output: Optional[Tensor]
    control_work_rate: Tensor
    external_output: Optional[Tensor]
    external_work_rate: Tensor
    thermal_ito_rate: Tensor
    external_ito_rate: Tensor
    expected_energy_rate: Tensor
    thermal_variance_rate: Tensor
    external_variance_rate: Tensor
    martingale_variance_rate: Tensor


def _quadratic_form(vector: Tensor, matrix: Tensor) -> Tensor:
    return torch.einsum("...i,...ij,...j->...", vector, matrix, vector)


def _trace_product(left: Tensor, right: Tensor) -> Tensor:
    return torch.einsum("...ij,...ji->...", left, right)


def energy_ledger_terms(
    *,
    energy_gradient: Tensor,
    energy_hessian: Tensor,
    dissipation: Tensor,
    temperature: Union[float, Tensor] = 0.0,
    control_input_matrix: Optional[Tensor] = None,
    control_effort: Optional[Tensor] = None,
    external: Optional[ExternalPortEvaluation] = None,
) -> EnergyLedgerTerms:
    """Evaluate every named term in the Itô energy ledger.

    The thermal channel is assumed to obey
    ``Sigma_thermal Sigma_thermal.T = 2 * temperature * dissipation``.
    The optional external channel is separately calibrated.  This function
    performs accounting only; it does not claim that either decomposition is
    identifiable from trajectories.
    """

    if energy_hessian.shape[-2:] != (
        energy_gradient.shape[-1],
        energy_gradient.shape[-1],
    ):
        raise ValueError("energy_hessian dimensions must match energy_gradient")
    if dissipation.shape[-2:] != energy_hessian.shape[-2:]:
        raise ValueError("dissipation dimensions must match energy_hessian")
    if (control_input_matrix is None) != (control_effort is None):
        raise ValueError(
            "control_input_matrix and control_effort must be supplied together"
        )

    reference = energy_gradient
    energy_hessian = torch.as_tensor(
        energy_hessian, dtype=reference.dtype, device=reference.device
    )
    dissipation = torch.as_tensor(
        dissipation, dtype=reference.dtype, device=reference.device
    )
    temperature = torch.as_tensor(
        temperature, dtype=reference.dtype, device=reference.device
    )

    batch_shapes = [
        energy_gradient.shape[:-1],
        energy_hessian.shape[:-2],
        dissipation.shape[:-2],
        temperature.shape,
    ]
    if control_input_matrix is not None:
        control_input_matrix = torch.as_tensor(
            control_input_matrix, dtype=reference.dtype, device=reference.device
        )
        control_effort = torch.as_tensor(
            control_effort, dtype=reference.dtype, device=reference.device
        )
        batch_shapes.extend(
            [control_input_matrix.shape[:-2], control_effort.shape[:-1]]
        )
    if external is not None:
        batch_shapes.extend(
            [
                external.state_map.shape[:-2],
                external.effort.shape[:-1],
                external.covariance.shape[:-2],
            ]
        )
    batch_shape = torch.broadcast_shapes(*batch_shapes)

    gradient = _expand_batch(energy_gradient, batch_shape, 1)
    hessian = _expand_batch(energy_hessian, batch_shape, 2)
    dissipation = _expand_batch(dissipation, batch_shape, 2)
    temperature = temperature.expand(batch_shape)
    zeros = gradient.new_zeros(batch_shape)

    dissipated_power = _quadratic_form(gradient, dissipation)
    thermal_ito_rate = temperature * _trace_product(dissipation, hessian)
    thermal_variance_rate = 2.0 * temperature * dissipated_power

    control_output = None
    control_work_rate = zeros
    if control_input_matrix is not None:
        control_input_matrix = _expand_batch(
            control_input_matrix, batch_shape, 2
        )
        control_effort = _expand_batch(control_effort, batch_shape, 1)
        control_output = (
            control_input_matrix.transpose(-2, -1)
            @ gradient.unsqueeze(-1)
        ).squeeze(-1)
        control_work_rate = (control_effort * control_output).sum(dim=-1)

    external_output = None
    external_work_rate = zeros
    external_ito_rate = zeros
    external_variance_rate = zeros
    if external is not None:
        state_map = _expand_batch(external.state_map, batch_shape, 2)
        effort = _expand_batch(external.effort, batch_shape, 1)
        covariance = _expand_batch(external.covariance, batch_shape, 2)
        external_output = (
            state_map.transpose(-2, -1) @ gradient.unsqueeze(-1)
        ).squeeze(-1)
        external_work_rate = (effort * external_output).sum(dim=-1)
        external_ito_rate = 0.5 * _trace_product(covariance, hessian)
        external_variance_rate = _quadratic_form(gradient, covariance)

    expected_energy_rate = (
        control_work_rate
        + external_work_rate
        - dissipated_power
        + thermal_ito_rate
        + external_ito_rate
    )
    martingale_variance_rate = (
        thermal_variance_rate + external_variance_rate
    )
    return EnergyLedgerTerms(
        dissipated_power=dissipated_power,
        control_output=control_output,
        control_work_rate=control_work_rate,
        external_output=external_output,
        external_work_rate=external_work_rate,
        thermal_ito_rate=thermal_ito_rate,
        external_ito_rate=external_ito_rate,
        expected_energy_rate=expected_energy_rate,
        thermal_variance_rate=thermal_variance_rate,
        external_variance_rate=external_variance_rate,
        martingale_variance_rate=martingale_variance_rate,
    )


def ito_generator(
    transition: ItoTransition,
    *,
    function_gradient: Tensor,
    function_hessian: Tensor,
) -> Tensor:
    """Evaluate the backward Itô generator on a differentiable scalar.

    For drift ``b`` and covariance ``A = B B.T``, this returns
    ``b.T grad(phi) + 0.5 tr(A Hess(phi))`` at each state in the batch.
    Gradients and Hessians are supplied explicitly so callers may obtain them
    analytically, by autograd, or from a structured PHAST component.
    """

    if function_gradient.shape[-1] != transition.drift.shape[-1]:
        raise ValueError("function_gradient state dimension must match drift")
    if function_hessian.shape[-2:] != transition.covariance.shape[-2:]:
        raise ValueError("function_hessian dimensions must match covariance")
    drift_term = (transition.drift * function_gradient).sum(dim=-1)
    curvature_term = 0.5 * torch.einsum(
        "...ij,...ji->...", transition.covariance, function_hessian
    )
    return drift_term + curvature_term


def compose_ito_transition(
    x: Tensor,
    *,
    base_drift: Tensor,
    thermal_diffusion: Tensor,
    external_port: Optional[ExternalStochasticPort] = None,
) -> ItoTransition:
    """Compose the PHAST/FDT transition with an optional external port.

    ``base_drift`` and ``thermal_diffusion`` retain their original meanings.
    When an external port is supplied, its drift is added and its independent
    diffusion columns are concatenated.  No attribution is inferred here.
    """

    base_drift = torch.as_tensor(base_drift, dtype=x.dtype, device=x.device)
    thermal_diffusion = torch.as_tensor(
        thermal_diffusion, dtype=x.dtype, device=x.device
    )
    if base_drift.shape[-1] != x.shape[-1]:
        raise ValueError("base_drift state dimension must match x")
    if thermal_diffusion.ndim < 2 or thermal_diffusion.shape[-2] != x.shape[-1]:
        raise ValueError(
            "thermal_diffusion must have shape (..., state_dim, noise_dim)"
        )

    external = None if external_port is None else external_port.evaluate(x)
    batch_shapes = [
        x.shape[:-1],
        base_drift.shape[:-1],
        thermal_diffusion.shape[:-2],
    ]
    if external is not None:
        batch_shapes.extend(
            [external.drift.shape[:-1], external.diffusion.shape[:-2]]
        )
    batch_shape = torch.broadcast_shapes(*batch_shapes)
    base_drift = _expand_batch(base_drift, batch_shape, 1)
    thermal_diffusion = _expand_batch(thermal_diffusion, batch_shape, 2)
    thermal_covariance = thermal_diffusion @ thermal_diffusion.transpose(-2, -1)
    if external_port is None:
        drift = base_drift
        diffusion = thermal_diffusion
        external_covariance = torch.zeros_like(thermal_covariance)
    else:
        external_drift = _expand_batch(external.drift, batch_shape, 1)
        external_diffusion = _expand_batch(external.diffusion, batch_shape, 2)
        drift = base_drift + external_drift
        diffusion = torch.cat([thermal_diffusion, external_diffusion], dim=-1)
        external_covariance = (
            external_diffusion @ external_diffusion.transpose(-2, -1)
        )

    covariance = diffusion @ diffusion.transpose(-2, -1)
    return ItoTransition(
        drift=drift,
        diffusion=diffusion,
        covariance=covariance,
        thermal_covariance=thermal_covariance,
        external_covariance=external_covariance,
        external=external,
    )


def euler_maruyama_step(
    x: Tensor,
    transition: ItoTransition,
    *,
    dt: Union[float, Tensor],
    noise: Optional[Tensor] = None,
    generator: Optional[torch.Generator] = None,
) -> Tensor:
    """Advance one Itô step using a factorized transition covariance.

    Supplying ``noise`` makes the Brownian increment reproducible in tests and
    paired experiments.  Otherwise standard normal noise is drawn with the
    optional ``generator``.  The random increment scales as ``sqrt(dt)``.
    """

    dt_tensor = torch.as_tensor(dt, dtype=x.dtype, device=x.device)
    if torch.any(dt_tensor < 0):
        raise ValueError("dt must be non-negative")
    while dt_tensor.ndim < x.ndim:
        dt_tensor = dt_tensor.unsqueeze(-1)

    noise_shape = transition.diffusion.shape[:-2] + (
        transition.diffusion.shape[-1],
    )
    if noise is None:
        noise = torch.randn(
            noise_shape,
            dtype=x.dtype,
            device=x.device,
            generator=generator,
        )
    else:
        noise = torch.as_tensor(noise, dtype=x.dtype, device=x.device)
        if noise.shape != noise_shape:
            raise ValueError(
                f"noise must have shape {noise_shape}, got {tuple(noise.shape)}"
            )

    random_increment = (
        transition.diffusion @ noise.unsqueeze(-1)
    ).squeeze(-1)
    return x + dt_tensor * transition.drift + torch.sqrt(dt_tensor) * random_increment


__all__ = [
    "ExternalPortEvaluation",
    "ExternalStochasticPort",
    "EnergyLedgerTerms",
    "ItoTransition",
    "compose_ito_transition",
    "energy_ledger_terms",
    "euler_maruyama_step",
    "ito_generator",
]
