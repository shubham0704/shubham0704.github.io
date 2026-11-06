"""Public-contract tests for independently calibrated stochastic ports."""

import torch


def test_external_port_adds_declared_drift_and_covariance():
    from models.phast.physics.stochastic import (
        ExternalStochasticPort,
        compose_ito_transition,
    )

    x = torch.tensor([[0.2, -0.4]], dtype=torch.float64)
    base_drift = torch.tensor([[1.0, -2.0]], dtype=torch.float64)
    thermal_diffusion = torch.tensor([[[0.1], [0.3]]], dtype=torch.float64)
    port = ExternalStochasticPort(
        state_map=torch.tensor([[1.0], [2.0]], dtype=torch.float64),
        effort=torch.tensor([0.5], dtype=torch.float64),
        effort_diffusion=torch.tensor([[0.4]], dtype=torch.float64),
    )

    transition = compose_ito_transition(
        x,
        base_drift=base_drift,
        thermal_diffusion=thermal_diffusion,
        external_port=port,
    )

    expected_external_drift = torch.tensor([[0.5, 1.0]], dtype=torch.float64)
    expected_external_diffusion = torch.tensor(
        [[[0.4], [0.8]]], dtype=torch.float64
    )
    expected_diffusion = torch.cat(
        [thermal_diffusion, expected_external_diffusion], dim=-1
    )

    assert torch.equal(transition.external.drift, expected_external_drift)
    assert torch.equal(
        transition.external.diffusion, expected_external_diffusion
    )
    assert torch.equal(transition.drift, base_drift + expected_external_drift)
    assert torch.equal(transition.diffusion, expected_diffusion)
    assert torch.allclose(
        transition.covariance,
        expected_diffusion @ expected_diffusion.transpose(-2, -1),
    )


def test_independent_noise_factors_may_have_different_widths():
    from models.phast.physics.stochastic import (
        ExternalStochasticPort,
        compose_ito_transition,
    )

    x = torch.zeros(3, 2, dtype=torch.float64)
    thermal_diffusion = torch.tensor(
        [[0.1, 0.0], [0.0, 0.2]], dtype=torch.float64
    )
    port = ExternalStochasticPort(
        state_map=torch.eye(2, dtype=torch.float64),
        effort=torch.zeros(2, dtype=torch.float64),
        effort_diffusion=torch.tensor([[0.3], [0.4]], dtype=torch.float64),
    )

    transition = compose_ito_transition(
        x,
        base_drift=torch.zeros_like(x),
        thermal_diffusion=thermal_diffusion,
        external_port=port,
    )

    assert transition.diffusion.shape == (3, 2, 3)
    assert torch.allclose(
        transition.covariance,
        transition.thermal_covariance + transition.external_covariance,
    )


def test_ito_generator_includes_drift_and_curvature_terms():
    from models.phast.physics.stochastic import ItoTransition, ito_generator

    drift = torch.tensor([[0.4, -0.2]], dtype=torch.float64)
    diffusion = torch.tensor([[[0.3, 0.0], [0.1, 0.5]]], dtype=torch.float64)
    covariance = diffusion @ diffusion.transpose(-2, -1)
    transition = ItoTransition(
        drift=drift,
        diffusion=diffusion,
        covariance=covariance,
        thermal_covariance=covariance,
        external_covariance=torch.zeros_like(covariance),
        external=None,
    )
    test_gradient = torch.tensor([[1.2, -0.7]], dtype=torch.float64)
    test_hessian = torch.tensor(
        [[[2.0, 0.4], [0.4, 3.0]]], dtype=torch.float64
    )

    value = ito_generator(
        transition,
        function_gradient=test_gradient,
        function_hessian=test_hessian,
    )
    expected = (drift * test_gradient).sum(-1) + 0.5 * torch.einsum(
        "...ij,...ji->...", covariance, test_hessian
    )

    assert torch.allclose(value, expected)


def test_energy_ledger_separates_thermal_and_external_work():
    from models.phast.physics.stochastic import (
        ExternalStochasticPort,
        energy_ledger_terms,
    )

    x = torch.tensor([[0.2, -0.4]], dtype=torch.float64)
    gradient = torch.tensor([[2.0, -1.0]], dtype=torch.float64)
    hessian = torch.tensor(
        [[[3.0, 0.2], [0.2, 4.0]]], dtype=torch.float64
    )
    dissipation = torch.diag(torch.tensor([0.5, 0.25], dtype=torch.float64))
    control_map = torch.tensor([[0.0], [1.0]], dtype=torch.float64)
    control_effort = torch.tensor([[0.7]], dtype=torch.float64)
    external = ExternalStochasticPort(
        state_map=torch.tensor([[1.0], [0.5]], dtype=torch.float64),
        effort=torch.tensor([0.5], dtype=torch.float64),
        effort_diffusion=torch.tensor([[0.4]], dtype=torch.float64),
    ).evaluate(x)

    ledger = energy_ledger_terms(
        energy_gradient=gradient,
        energy_hessian=hessian,
        dissipation=dissipation,
        temperature=0.3,
        control_input_matrix=control_map,
        control_effort=control_effort,
        external=external,
    )

    expected_dissipation = torch.tensor([2.25], dtype=torch.float64)
    expected_control_work = torch.tensor([-0.7], dtype=torch.float64)
    expected_external_output = torch.tensor([[1.5]], dtype=torch.float64)
    expected_external_work = torch.tensor([0.75], dtype=torch.float64)
    expected_thermal_ito = 0.3 * torch.einsum(
        "ij,bji->b", dissipation, hessian
    )
    expected_external_ito = 0.5 * torch.einsum(
        "bij,bji->b", external.covariance, hessian
    )

    assert torch.allclose(ledger.dissipated_power, expected_dissipation)
    assert torch.allclose(ledger.control_work_rate, expected_control_work)
    assert torch.allclose(ledger.external_output, expected_external_output)
    assert torch.allclose(ledger.external_work_rate, expected_external_work)
    assert torch.allclose(ledger.thermal_ito_rate, expected_thermal_ito)
    assert torch.allclose(ledger.external_ito_rate, expected_external_ito)
    assert torch.allclose(
        ledger.expected_energy_rate,
        expected_control_work
        + expected_external_work
        - expected_dissipation
        + expected_thermal_ito
        + expected_external_ito,
    )
    assert torch.allclose(
        ledger.thermal_variance_rate,
        2.0 * 0.3 * expected_dissipation,
    )
    assert torch.allclose(
        ledger.external_variance_rate,
        torch.tensor([0.36], dtype=torch.float64),
    )
    assert torch.allclose(
        ledger.martingale_variance_rate,
        ledger.thermal_variance_rate + ledger.external_variance_rate,
    )


def test_thermal_only_transition_has_zero_external_attribution():
    from models.phast.physics.stochastic import compose_ito_transition

    x = torch.zeros(4, 2, dtype=torch.float64)
    base_drift = torch.tensor([0.2, -0.1], dtype=torch.float64)
    thermal_diffusion = torch.tensor(
        [[0.3, 0.0], [0.0, 0.4]], dtype=torch.float64
    )

    transition = compose_ito_transition(
        x,
        base_drift=base_drift,
        thermal_diffusion=thermal_diffusion,
    )

    assert transition.external is None
    assert torch.count_nonzero(transition.external_covariance) == 0
    assert torch.equal(transition.drift, base_drift.expand_as(x))
    assert torch.equal(
        transition.covariance, transition.thermal_covariance
    )


def test_euler_maruyama_step_has_correct_dt_scaling():
    from models.phast.physics.stochastic import (
        ItoTransition,
        euler_maruyama_step,
    )

    x = torch.zeros(4, 1, dtype=torch.float64)
    drift = torch.full_like(x, 0.6)
    diffusion = torch.full((4, 1, 1), 0.7, dtype=torch.float64)
    covariance = diffusion @ diffusion.transpose(-2, -1)
    transition = ItoTransition(
        drift=drift,
        diffusion=diffusion,
        covariance=covariance,
        thermal_covariance=covariance,
        external_covariance=torch.zeros_like(covariance),
        external=None,
    )
    noise = torch.tensor([[1.0], [-1.0], [0.5], [-0.5]], dtype=torch.float64)

    short = euler_maruyama_step(x, transition, dt=0.01, noise=noise)
    long = euler_maruyama_step(x, transition, dt=0.04, noise=noise)

    short_random = short - 0.01 * drift
    long_random = long - 0.04 * drift
    assert torch.allclose(long_random, 2.0 * short_random)
    assert torch.allclose(short, 0.01 * drift + 0.7 * 0.1 * noise)


def test_stochastic_contract_is_exported_from_physics_namespace():
    from models.phast.physics import (
        EnergyLedgerTerms,
        ExternalStochasticPort,
        ItoTransition,
        compose_ito_transition,
        energy_ledger_terms,
        euler_maruyama_step,
        ito_generator,
    )

    assert ExternalStochasticPort is not None
    assert EnergyLedgerTerms is not None
    assert ItoTransition is not None
    assert callable(compose_ito_transition)
    assert callable(energy_ledger_terms)
    assert callable(euler_maruyama_step)
    assert callable(ito_generator)


def test_sampled_increment_moments_converge_at_two_step_sizes():
    from models.phast.physics.stochastic import (
        ItoTransition,
        euler_maruyama_step,
    )

    n_samples = 500_000
    drift_rate = 0.8
    variance_rate = 0.36
    x = torch.zeros(n_samples, 1, dtype=torch.float64)
    drift = torch.full_like(x, drift_rate)
    diffusion = torch.full(
        (n_samples, 1, 1), variance_rate**0.5, dtype=torch.float64
    )
    covariance = diffusion @ diffusion.transpose(-2, -1)
    transition = ItoTransition(
        drift=drift,
        diffusion=diffusion,
        covariance=covariance,
        thermal_covariance=covariance,
        external_covariance=torch.zeros_like(covariance),
        external=None,
    )

    for seed, dt in enumerate((0.01, 0.04)):
        generator = torch.Generator().manual_seed(seed)
        increment = euler_maruyama_step(
            x, transition, dt=dt, generator=generator
        )[:, 0]
        drift_standard_error = (variance_rate / (n_samples * dt)) ** 0.5
        variance_standard_error = variance_rate * (2.0 / (n_samples - 1)) ** 0.5
        assert (
            abs(increment.mean().item() / dt - drift_rate)
            < 4.0 * drift_standard_error
        )
        assert (
            abs(increment.var(unbiased=True).item() / dt - variance_rate)
            < 4.0 * variance_standard_error
        )
