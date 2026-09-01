#!/usr/bin/env python3
"""Run the PHAST dissipation-recovery scaling matrix through the benchmark API.

The study changes the amount of observed excitation without changing the plant.
Every method receives the same generated split for a given system, excitation
level, training-set size, and dataset seed. Model variants are run separately so
PHAST-specific constructor options cannot leak into baseline constructors.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys
from typing import Any, Iterable, Mapping, Optional

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "configs" / "experiments" / "phast_dissipation_scaling.json"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "results" / "dissipation_scaling"


@dataclass(frozen=True)
class RunSpec:
    profile: str
    system: str
    excitation: str
    n_train: int
    hidden_dim: int
    variant: str
    model: str
    contract: str
    model_kwargs: dict[str, Any]
    settings: dict[str, Any]

    @property
    def identity(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def run_id(self) -> str:
        return "__".join(
            (
                self.system,
                self.excitation,
                f"n{self.n_train}",
                f"h{self.hidden_dim}",
                self.variant,
            )
        )


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    return json.loads(path.read_text())


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def expand_specs(config: Mapping[str, Any], profile: str) -> list[RunSpec]:
    if profile not in config["profiles"]:
        raise ValueError(f"Unknown profile {profile!r}.")
    settings = dict(config["profiles"][profile])
    specs: list[RunSpec] = []
    for system in settings["systems"]:
        system_cfg = config["systems"].get(system)
        if system_cfg is None:
            raise ValueError(f"Profile {profile!r} references unknown system {system!r}.")
        for excitation in settings["excitation_levels"]:
            if excitation not in system_cfg["excitation"]:
                raise ValueError(f"System {system!r} has no excitation level {excitation!r}.")
            for n_train in settings["n_train_values"]:
                for hidden_dim in settings["hidden_dims"]:
                    for variant in settings["variants"]:
                        variant_cfg = config["variants"].get(variant)
                        if variant_cfg is None:
                            raise ValueError(f"Profile {profile!r} references unknown variant {variant!r}.")
                        specs.append(
                            RunSpec(
                                profile=profile,
                                system=str(system),
                                excitation=str(excitation),
                                n_train=int(n_train),
                                hidden_dim=int(hidden_dim),
                                variant=str(variant),
                                model=str(variant_cfg["model"]),
                                contract=str(variant_cfg["contract"]),
                                model_kwargs=dict(variant_cfg.get("model_kwargs", {})),
                                settings=settings,
                            )
                        )
    return specs


def register_study_environment(config: Mapping[str, Any], spec: RunSpec):
    """Register a typed environment that changes sampling coverage, not dynamics."""
    from benchmarks_core.envs.double_pendulum_v2 import DoublePendulumEnv
    from benchmarks_core.envs.pendulum_v2 import PendulumEnv
    from phast.benchmarks import RegisteredEnv, get_env, register_env

    system_cfg = dict(config["systems"][spec.system])
    plant = dict(system_cfg["plant"])
    excitation = dict(system_cfg["excitation"][spec.excitation])
    excitation.pop("description", None)

    if system_cfg["kind"] == "pendulum":
        environment = PendulumEnv(qonly=True, **plant)
        environment.p_scale = float(excitation["p_scale"])
    elif system_cfg["kind"] == "double_pendulum":
        damping_keys = {"b1_base", "b1_amp", "b2_base", "b2_amp"}
        gen_kwargs = {key: plant.pop(key) for key in tuple(plant) if key in damping_keys}
        gen_kwargs["omega_range"] = tuple(float(value) for value in excitation["omega_range"])
        environment = DoublePendulumEnv(qonly=True, gen_kwargs=gen_kwargs, **plant)
    else:
        raise ValueError(f"Unsupported study environment kind {system_cfg['kind']!r}.")

    source = get_env(str(system_cfg["base_env"]))
    name = f"dissipation_{spec.system}_{spec.excitation}_qonly"
    compatible = sorted(set(source.compatible_models) | {spec.model})
    registered = RegisteredEnv(
        name=name,
        environment=environment,
        default_models=list(source.default_models),
        compatible_models=compatible,
        description=(
            f"{source.description} Dissipation-scaling variant with "
            f"{spec.excitation} initial-state excitation."
        ),
        supports_variable_n=source.supports_variable_n,
        domain_chart=source.domain_chart,
    )
    register_env(registered)
    return registered


def characterize_environment(env, spec: RunSpec) -> dict[str, Any]:
    """Record the actual hidden-state coverage used by the generated split."""
    from benchmarks_core.api import RolloutConfig

    settings = spec.settings
    torch.manual_seed(int(settings["data_seed"]))
    np.random.seed(int(settings["data_seed"]))
    batch = env.rollout(
        RolloutConfig(
            n_train=spec.n_train,
            n_val=int(settings["n_val"]),
            n_test=int(settings["n_test"]),
            seq_len=int(settings["seq_len"]),
            device="cpu",
        )
    )
    momenta = batch.train.momenta
    if not isinstance(momenta, torch.Tensor):
        raise RuntimeError(f"{env.name} did not expose hidden momenta for the q-only study.")
    initial = momenta[:, 0].detach().cpu().float()
    return {
        "n_trajectories": int(initial.shape[0]),
        "n_dof": int(initial.shape[-1]),
        "initial_momentum_mean_abs": float(initial.abs().mean()),
        "initial_momentum_rms": float(initial.square().mean().sqrt()),
        "initial_momentum_std": float(initial.std(unbiased=False)),
        "initial_momentum_max_abs": float(initial.abs().max()),
    }


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, torch.Tensor):
        return _jsonable(value.detach().cpu().tolist())
    if isinstance(value, np.generic):
        return _jsonable(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_jsonable(payload), indent=2, sort_keys=True) + "\n")


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.stdout.strip()


def provenance_snapshot() -> dict[str, Any]:
    status = _git(REPO_ROOT, "status", "--short")
    return {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "executable": sys.executable,
        "platform": platform.platform(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "repository": str(REPO_ROOT),
        "git_commit": _git(REPO_ROOT, "rev-parse", "HEAD"),
        "git_branch": _git(REPO_ROOT, "branch", "--show-current"),
        "git_dirty": bool(status),
        "benchmark_api": "phast.benchmarks.run_benchmark",
        "benchmarks_core": str(Path(__import__("benchmarks_core").__file__).resolve()),
    }


def execute_spec(
    config: Mapping[str, Any],
    spec: RunSpec,
    run_dir: Path,
    *,
    config_hash: str,
    force: bool = False,
) -> bool:
    from phast.benchmarks import run_benchmark

    manifest_path = run_dir / "manifest.json"
    spec_hash = _stable_hash(spec.identity)
    if not force and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("status") == "complete" and manifest.get("spec_hash") == spec_hash:
            print(f"[skip] {spec.run_id}")
            return True

    run_dir.mkdir(parents=True, exist_ok=True)
    env = register_study_environment(config, spec)
    coverage = characterize_environment(env, spec)
    started = datetime.now(timezone.utc).isoformat()
    manifest = {
        "status": "running",
        "started_utc": started,
        "spec_hash": spec_hash,
        "config_hash": config_hash,
        "spec": spec.identity,
        "registered_environment": env.name,
        "excitation_coverage": coverage,
        "provenance": provenance_snapshot(),
    }
    _write_json(manifest_path, manifest)
    _write_json(run_dir / "spec.json", spec.identity)

    settings = spec.settings
    device = "cpu" if settings.get("force_cpu", True) else (
        "cuda" if torch.cuda.is_available() else "cpu"
    )
    env_kwargs = {
        "n_train": spec.n_train,
        "n_val": int(settings["n_val"]),
        "n_test": int(settings["n_test"]),
        "seq_len": int(settings["seq_len"]),
        "hidden_dim": spec.hidden_dim,
        "n_layers": int(settings["n_layers"]),
        **spec.model_kwargs,
    }
    eval_kwargs = {
        "rollout_horizons": tuple(int(value) for value in settings["rollout_horizons"]),
        "rollout_context": int(settings["rollout_context"]),
        "rollout_n": int(settings["rollout_n"]),
    }
    checkpoint_dir = run_dir / "checkpoints"

    try:
        print(f"[run] {spec.run_id} -> {spec.model}")
        results = run_benchmark(
            env_name=env.name,
            model_names=[spec.model],
            epochs=int(settings["epochs"]),
            seeds=int(settings["seeds"]),
            seed_offset=int(settings["seed_offset"]),
            data_seed=int(settings["data_seed"]),
            batch_size=int(settings["batch_size"]),
            lr=float(settings["learning_rate"]),
            device=device,
            verbose=False,
            train_step_kwargs={},
            eval_step_kwargs=eval_kwargs,
            save_checkpoints=bool(settings["save_checkpoints"]),
            checkpoint_dir=str(checkpoint_dir),
            early_stopping_patience=settings.get("early_stopping_patience"),
            validation_interval=int(settings["validation_interval"]),
            record_training_history=True,
            **env_kwargs,
        )
        _write_json(run_dir / "results.json", results)
        manifest.update(
            {
                "status": "complete",
                "completed_utc": datetime.now(timezone.utc).isoformat(),
                "result_file": "results.json",
            }
        )
        _write_json(manifest_path, manifest)
        return True
    except Exception as exc:
        manifest.update(
            {
                "status": "failed",
                "failed_utc": datetime.now(timezone.utc).isoformat(),
                "error_type": type(exc).__name__,
                "error": str(exc),
            }
        )
        _write_json(manifest_path, manifest)
        raise


def _numeric_metrics(seed_results: Iterable[Mapping[str, Any]], split: str) -> dict[str, Any]:
    metrics = [dict(seed[f"{split}_metrics"]) for seed in seed_results]
    keys = sorted(set().union(*(entry.keys() for entry in metrics)))
    output: dict[str, Any] = {}
    for key in keys:
        values = [entry.get(key) for entry in metrics]
        numeric = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
        if numeric:
            output[f"{split}_{key}_mean"] = float(np.mean(numeric))
            output[f"{split}_{key}_std"] = float(np.std(numeric))
    return output


def summarize_run(run_dir: Path) -> Optional[dict[str, Any]]:
    manifest_path = run_dir / "manifest.json"
    result_path = run_dir / "results.json"
    if not manifest_path.exists() or not result_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("status") != "complete":
        return None
    results = json.loads(result_path.read_text())
    spec = manifest["spec"]
    seed_results = results[spec["model"]]
    row = {
        "run_id": run_dir.name,
        "system": spec["system"],
        "excitation": spec["excitation"],
        "n_train": spec["n_train"],
        "hidden_dim": spec["hidden_dim"],
        "variant": spec["variant"],
        "model": spec["model"],
        "contract": spec["contract"],
        "seeds": len(seed_results),
        "n_params": seed_results[0]["n_params"],
        "training_seconds_mean": float(np.mean([seed["training_seconds"] for seed in seed_results])),
        **manifest["excitation_coverage"],
        **_numeric_metrics(seed_results, "train"),
        **_numeric_metrics(seed_results, "test"),
    }
    return _jsonable(row)


def write_summary(profile_dir: Path) -> list[dict[str, Any]]:
    rows = [row for run_dir in sorted(profile_dir.iterdir()) if run_dir.is_dir() if (row := summarize_run(run_dir))]
    _write_json(profile_dir / "summary.json", rows)
    if rows:
        fieldnames = sorted(set().union(*(row.keys() for row in rows)))
        with (profile_dir / "summary.csv").open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    return rows


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--profile",
        choices=("smoke", "pilot", "bounded_pilot", "full"),
        default="smoke",
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--max-runs", type=int, default=None)
    parser.add_argument("--variants", nargs="+", default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    specs = expand_specs(config, args.profile)
    if args.variants:
        requested = set(args.variants)
        specs = [spec for spec in specs if spec.variant in requested]
        missing = requested - {spec.variant for spec in specs}
        if missing:
            raise ValueError(f"Requested variants are absent from {args.profile}: {sorted(missing)}")
    if args.max_runs is not None:
        specs = specs[: max(0, int(args.max_runs))]

    print(f"Profile {args.profile}: {len(specs)} run specifications")
    for spec in specs:
        print(f"  {spec.run_id}: {spec.model}")
    if args.dry_run:
        return 0

    profile_dir = args.output_root / args.profile
    profile_dir.mkdir(parents=True, exist_ok=True)
    config_hash = _stable_hash(config)
    _write_json(profile_dir / "resolved_config.json", config)
    successes = 0
    for spec in specs:
        successes += int(
            execute_spec(
                config,
                spec,
                profile_dir / spec.run_id,
                config_hash=config_hash,
                force=args.force,
            )
        )
        write_summary(profile_dir)
    rows = write_summary(profile_dir)
    print(f"Completed {successes}/{len(specs)} requested runs; summary contains {len(rows)} runs.")
    return 0 if successes == len(specs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
