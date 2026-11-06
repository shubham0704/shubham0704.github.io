#!/usr/bin/env python3
"""Evaluate q-only PHAST forecast calibration under FDT process noise.

The study starts from frozen bounded PHAST-PARTIAL checkpoints.  It does not
fit a stochastic source decomposition.  Instead, it asks a narrower question:
does attaching an independently calibrated FDT channel to the learned PHAST
transition produce useful predictive sets under noisy position histories?

Every stochastic PHAST step preserves the learned deterministic map exactly
and adds the thermal increment through ``models.phast.physics``.  The oracle
uses the same stochastic API with the analytic pendulum map and true damping.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess
from typing import Any, Callable, Iterable, Mapping, Optional

import numpy as np
import torch
from torch import Tensor

from models.phast.physics import compose_ito_transition, euler_maruyama_step
from phast.estimation import AnalyticPHCore, calibrate_observer_jitter
from phast.estimation.learned_core import LearnedPHCore


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = (
    REPO_ROOT / "configs" / "experiments" / "phast_stochastic_calibration.json"
)
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "results" / "stochastic_calibration"
METHODS = ("point", "initial_state", "fdt", "oracle")


@dataclass(frozen=True)
class Condition:
    temperature: float
    observation_noise: float
    excitation: str

    @property
    def id(self) -> str:
        theta = f"{self.temperature:g}".replace(".", "p")
        sigma = f"{self.observation_noise:g}".replace(".", "p")
        return f"theta{theta}__sigma{sigma}__{self.excitation}"


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    return json.loads(path.read_text())


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_revision() -> Optional[str]:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _wrap(angle: Tensor) -> Tensor:
    return torch.remainder(angle + torch.pi, 2.0 * torch.pi) - torch.pi


def _condition_seed(base: int, condition: Condition, offset: int = 0) -> int:
    token = f"{condition.id}:{offset}".encode("utf-8")
    suffix = int(hashlib.sha256(token).hexdigest()[:8], 16)
    return int(base) + suffix % 1_000_000


def conditions(profile: Mapping[str, Any]) -> list[Condition]:
    return [
        Condition(float(theta), float(sigma), str(excitation))
        for excitation in profile["excitations"]
        for theta in profile["process_temperatures"]
        for sigma in profile["observation_noise"]
    ]


def _excitation_parameters(name: str) -> tuple[tuple[float, float], float]:
    if name == "narrow":
        return (-0.6, 0.6), 0.35
    if name == "broad":
        return (-2.5, 2.5), 4.0
    raise ValueError(f"Unknown excitation {name!r}; expected 'narrow' or 'broad'.")


def generate_qonly_case(
    condition: Condition,
    *,
    n_trajectories: int,
    context: int,
    max_horizon: int,
    seed: int,
    dt: float,
    damping_base: float,
    damping_amplitude: float,
) -> tuple[Tensor, Tensor]:
    """Return true states and a noisy q-only context under a fixed seed."""

    theta_range, momentum_scale = _excitation_parameters(condition.excitation)
    rng = np.random.default_rng(seed)
    q0 = torch.tensor(
        rng.uniform(*theta_range, size=n_trajectories), dtype=torch.float32
    )
    p0 = torch.tensor(
        rng.normal(0.0, momentum_scale, size=n_trajectories), dtype=torch.float32
    )
    plant = AnalyticPHCore(
        dt=dt,
        damping_type="windy",
        b_base=damping_base,
        b_amplitude=damping_amplitude,
        Theta=condition.temperature,
    )
    states = [torch.stack([q0, p0], dim=-1)]
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(seed + 1)
        q, p = q0, p0
        for _ in range(context + max_horizon - 1):
            q, p = plant.step(q, p)
            states.append(torch.stack([q, p], dim=-1))
        true_states = torch.stack(states, dim=1)
        q_context = true_states[:, :context, :1].clone()
        if condition.observation_noise > 0:
            q_context += condition.observation_noise * torch.randn_like(q_context)
    return true_states, q_context


def _thermal_split_step(
    x: Tensor,
    *,
    deterministic_step: Callable[[Tensor], Tensor],
    damping: Callable[[Tensor], Tensor],
    temperature: float,
    dt: float,
    generator: torch.Generator,
) -> Tensor:
    """Apply the deterministic map, then one package-level FDT increment."""

    deterministic_next = deterministic_step(x)
    d_value = torch.clamp(damping(deterministic_next[..., 0]), min=0.0)
    thermal_diffusion = x.new_zeros(*x.shape[:-1], 2, 1)
    thermal_diffusion[..., 1, 0] = torch.sqrt(2.0 * temperature * d_value)
    transition = compose_ito_transition(
        x,
        base_drift=(deterministic_next - x) / dt,
        thermal_diffusion=thermal_diffusion,
    )
    return euler_maruyama_step(x, transition, dt=dt, generator=generator)


def _circular_summary(
    samples: Tensor,
    truth: Tensor,
    *,
    coverage_levels: Iterable[float],
    energy_score_pairings: int,
) -> dict[str, Any]:
    """Shortest circular predictive arcs and a Monte Carlo energy score."""

    if samples.ndim != 2 or truth.ndim != 1 or samples.shape[0] != truth.shape[0]:
        raise ValueError("samples must be (B,P) and truth must be (B,)")
    center = torch.atan2(torch.sin(samples).mean(1), torch.cos(samples).mean(1))
    coverages: dict[str, float] = {}
    widths: dict[str, float] = {}
    arc_centers: dict[str, Tensor] = {}
    half_widths: dict[str, Tensor] = {}
    wrapped_samples = torch.remainder(samples, 2.0 * torch.pi)
    ordered, _ = torch.sort(wrapped_samples, dim=1)
    extended = torch.cat([ordered, ordered + 2.0 * torch.pi], dim=1)
    truth_wrapped = torch.remainder(truth, 2.0 * torch.pi)
    particles = samples.shape[1]
    for level in coverage_levels:
        key = f"{float(level):g}"
        count = max(1, min(particles, int(math.ceil(float(level) * particles))))
        candidate_widths = extended[:, count - 1 : count - 1 + particles] - ordered
        best = candidate_widths.argmin(dim=1)
        start = ordered.gather(1, best[:, None]).squeeze(1)
        arc_width = candidate_widths.gather(1, best[:, None]).squeeze(1)
        relative_truth = torch.remainder(truth_wrapped - start, 2.0 * torch.pi)
        half_width = 0.5 * arc_width
        arc_centers[key] = _wrap(start + half_width)
        half_widths[key] = half_width
        coverages[key] = float((relative_truth <= arc_width + 1e-7).float().mean())
        widths[key] = float(arc_width.mean())

    truth_distance = torch.sqrt(
        torch.clamp(2.0 - 2.0 * torch.cos(samples - truth[:, None]), min=0.0)
    ).mean()
    pair_distance = samples.new_zeros(())
    if particles > 1:
        pairings = max(1, min(int(energy_score_pairings), particles - 1))
        for shift in range(1, pairings + 1):
            paired = torch.roll(samples, shifts=shift, dims=1)
            pair_distance += torch.sqrt(
                torch.clamp(2.0 - 2.0 * torch.cos(samples - paired), min=0.0)
            ).mean()
        pair_distance /= pairings
    energy_score = truth_distance - 0.5 * pair_distance
    return {
        "point_mse": float((_wrap(center - truth) ** 2).mean()),
        "energy_score": float(energy_score),
        "coverage": coverages,
        "width": widths,
        "center": center,
        "arc_center": arc_centers,
        "half_width": half_widths,
    }


def _checkpoint(config: Mapping[str, Any], seed: int) -> Path:
    return REPO_ROOT / str(config["checkpoint_template"]).format(seed=seed)


def _load_model(config: Mapping[str, Any], seed: int) -> LearnedPHCore:
    path = _checkpoint(config, seed)
    if not path.is_file():
        raise FileNotFoundError(f"Missing frozen PHAST checkpoint: {path}")
    return LearnedPHCore(
        str(path), creator_kwargs=dict(config["creator_kwargs"]), dt=float(config["physics"]["dt"])
    )


def _fan_entry(summary: Mapping[str, Any], truth: Tensor) -> dict[str, Any]:
    return {
        "truth": float(truth[0]),
        "mean": float(summary["center"][0]),
        "bands": {
            key: {
                "center": float(summary["arc_center"][key][0]),
                "half_width": float(value[0]),
            }
            for key, value in summary["half_width"].items()
        },
    }


@torch.no_grad()
def evaluate_condition(
    config: Mapping[str, Any],
    profile: Mapping[str, Any],
    model: LearnedPHCore,
    condition: Condition,
    *,
    model_seed: int,
) -> dict[str, Any]:
    physics = config["physics"]
    dt = float(physics["dt"])
    context = int(profile["context"])
    max_horizon = int(profile["max_horizon"])
    horizons = [int(value) for value in profile["horizons"]]
    data_seed = _condition_seed(int(profile["data_seed"]), condition)
    true_states, q_context = generate_qonly_case(
        condition,
        n_trajectories=int(profile["n_test"]),
        context=context,
        max_horizon=max_horizon,
        seed=data_seed,
        dt=dt,
        damping_base=float(physics["damping_base"]),
        damping_amplitude=float(physics["damping_amplitude"]),
    )

    theta_range, momentum_scale = _excitation_parameters(condition.excitation)
    calibration_plant = AnalyticPHCore(
        dt=dt,
        damping_type="windy",
        b_base=float(physics["damping_base"]),
        b_amplitude=float(physics["damping_amplitude"]),
        Theta=condition.temperature,
    )
    calibration_seed = _condition_seed(
        int(profile["calibration_seed"]), condition
    )
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(calibration_seed + 1)
        jitter = calibrate_observer_jitter(
            model,
            calibration_plant,
            K=context,
            n_samples=int(profile["n_calibration"]),
            theta_range=theta_range,
            p_scale=momentum_scale,
            sigma_q=condition.observation_noise,
            seed=calibration_seed,
        )

    x_hat = model.infer_window(q_context)
    particles = int(profile["particles"])
    particle_seed = _condition_seed(int(profile["particle_seed"]), condition)
    initial_generator = torch.Generator(device="cpu").manual_seed(particle_seed)
    epsilon = torch.randn(
        x_hat.shape[0], particles, x_hat.shape[-1], generator=initial_generator
    )
    initial_particles = x_hat[:, None, :] + epsilon * jitter[None, None, :]
    x_point = x_hat.clone()
    x_initial = initial_particles.clone()
    x_fdt = initial_particles.clone()
    x_oracle = true_states[:, context - 1, :][:, None, :].expand(
        -1, particles, -1
    ).clone()

    learned_generator = torch.Generator(device="cpu").manual_seed(particle_seed + 1)
    oracle_generator = torch.Generator(device="cpu").manual_seed(particle_seed + 2)
    oracle_core = AnalyticPHCore(
        dt=dt,
        damping_type="windy",
        b_base=float(physics["damping_base"]),
        b_amplitude=float(physics["damping_amplitude"]),
        Theta=0.0,
    )

    def model_step(value: Tensor) -> Tensor:
        shape = value.shape
        return model.predict_step(value.reshape(-1, 2)).reshape(shape)

    def oracle_step(value: Tensor) -> Tensor:
        q, p = oracle_core.step(value[..., 0], value[..., 1])
        return torch.stack([q, p], dim=-1)

    def true_damping(q: Tensor) -> Tensor:
        return float(physics["damping_base"]) + float(
            physics["damping_amplitude"]
        ) * torch.abs(torch.sin(q))

    metrics = {method: [] for method in METHODS}
    fan = {method: [] for method in METHODS}
    horizon_set = set(horizons)
    levels = [float(value) for value in config["coverage_levels"]]
    for step in range(1, max_horizon + 1):
        x_point = model.predict_step(x_point)
        x_initial = model_step(x_initial)
        x_fdt = _thermal_split_step(
            x_fdt,
            deterministic_step=model_step,
            damping=model._damping,
            temperature=condition.temperature,
            dt=dt,
            generator=learned_generator,
        )
        x_oracle = _thermal_split_step(
            x_oracle,
            deterministic_step=oracle_step,
            damping=true_damping,
            temperature=condition.temperature,
            dt=dt,
            generator=oracle_generator,
        )
        truth = true_states[:, context - 1 + step, 0]
        samples = {
            "point": x_point[:, 0, None],
            "initial_state": x_initial[..., 0],
            "fdt": x_fdt[..., 0],
            "oracle": x_oracle[..., 0],
        }
        step_summaries = {
            method: _circular_summary(
                values,
                truth,
                coverage_levels=levels,
                energy_score_pairings=int(profile["energy_score_pairings"]),
            )
            for method, values in samples.items()
        }
        for method, summary in step_summaries.items():
            fan[method].append({"horizon": step, **_fan_entry(summary, truth)})
            if step in horizon_set:
                metrics[method].append(
                    {
                        "horizon": step,
                        "point_mse": summary["point_mse"],
                        "energy_score": summary["energy_score"],
                        "coverage": summary["coverage"],
                        "width": summary["width"],
                    }
                )

    return {
        "id": condition.id,
        "process_temperature": condition.temperature,
        "observation_noise": condition.observation_noise,
        "excitation": condition.excitation,
        "data_seed": data_seed,
        "observer_jitter": [float(value) for value in jitter],
        "methods": {
            method: {"metrics": metrics[method], "fan": fan[method]}
            for method in METHODS
        },
    }


def _mean_std(values: Iterable[float]) -> dict[str, float]:
    values = [float(value) for value in values]
    if not values:
        raise ValueError("Cannot aggregate an empty value list")
    return {
        "mean": statistics.fmean(values),
        "std": statistics.stdev(values) if len(values) > 1 else 0.0,
    }


def _aggregate_method(
    per_seed: list[Mapping[str, Any]],
    *,
    levels: list[float],
) -> dict[str, Any]:
    by_horizon = {
        int(row["horizon"]): []
        for row in per_seed[0]["metrics"]
    }
    for seed_method in per_seed:
        for row in seed_method["metrics"]:
            by_horizon[int(row["horizon"])].append(row)
    metrics = []
    for horizon, rows in sorted(by_horizon.items()):
        metrics.append(
            {
                "horizon": horizon,
                "point_mse": _mean_std(row["point_mse"] for row in rows),
                "energy_score": _mean_std(row["energy_score"] for row in rows),
                "coverage": {
                    f"{level:g}": _mean_std(
                        row["coverage"][f"{level:g}"] for row in rows
                    )
                    for level in levels
                },
                "width": {
                    f"{level:g}": _mean_std(
                        row["width"][f"{level:g}"] for row in rows
                    )
                    for level in levels
                },
            }
        )
    return {"metrics": metrics, "fan": per_seed[0]["fan"]}


def _reliability_boundary(
    method: Mapping[str, Any],
    *,
    primary_level: float,
    tolerance: float,
    uninformative_width: float,
) -> dict[str, Optional[int]]:
    key = f"{primary_level:g}"
    calibrated_through = 0
    first_failure: Optional[int] = None
    first_too_wide: Optional[int] = None
    for row in method["metrics"]:
        horizon = int(row["horizon"])
        coverage = float(row["coverage"][key]["mean"])
        width = float(row["width"][key]["mean"])
        if first_too_wide is None and width >= uninformative_width:
            first_too_wide = horizon
        failed = abs(coverage - primary_level) > tolerance or width >= uninformative_width
        if failed and first_failure is None:
            first_failure = horizon
        if first_failure is None:
            calibrated_through = horizon
    return {
        "calibrated_through": calibrated_through,
        "first_failure_horizon": first_failure,
        "first_uninformative_horizon": first_too_wide,
    }


def build_summary(
    config: Mapping[str, Any],
    profile_name: str,
    output_root: Path,
    *,
    config_hash: str,
    script_hash: str,
) -> dict[str, Any]:
    profile = config["profiles"][profile_name]
    expected_seeds = [int(value) for value in profile["model_seeds"]]
    seed_results = []
    for seed in expected_seeds:
        result_path = output_root / profile_name / f"seed{seed}" / "result.json"
        if not result_path.is_file():
            continue
        result = json.loads(result_path.read_text())
        provenance = result.get("provenance", {})
        if provenance.get("config_hash") != config_hash:
            continue
        if provenance.get("script_hash") != script_hash:
            continue
        seed_results.append(result)

    complete = len(seed_results) == len(expected_seeds)
    summary: dict[str, Any] = {
        "study": config["study"],
        "profile": profile_name,
        "status": "complete" if complete else "partial",
        "completed_model_seeds": len(seed_results),
        "expected_model_seeds": len(expected_seeds),
        "model_seeds": [int(row["model_seed"]) for row in seed_results],
        "protocol": {
            "input": "noisy q-only histories",
            "model": "frozen bounded PHAST-PARTIAL checkpoints from the measured Q1 surface",
            "change": "FDT process temperature and observation-noise standard deviation",
            "fixed": "plant, checkpoint family, context, test trajectories, particle count, and interval rule",
            "boundary": "thermal-only calibrated deployment; no learned thermal/external source separation",
        },
        "provenance": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "git_revision": _git_revision(),
            "config_hash": config_hash,
            "script_hash": script_hash,
        },
        "conditions": [],
    }
    if not seed_results:
        return summary

    levels = [float(value) for value in config["coverage_levels"]]
    primary = float(config["primary_coverage"])
    tolerance = float(config["coverage_tolerance"])
    width_limit = float(config["uninformative_width"])
    condition_ids = [row["id"] for row in seed_results[0]["conditions"]]
    for condition_id in condition_ids:
        rows = [
            next(item for item in seed_result["conditions"] if item["id"] == condition_id)
            for seed_result in seed_results
        ]
        methods = {
            method: _aggregate_method(
                [row["methods"][method] for row in rows], levels=levels
            )
            for method in METHODS
        }
        for method in METHODS:
            methods[method]["reliability"] = _reliability_boundary(
                methods[method],
                primary_level=primary,
                tolerance=tolerance,
                uninformative_width=width_limit,
            )
        summary["conditions"].append(
            {
                "id": condition_id,
                "process_temperature": rows[0]["process_temperature"],
                "observation_noise": rows[0]["observation_noise"],
                "excitation": rows[0]["excitation"],
                "observer_jitter": {
                    "q": _mean_std(row["observer_jitter"][0] for row in rows),
                    "p": _mean_std(row["observer_jitter"][1] for row in rows),
                },
                "methods": methods,
            }
        )
    return summary


def run_seed(
    config: Mapping[str, Any],
    profile_name: str,
    output_root: Path,
    *,
    model_seed: int,
    config_hash: str,
    script_hash: str,
    force: bool,
) -> Path:
    profile = config["profiles"][profile_name]
    output_dir = output_root / profile_name / f"seed{model_seed}"
    result_path = output_dir / "result.json"
    manifest_path = output_dir / "manifest.json"
    checkpoint_path = _checkpoint(config, model_seed)
    checkpoint_hash = _file_hash(checkpoint_path)
    if result_path.is_file() and manifest_path.is_file() and not force:
        manifest = json.loads(manifest_path.read_text())
        if (
            manifest.get("status") == "complete"
            and manifest.get("config_hash") == config_hash
            and manifest.get("script_hash") == script_hash
            and manifest.get("checkpoint_hash") == checkpoint_hash
        ):
            print(f"[stochastic-calibration] seed {model_seed}: verified result exists")
            return result_path

    output_dir.mkdir(parents=True, exist_ok=True)
    model = _load_model(config, model_seed)
    rows = []
    for index, condition in enumerate(conditions(profile), start=1):
        print(
            f"[stochastic-calibration] seed {model_seed}: {index}/{len(conditions(profile))} "
            f"Theta={condition.temperature:g} sigma_q={condition.observation_noise:g} "
            f"{condition.excitation}",
            flush=True,
        )
        rows.append(
            evaluate_condition(
                config, profile, model, condition, model_seed=model_seed
            )
        )
    result = {
        "study": config["study"],
        "profile": profile_name,
        "model_seed": model_seed,
        "checkpoint": str(checkpoint_path.relative_to(REPO_ROOT)),
        "conditions": rows,
        "provenance": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "git_revision": _git_revision(),
            "config_hash": config_hash,
            "script_hash": script_hash,
            "checkpoint_hash": checkpoint_hash,
            "python": platform.python_version(),
            "torch": torch.__version__,
        },
    }
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    manifest_path.write_text(
        json.dumps(
            {
                "status": "complete",
                "model_seed": model_seed,
                "conditions": len(rows),
                "config_hash": config_hash,
                "script_hash": script_hash,
                "checkpoint_hash": checkpoint_hash,
                "result": str(result_path.relative_to(REPO_ROOT)),
            },
            indent=2,
        )
        + "\n"
    )
    return result_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--profile", choices=("smoke", "full"), default="smoke")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--model-seeds", type=int, nargs="+")
    parser.add_argument("--defer-summary", action="store_true")
    parser.add_argument("--summary-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = load_config(args.config)
    profile = config["profiles"][args.profile]
    torch.set_num_threads(int(profile.get("torch_threads", 1)))
    config_hash = _stable_hash(config)
    script_hash = _file_hash(Path(__file__).resolve())
    seeds = (
        [int(value) for value in args.model_seeds]
        if args.model_seeds
        else [int(value) for value in profile["model_seeds"]]
    )
    undeclared = sorted(set(seeds) - set(int(v) for v in profile["model_seeds"]))
    if undeclared:
        raise ValueError(f"Model seeds not declared by profile {args.profile!r}: {undeclared}")
    if not args.summary_only:
        for seed in seeds:
            run_seed(
                config,
                args.profile,
                args.output_root,
                model_seed=seed,
                config_hash=config_hash,
                script_hash=script_hash,
                force=args.force,
            )
    if not args.defer_summary or args.summary_only:
        summary = build_summary(
            config,
            args.profile,
            args.output_root,
            config_hash=config_hash,
            script_hash=script_hash,
        )
        profile_dir = args.output_root / args.profile
        profile_dir.mkdir(parents=True, exist_ok=True)
        (profile_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        (profile_dir / "web.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(
            f"[stochastic-calibration] {args.profile}: "
            f"{summary['completed_model_seeds']}/{summary['expected_model_seeds']} seeds"
        )


if __name__ == "__main__":
    main()
