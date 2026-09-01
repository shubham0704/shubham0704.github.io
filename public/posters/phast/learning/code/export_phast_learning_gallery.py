#!/usr/bin/env python3
"""Export PHAST comparison evidence as portable website data.

This script does not retrain or alter paper results. It loads the exact frozen
checkpoints from the reviewer study, regenerates the fixed test split, selects
the median PHAST seed-42 trajectory, and exports matched open-loop rollouts.
It also records the broader submitted sequence-model results and the method
capabilities summarized in Table 2 of the arXiv manuscript.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import fmean, pstdev
from typing import Any

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUN_ROOT = REPO_ROOT / "results" / "reviewer_studies" / "full" / "structured"
DEFAULT_SEQUENCE_ROOT = REPO_ROOT / "results" / "reviewer_studies" / "full" / "convergence"
DEFAULT_OUTPUT = REPO_ROOT / "results" / "phast_learning_gallery" / "comparison.json"
HORIZON = 100
CONTEXT = 10
MODEL_NAMES = (
    "phast_unknown_qonly",
    "hnn_observer_qonly",
    "phnn_observer_qonly",
)
MODEL_LABELS = {
    "phast_unknown_qonly": "PHAST-UNKNOWN",
    "hnn_observer_qonly": "HNN + matched observer",
    "phnn_observer_qonly": "pHNN + matched observer",
    "s5": "S5",
    "linoss": "LinOSS",
    "dlinoss": "D-LinOSS",
    "vpt": "VPT",
}
SEQUENCE_MODELS = ("s5", "linoss", "dlinoss", "vpt")

TABLE2_METHODS = (
    {
        "method": "HNN",
        "loss_channel": "None",
        "storage_law": "Conservation",
        "damping_spectrum": "No",
        "rollout_primitive": "Direct vector field",
        "evidence": "matched animation + theorem",
        "note": "Animated with the matched FD-TCN observer under the strict q-only contract.",
    },
    {
        "method": "LNN",
        "loss_channel": "None",
        "storage_law": "Conservation",
        "damping_spectrum": "No",
        "rollout_primitive": "Hessian solve",
        "evidence": "literature only",
        "note": "Table 2 is a literature comparison; no matched q-only LNN run is reported.",
    },
    {
        "method": "Dissipative SymODEN",
        "loss_channel": "PSD R",
        "storage_law": "Passivity",
        "damping_spectrum": "No",
        "rollout_primitive": "Direct vector field",
        "evidence": "matched pHNN proxy",
        "note": "The animated pHNN observer supplies the closest matched dissipative Hamiltonian comparison, but is not relabeled as SymODEN.",
    },
    {
        "method": "DHNN",
        "loss_channel": "Learned loss",
        "storage_law": "Not certified",
        "damping_spectrum": "No",
        "rollout_primitive": "Direct vector field",
        "evidence": "not matched here",
        "note": "A full-state DHNN diagnostic exists elsewhere; no matched q-only run is claimed here.",
    },
    {
        "method": "SympNets / VPT",
        "loss_channel": "None",
        "storage_law": "Geometric invariant",
        "damping_spectrum": "No",
        "rollout_primitive": "Explicit map",
        "evidence": "matched animation + score",
        "note": "VPT is evaluated under the same q-only contract in the matched animation study and the submitted five-seed score table.",
    },
    {
        "method": "SSMs: S5, LinOSS, D-LinOSS",
        "loss_channel": "Latent / varies",
        "storage_law": "Not physical",
        "damping_spectrum": "No",
        "rollout_primitive": "Linear recurrence",
        "evidence": "matched animation + scores",
        "note": "D-LinOSS exposes latent forgetting, not a PSD damping operator in the physical coordinates. All three SSMs use the matched q-only contract.",
    },
    {
        "method": "PHAST",
        "loss_channel": "PSD D",
        "storage_law": "Passivity",
        "damping_spectrum": "Bounded",
        "rollout_primitive": "Low-rank pH",
        "evidence": "matched + targeted tests",
        "note": "PHAST-UNKNOWN is animated without supplied physical components; separate tests cover spectral control, primitive scaling, and port-based feedback.",
    },
)

MECHANISM_EVIDENCE = (
    {
        "id": "comparison",
        "label": "Compare models",
        "evidence_type": "Matched experiment",
        "title": "Forecast the same held-out trajectory",
        "question": "Which model remains accurate after the position-history window ends?",
        "interpretation": (
            "All seven models receive the same q-history. The synchronized animation and five-seed "
            "scores compare their open-loop predictions directly."
        ),
        "formula_rows": ["observer", "dynamics"],
        "construction": {
            "input": "$q_{t-9:t}$ for every method",
            "intervention": "Change the model family",
            "fixed": "Dataset, burn-in, $H=100$ horizon, optimizer, and seed protocol",
            "readout": "Open-loop position trajectory and wrapped rollout MSE",
        },
        "methods": list((*MODEL_NAMES, *SEQUENCE_MODELS)),
    },
    {
        "id": "dissipation",
        "label": "Represent loss",
        "evidence_type": "Matched family comparison",
        "title": "Remove or restore irreversible loss",
        "question": "What changes when the phase-space model can represent PSD dissipation?",
        "interpretation": (
            "HNN is conservative. The matched pHNN adds a PSD damping channel. PHAST adds typed "
            "potential, mass, and damping channels plus its split transition. This isolates the value "
            "of representing loss at the family level, but it is not a one-switch PHAST ablation."
        ),
        "formula_rows": ["dynamics", "power"],
        "construction": {
            "input": "$q_{t-9:t}$ under the same position-only contract",
            "intervention": "Conservative $R=0$ versus learned PSD $R$",
            "fixed": "Data, training budget, evaluation horizon, and matched HNN/pHNN observer",
            "readout": "Position rollout plus each structured model's dissipated-power signal",
        },
        "methods": list(MODEL_NAMES),
    },
    {
        "id": "passivity",
        "label": "Track energy",
        "evidence_type": "Theorem + trajectory diagnostic",
        "title": "Inspect each model's native energy ledger",
        "question": "Does the learned structured rollout conserve or dissipate its own Hamiltonian?",
        "interpretation": (
            "The continuous-time passivity statement follows from PSD damping. The plotted native "
            "energy is a finite-step diagnostic on one held-out trajectory; it is not a stronger "
            "discrete-time theorem, and raw energy scales are not compared across models."
        ),
        "formula_rows": ["energy", "power"],
        "construction": {
            "input": "The same held-out position history",
            "intervention": r"Inspect the native $H_\theta$ and PSD-loss channel",
            "fixed": "One selected trajectory and each model's frozen parameters",
            "readout": "Normalized $H_t-H_0$ and upward finite-step increments",
        },
        "methods": list(MODEL_NAMES),
    },
    {
        "id": "spectral",
        "label": "Bound damping",
        "evidence_type": "Targeted ablation",
        "title": "Constrain which modes can absorb error",
        "question": "Does an ordered, anchored damping spectrum improve physical attribution?",
        "interpretation": (
            "On the modal-damped LJ-3 benchmark, adding the PSD/modal anchor and dissipated-power "
            "loss reduces both rollout error and modal-power error. The gallery checkpoint itself is "
            "unbounded, so these numbers are shown separately rather than attached to its animation."
        ),
        "formula_rows": ["dynamics", "power"],
        "construction": {
            "input": "Modal-damped LJ-3 position histories",
            "intervention": r"Change the parameterization and anchoring of $D_\theta$",
            "fixed": "The q-only benchmark and evaluation metrics",
            "readout": "Rollout error and modal dissipated-power error",
        },
        "methods": ["phast_unknown_qonly"],
        "result": {
            "benchmark": "Modal-damped LJ-3, q-only",
            "rows": [
                {
                    "label": "Bounded non-orthogonal",
                    "rollout": 7.39e-5,
                    "power_mse": 6.50e-2,
                },
                {
                    "label": "Ordered + PSD init. + power loss",
                    "rollout": 2.31e-5,
                    "power_mse": 1.32e-4,
                },
            ],
            "rollout_improvement": 3.2,
            "power_improvement": 492.0,
        },
    },
    {
        "id": "ports",
        "label": "Use the port",
        "evidence_type": "Closed-loop experiment",
        "title": "Use the learned Hamiltonian in feedback",
        "question": "Is PHAST's exposed port output accurate enough for passivity-based control?",
        "interpretation": (
            "In the separate Energy-Casimir pendulum study with q and p observed, the controller "
            "changes only how velocity is obtained. The PHAST port output reaches the same success "
            "rate as oracle velocity with lower mean control effort."
        ),
        "formula_rows": ["dynamics", "power"],
        "construction": {
            "input": "Observed $(q,p)$ on the controlled pendulum",
            "intervention": r"Oracle velocity versus $y^{\mathrm{port}}=\partial\hat H/\partial p$",
            "fixed": "Energy-Casimir controller, gains, initial-condition regimes, and 100 trials",
            "readout": "Stabilization success and control effort",
        },
        "methods": ["phast_unknown_qonly"],
        "result": {
            "benchmark": "Energy-Casimir pendulum, 100 trials",
            "rows": [
                {"label": "Oracle velocity", "success": 1.0, "effort": 262.9},
                {"label": "PHAST port output", "success": 1.0, "effort": 245.0},
            ],
        },
    },
    {
        "id": "efficiency",
        "label": "Scale primitives",
        "evidence_type": "CPU primitive benchmark",
        "title": "Exploit low-rank physical operators",
        "question": "Do PHAST's structured damping and mass operations scale as intended?",
        "interpretation": (
            "The paper benchmarks Householder damping application and Woodbury mass solves and "
            "observes near-linear CPU scaling in dimension at fixed rank r=2. This is a primitive "
            "microbenchmark, not an end-to-end runtime comparison against the animated baselines."
        ),
        "formula_rows": ["energy", "dynamics"],
        "construction": {
            "input": "Vectors of increasing dimension $n$ at fixed rank $r=2$",
            "intervention": "Increase physical-state dimension",
            "fixed": "CPU implementation and low-rank operator rank",
            "readout": "Wall-clock time per damping application and mass solve",
        },
        "methods": ["phast_unknown_qonly"],
    },
)

# Submitted broad-comparison results: 50 epochs, five model seeds, data seed 42.
# These values are copied from appendix_tables_qonly.tex and deliberately kept
# separate from the 100-epoch frozen-checkpoint comparison used for animation.
SUBMITTED_RESULTS = {
    "windy_pendulum_qonly": (
        ("PHAST (best contract)", 0.092, 0.014, 13736, "PARTIAL"),
        ("GRU", 1.796, 0.625, 37889, "q-history"),
        ("S5", 0.600, 0.047, 17089, "q-history"),
        ("LinOSS", 1.458, 0.324, 17089, "q-history"),
        ("D-LinOSS", 0.435, 0.239, 33793, "q-history"),
        ("Transformer", 0.824, 0.134, 100161, "q-history"),
        ("VPT", 2.218, 0.135, 16833, "q-history"),
    ),
    "damped_double_pendulum_qonly": (
        ("PHAST (best contract)", 0.320, 0.032, 12166, "PARTIAL"),
        ("GRU", 1.346, 0.127, 38146, "q-history"),
        ("S5", 0.630, 0.031, 17218, "q-history"),
        ("LinOSS", 1.573, 0.129, 17218, "q-history"),
        ("D-LinOSS", 1.298, 0.105, 33922, "q-history"),
        ("Transformer", 0.846, 0.132, 100290, "q-history"),
        ("VPT", 2.721, 0.156, 16962, "q-history"),
    ),
    "windy_cartpole_qonly": (
        ("PHAST (best contract)", 0.063, 0.019, 3589, "KNOWN"),
        ("S5", 0.431, 0.077, 17218, "q-history"),
    ),
}
SYSTEMS = (
    {
        "env": "windy_pendulum_qonly",
        "label": "Windy pendulum",
        "scene": "pendulum",
        "periodic": (0,),
        "metric": "rollout_theta_wrap_mse_h100",
        "claim": "Position-dependent dissipation",
        "question": "Can the learned dynamics reproduce contraction when damping changes with angle?",
    },
    {
        "env": "damped_double_pendulum_qonly",
        "label": "Damped double pendulum",
        "scene": "double-pendulum",
        "periodic": (0, 1),
        "metric": "rollout_theta_wrap_mse_h100",
        "claim": "Coupled nonlinear motion",
        "question": "Can a position-only model preserve coupled motion while accounting for irreversible loss?",
    },
    {
        "env": "windy_cartpole_qonly",
        "label": "Windy cart-pole",
        "scene": "cart-pole",
        "periodic": (1,),
        "metric": "rollout_mixed_mse_h100",
        "claim": "Mixed coordinate topology",
        "question": "Can one rollout remain stable across a Euclidean cart coordinate and a periodic pole angle?",
    },
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _json_dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _run_dir(root: Path, env_name: str, model_name: str) -> Path:
    stem = f"{env_name}__{model_name}__e100"
    direct = root / stem
    if direct.is_dir():
        return direct
    candidates = sorted(path for path in root.glob(f"{stem}__*") if path.is_dir())
    if len(candidates) != 1:
        raise FileNotFoundError(f"Expected one run for {stem}; found {[path.name for path in candidates]}")
    return candidates[0]


def _load_model(run_dir: Path, model_name: str, *, env_name: str, state_dim: int, seed: int) -> torch.nn.Module:
    from phast.benchmarks import get_model

    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    checkpoint = run_dir / "checkpoints" / f"{model_name}_seed{seed}.pt"
    payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model = get_model(model_name).creator(
        env_name=env_name,
        state_dim=state_dim,
        action_dim=None,
        hidden_dim=int(config["hidden_dim"]),
        n_layers=int(config["n_layers"]),
        mass_mode=str(config.get("mass_mode", "auto")),
    )
    incompatible = model.load_state_dict(payload["model_state_dict"], strict=False)
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise RuntimeError(
            f"Checkpoint mismatch for {checkpoint}: missing={incompatible.missing_keys}, "
            f"unexpected={incompatible.unexpected_keys}"
        )
    model.eval()
    return model


def _test_split(run_dir: Path, *, env_name: str) -> dict[str, Any]:
    from phast.benchmarks import get_env, rollout_legacy

    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    torch.manual_seed(int(config["data_seed"]))
    np.random.seed(int(config["data_seed"]))
    _, _, test = rollout_legacy(
        get_env(env_name),
        device="cpu",
        n_train=int(config["n_train"]),
        n_val=int(config["n_val"]),
        n_test=int(config["n_test"]),
        seq_len=int(config["seq_len"]),
    )
    return test


def _wrapped_error(pred: torch.Tensor, truth: torch.Tensor, periodic: tuple[int, ...]) -> torch.Tensor:
    error = pred - truth
    if periodic:
        error = error.clone()
        indices = list(periodic)
        error[..., indices] = torch.atan2(torch.sin(error[..., indices]), torch.cos(error[..., indices]))
    return error


def _aggregate(run_dir: Path, model_name: str, metric: str) -> dict[str, Any]:
    payload = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    rows = payload[model_name]
    values = [float(row["test_metrics"][metric]) for row in rows]
    histories = []
    for row in rows:
        histories.append([
            {
                "epoch": int(item["epoch"]) + 1,
                "train": float(item["train_loss"]),
                "validation": None if item["val_loss"] is None else float(item["val_loss"]),
            }
            for item in row.get("training_history", [])
        ])
    checkpoint = run_dir / "checkpoints" / f"{model_name}_seed42.pt"
    return {
        "mean": fmean(values),
        "std": pstdev(values),
        "n": len(values),
        "values": values,
        "parameter_count": int(rows[0]["n_params"]),
        "training_seconds_mean": fmean(float(row["training_seconds"]) for row in rows),
        "training_history_seed42": histories[0] if histories else [],
        "checkpoint": str(checkpoint.relative_to(REPO_ROOT)),
        "checkpoint_sha256": _sha256(checkpoint),
    }


def _native_rollout(model: torch.nn.Module, context: torch.Tensor, horizon: int) -> torch.Tensor | None:
    rollout_state = getattr(model, "rollout_state_from_context", None)
    if not callable(rollout_state):
        return None
    with torch.no_grad():
        return rollout_state(context, n_steps=horizon)


def _native_energy(model: torch.nn.Module, state: torch.Tensor | None) -> list[float] | None:
    if state is None:
        return None
    n_dof = state.shape[-1] // 2
    flat = state.reshape(-1, 2 * n_dof)
    try:
        if hasattr(model, "core") and hasattr(model.core, "H"):
            q, p = flat.split(n_dof, dim=-1)
            energy = model.core.H.energy(q, p)
        elif hasattr(model, "transition") and model.transition.hamiltonian_net is not None:
            energy = model.transition.hamiltonian_net(model.transition.features(flat)).squeeze(-1)
        else:
            return None
    except (AttributeError, RuntimeError, TypeError):
        return None
    values = energy.detach().reshape(state.shape[0], state.shape[1])[0]
    values = values - values[0]
    scale = values.abs().max().clamp_min(1e-8)
    return (values / scale).cpu().tolist()


def _native_mechanism_diagnostics(
    model: torch.nn.Module,
    state: torch.Tensor | None,
) -> dict[str, list[float] | int | None]:
    """Export model-native damping diagnostics without comparing energy gauges."""
    empty: dict[str, list[float] | int | None] = {
        "dissipation_power": None,
        "damping_lambda_max": None,
        "energy_increase_steps": None,
    }
    if state is None:
        return empty

    energy = _native_energy(model, state)
    if energy is not None:
        empty["energy_increase_steps"] = sum(
            float(current) > float(previous) + 1e-6
            for previous, current in zip(energy, energy[1:])
        )

    n_dof = state.shape[-1] // 2
    flat = state.reshape(-1, 2 * n_dof)
    q, p = flat.split(n_dof, dim=-1)
    try:
        if hasattr(model, "core") and getattr(model.core, "damping", None) is not None:
            velocity = model.core.H.grad_p(q, p)
            damping = model.core.damping(q)
        elif (
            hasattr(model, "transition")
            and getattr(model.transition, "damping_net", None) is not None
        ):
            gradient = model.transition._hamiltonian_gradient(flat)
            velocity = gradient[..., n_dof:]
            damping = model.transition.damping_matrix(flat)
        else:
            return empty
        expected = velocity.shape[0] * n_dof * n_dof
        if damping.numel() == n_dof * n_dof:
            damping = damping.reshape(1, n_dof, n_dof).expand(velocity.shape[0], -1, -1)
        elif damping.numel() == expected:
            damping = damping.reshape(velocity.shape[0], n_dof, n_dof)
        elif damping.numel() == velocity.shape[0] * n_dof:
            damping = torch.diag_embed(damping.reshape(velocity.shape[0], n_dof))
        elif damping.numel() == velocity.shape[0]:
            scalar = damping.reshape(velocity.shape[0], 1, 1)
            eye = torch.eye(n_dof, device=damping.device, dtype=damping.dtype)
            damping = scalar * eye
        else:
            return empty
        power = torch.einsum("bi,bij,bj->b", velocity, damping, velocity)
        lambda_max = torch.linalg.eigvalsh(damping).amax(dim=-1)
        shape = (state.shape[0], state.shape[1])
        empty["dissipation_power"] = power.detach().reshape(shape)[0].cpu().tolist()
        empty["damping_lambda_max"] = lambda_max.detach().reshape(shape)[0].cpu().tolist()
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return empty
    return empty


def _median_index(model: torch.nn.Module, states: torch.Tensor, periodic: tuple[int, ...]) -> int:
    from benchmarks_core.metrics import autoregressive_rollout

    context = states[:, :CONTEXT]
    truth = states[:, CONTEXT : CONTEXT + HORIZON]
    with torch.no_grad():
        prediction = autoregressive_rollout(model, context, n_steps=HORIZON)
    per_trajectory = _wrapped_error(prediction, truth, periodic).square().mean(dim=(1, 2))
    order = torch.argsort(per_trajectory)
    return int(order[len(order) // 2])


def export(run_root: Path, sequence_root: Path, *, seed: int) -> dict[str, Any]:
    from benchmarks_core.metrics import autoregressive_rollout

    systems = []
    for spec in SYSTEMS:
        env_name = str(spec["env"])
        phast_dir = _run_dir(run_root, env_name, MODEL_NAMES[0])
        test = _test_split(phast_dir, env_name=env_name)
        states = test["states"].detach().cpu()
        state_dim = int(states.shape[-1])
        loaded: dict[str, tuple[torch.nn.Module, Path, str]] = {
            name: _load_model(_run_dir(run_root, env_name, name), name, env_name=env_name, state_dim=state_dim, seed=seed)
            for name in MODEL_NAMES
        }
        loaded = {
            name: (model, _run_dir(run_root, env_name, name), "matched structured, 100 epochs")
            for name, model in loaded.items()
        }
        for name in SEQUENCE_MODELS:
            sequence_dir = _run_dir(sequence_root, env_name, name)
            loaded[name] = (
                _load_model(sequence_dir, name, env_name=env_name, state_dim=state_dim, seed=seed),
                sequence_dir,
                "matched sequence, 100 epochs",
            )
        trajectory_index = _median_index(loaded[MODEL_NAMES[0]][0], states, tuple(spec["periodic"]))
        context = states[trajectory_index : trajectory_index + 1, :CONTEXT]
        truth = states[trajectory_index, CONTEXT : CONTEXT + HORIZON]
        methods = []
        for model_name, (model, run_dir, study_label) in loaded.items():
            with torch.no_grad():
                prediction = autoregressive_rollout(model, context, n_steps=HORIZON)
            native_state = _native_rollout(model, context, HORIZON)
            mechanism_diagnostics = _native_mechanism_diagnostics(model, native_state)
            error_by_step = _wrapped_error(prediction[0], truth, tuple(spec["periodic"])).square().mean(dim=-1)
            methods.append({
                "id": model_name,
                "label": MODEL_LABELS[model_name],
                "prediction": prediction[0].cpu().tolist(),
                "latent_state": None if native_state is None else native_state[0].cpu().tolist(),
                "native_energy_change_normalized": _native_energy(model, native_state),
                "native_dissipation_power": mechanism_diagnostics["dissipation_power"],
                "native_damping_lambda_max": mechanism_diagnostics["damping_lambda_max"],
                "native_energy_increase_steps": mechanism_diagnostics["energy_increase_steps"],
                "error_by_step": error_by_step.cpu().tolist(),
                "aggregate": _aggregate(run_dir, model_name, str(spec["metric"])),
                "study": study_label,
                "native_channels": {
                    "hamiltonian": model_name in {
                        "phast_unknown_qonly",
                        "hnn_observer_qonly",
                        "phnn_observer_qonly",
                    },
                    "psd_damping": model_name in {"phast_unknown_qonly", "phnn_observer_qonly"},
                    "typed_mass_potential_damping": model_name == "phast_unknown_qonly",
                },
            })
        systems.append({
            **spec,
            "periodic": list(spec["periodic"]),
            "trajectory_index": trajectory_index,
            "selection": "Median PHAST seed-42 trajectory by H=100 wrapped rollout MSE",
            "dt": float(test.get("dt", 1.0)),
            "context": context[0].tolist(),
            "truth": truth.tolist(),
            "truth_momenta": test.get("momenta", torch.empty(0))[trajectory_index, CONTEXT : CONTEXT + HORIZON].tolist()
            if isinstance(test.get("momenta"), torch.Tensor) else None,
            "truth_energy": test.get("energies", torch.empty(0))[trajectory_index, CONTEXT : CONTEXT + HORIZON].tolist()
            if isinstance(test.get("energies"), torch.Tensor) else None,
            "methods": methods,
            "submitted_results": [
                {
                    "label": label,
                    "mean": mean,
                    "std": std,
                    "parameter_count": params,
                    "contract": contract,
                }
                for label, mean, std, params, contract in SUBMITTED_RESULTS[env_name]
            ],
        })
    return {
        "schema_version": 3,
        "title": "How PHAST learns dissipative dynamics from position history",
        "information_contract": (
            "Every model receives the same K=10 position history and coordinate-domain chart. "
            "No model receives velocity, momentum, simulator phase state, or supplied V/M/D/G components."
        ),
        "evaluation": "H=100 open-loop rollout; dataset seed 42; five model seeds; illustrative trajectory uses model seed 42.",
        "models": [{"id": name, "label": MODEL_LABELS[name]} for name in (*MODEL_NAMES, *SEQUENCE_MODELS)],
        "table2_methods": list(TABLE2_METHODS),
        "mechanism_evidence": list(MECHANISM_EVIDENCE),
        "comparison_note": (
            "This is an architectural taxonomy, not a matched result table. Conservation for HNN/LNN is not "
            "input-output port passivity; D-LinOSS forgetting is not a PSD damping operator in physical coordinates; "
            "and the rollout-primitive column is not an end-to-end speed ranking. The experiments below test the "
            "claims under explicit information contracts."
        ),
        "systems": systems,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, default=DEFAULT_RUN_ROOT)
    parser.add_argument("--sequence-root", type=Path, default=DEFAULT_SEQUENCE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = export(args.run_root.resolve(), args.sequence_root.resolve(), seed=int(args.seed))
    _json_dump(args.output.resolve(), payload)
    print(f"Wrote {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
