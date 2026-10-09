#!/usr/bin/env python3
"""Evaluate one frozen observer/controller stack under feedback-channel stress."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
from typing import Any, Mapping

import numpy as np
import torch

from models.phast.architectures.explicit import MAPSmootherObserver
from phast.benchmarks.control.casimir.benchmark_casimir_phast import (
    REGIMES,
    TruePendulum,
    run_trial,
    train_qonly_observer_on_pendulum,
    train_qonly_phast_on_pendulum,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "configs" / "experiments" / "phast_closed_loop_diagnostic.json"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "results" / "closed_loop_diagnostic"


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, np.generic):
        return _jsonable(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_jsonable(payload), indent=2, sort_keys=True) + "\n")


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=False, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    return result.stdout.strip()


def _aggregate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault((row["stressor"], row["regime"], row["method"]), []).append(row)
    cells = []
    for (stressor, regime, method), group in sorted(grouped.items()):
        def mean(key: str) -> float:
            return float(np.mean([float(item[key]) for item in group]))
        cells.append({
            "stressor": stressor,
            "axis": group[0]["axis"],
            "level": group[0]["level"],
            "regime": regime,
            "method": method,
            "n": len(group),
            "success_rate": mean("success"),
            "final_error_mean": mean("final_error"),
            "final_error_std": float(np.std([float(item["final_error"]) for item in group])),
            "applied_control_effort_mean": mean("control_effort"),
            "commanded_control_effort_mean": mean("commanded_control_effort"),
            "casimir_drift_mean": mean("casimir_drift"),
            "velocity_error_mean": mean("velocity_error_mean"),
            "final_error_regret_mean": mean("final_error_regret"),
            "control_effort_regret_mean": mean("control_effort_regret"),
        })
    return cells


def _wilson_interval(successes: int, n: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if n <= 0:
        return (float("nan"), float("nan"))
    proportion = successes / n
    denominator = 1.0 + z * z / n
    center = (proportion + z * z / (2.0 * n)) / denominator
    half_width = z * math.sqrt(
        proportion * (1.0 - proportion) / n + z * z / (4.0 * n * n)
    ) / denominator
    return (max(0.0, center - half_width), min(1.0, center + half_width))


def _threshold_summary(
    rows: list[dict[str, Any]],
    reliability_target: float,
) -> dict[str, Any]:
    grouped: dict[tuple[str, float, int, str], list[dict[str, Any]]] = {}
    for row in rows:
        key = (str(row["axis"]), float(row["level"]), int(row["severity_index"]), str(row["method"]))
        grouped.setdefault(key, []).append(row)

    cells = []
    for (axis, level, severity_index, method), group in sorted(
        grouped.items(), key=lambda item: (item[0][0], item[0][2], item[0][3])
    ):
        successes = int(sum(bool(item["success"]) for item in group))
        n = len(group)
        rate = successes / n
        lower, upper = _wilson_interval(successes, n)
        if lower >= reliability_target:
            conclusion = "reliable"
        elif upper < reliability_target:
            conclusion = "unreliable"
        else:
            conclusion = "unresolved"
        cells.append({
            "axis": axis,
            "level": level,
            "severity_index": severity_index,
            "method": method,
            "successes": successes,
            "n": n,
            "success_rate": rate,
            "wilson_95": [lower, upper],
            "target": reliability_target,
            "conclusion": conclusion,
            "final_error_regret_mean": float(np.mean([
                float(item["final_error_regret"]) for item in group
            ])),
            "velocity_error_mean": float(np.mean([
                float(item["velocity_error_mean"]) for item in group
            ])),
            "casimir_drift_mean": float(np.mean([
                float(item["casimir_drift"]) for item in group
            ])),
        })

    boundaries = []
    axes = sorted({cell["axis"] for cell in cells})
    methods = sorted({cell["method"] for cell in cells})
    for axis in axes:
        for method in methods:
            ordered = sorted(
                (cell for cell in cells if cell["axis"] == axis and cell["method"] == method),
                key=lambda cell: int(cell["severity_index"]),
            )
            reliable = [cell for cell in ordered if cell["conclusion"] == "reliable"]
            observed_failure = next((cell for cell in ordered if cell["success_rate"] < reliability_target), None)
            resolved_failure = next((cell for cell in ordered if cell["conclusion"] == "unreliable"), None)
            boundaries.append({
                "axis": axis,
                "method": method,
                "largest_resolved_reliable_level": reliable[-1]["level"] if reliable else None,
                "first_observed_failure_level": observed_failure["level"] if observed_failure else None,
                "first_resolved_failure_level": resolved_failure["level"] if resolved_failure else None,
            })
    return {"cells": cells, "boundaries": boundaries}


def declared_stressors(
    config: Mapping[str, Any], settings: Mapping[str, Any]
) -> list[tuple[str, dict[str, Any]]]:
    defaults = {
        "measurement_noise_std": 0.0,
        "measurement_delay_steps": 0,
        "measurement_dropout_probability": 0.0,
        "actuator_gain": 1.0,
    }
    if "sweeps" not in settings:
        return [
            (
                str(stressor_id),
                {
                    **config["stressors"][stressor_id],
                    "axis": "categorical",
                    "level": index,
                    "severity_index": index,
                },
            )
            for index, stressor_id in enumerate(settings["stressors"])
        ]

    records = []
    for axis in settings["sweeps"]:
        sweep = config["sweeps"][axis]
        field = str(sweep["field"])
        for index, level in enumerate(sweep["levels"]):
            stressor = {
                **defaults,
                field: level,
                "label": f"{sweep['label']}: {level:g}",
                "axis": str(axis),
                "level": float(level),
                "severity_index": index,
            }
            records.append((f"{axis}__{index}", stressor))
    return records


def run(config: Mapping[str, Any], profile: str) -> dict[str, Any]:
    settings = config["profiles"][profile]
    torch.set_num_threads(int(settings.get("torch_threads", 1)))
    controller = config["controller"]
    device = "cpu"
    base_seed = int(settings["base_seed"])
    dt = float(settings["dt"])
    nominal_plant = TruePendulum(device=device)

    observer_fdtcn = train_qonly_observer_on_pendulum(
        nominal_plant,
        observer_type="fd_tcn_noisecond",
        n_epochs=int(settings["observer_train_epochs"]),
        n_trajectories=int(settings["observer_train_trajectories"]),
        data_steps=int(settings["observer_train_steps"]),
        dt=dt,
        window=int(settings["observer_window"]),
        batch_size=int(settings["observer_train_batch_size"]),
        lr=1e-3,
        device=device,
        seed=base_seed,
        measurement_noise_range=tuple(settings["observer_train_noise_range"]),
        verbose=True,
    )
    qonly_phast = train_qonly_phast_on_pendulum(
        nominal_plant,
        n_epochs=int(settings["qonly_phast_train_epochs"]),
        n_trajectories=int(settings["qonly_phast_train_trajectories"]),
        data_steps=int(settings["qonly_phast_train_steps"]),
        dt=dt,
        batch_size=int(settings["qonly_phast_train_batch_size"]),
        lr=1e-3,
        device=device,
        seed=base_seed,
        observer_type="fd_tcn_noisecond",
        measurement_noise_range=tuple(settings["observer_train_noise_range"]),
        rollout_context=int(settings["observer_window"]),
        verbose=True,
    )
    observer_phast = getattr(qonly_phast, "observer", None)
    if observer_phast is None:
        raise RuntimeError("q-only PHAST model did not expose its observer")
    observer_map = MAPSmootherObserver(
        n_dof=1,
        dt=dt,
        window=int(settings["observer_window"]),
        accel_noise_std=10.0,
        use_periodic=True,
    ).to(device).eval()

    rows: list[dict[str, Any]] = []
    stressor_records = declared_stressors(config, settings)
    for stressor_index, (stressor_id, stressor) in enumerate(stressor_records):
        plant = TruePendulum(actuator_gain=float(stressor["actuator_gain"]), device=device)
        for regime_id in settings["regimes"]:
            regime = REGIMES[regime_id]
            for trial in range(int(settings["n_trials"])):
                trial_seed = base_seed * 1000 + trial
                for method in settings["methods"]:
                    result = run_trial(
                        plant,
                        None,
                        observer_fdtcn,
                        observer_phast,
                        observer_map,
                        None,
                        regime,
                        str(method),
                        trial_seed=trial_seed,
                        n_steps=int(settings["n_steps"]),
                        dt=dt,
                        k_c=float(controller["k_c"]),
                        damping_gain=float(controller["damping_gain"]),
                        xi_correction_gain=float(controller["xi_correction_gain"]),
                        observer_window=int(settings["observer_window"]),
                        measurement_noise_std=float(stressor["measurement_noise_std"]),
                        measurement_delay_steps=int(stressor["measurement_delay_steps"]),
                        measurement_dropout_probability=float(stressor["measurement_dropout_probability"]),
                        convergence_eps=float(controller["convergence_eps"]),
                        stability_window=int(controller["stability_window"]),
                    )
                    row = asdict(result)
                    row.update({
                        "stressor": stressor_id,
                        "stressor_index": stressor_index,
                        "axis": stressor["axis"],
                        "level": stressor["level"],
                        "severity_index": stressor["severity_index"],
                    })
                    rows.append(row)

    oracle_by_trial = {
        (row["stressor"], row["regime"], row["trial_seed"]): row
        for row in rows if row["method"] == "casimir_true"
    }
    for row in rows:
        oracle = oracle_by_trial[(row["stressor"], row["regime"], row["trial_seed"])]
        row["final_error_regret"] = float(row["final_error"]) - float(oracle["final_error"])
        row["control_effort_regret"] = float(row["control_effort"]) - float(oracle["control_effort"])
    evidence = {
        "rows": rows,
        "cells": _aggregate(rows),
        "stressor_definitions": dict(stressor_records),
    }
    if "reliability_target" in settings:
        evidence["thresholds"] = _threshold_summary(
            rows,
            float(settings["reliability_target"]),
        )
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--profile", default="smoke")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--axes", nargs="+", help="Run only these declared sweep axes")
    parser.add_argument("--merge-parts", action="store_true", help="Merge all per-axis artifacts into the canonical profile summary")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.profile not in config["profiles"]:
        raise SystemExit(f"Unknown profile: {args.profile}")
    settings = config["profiles"][args.profile]
    declared_axes = list(settings.get("sweeps", []))
    if args.axes:
        if not declared_axes:
            raise SystemExit(f"Profile {args.profile} has no sweep axes")
        unknown = sorted(set(args.axes) - set(declared_axes))
        if unknown:
            raise SystemExit(f"Unknown sweep axes: {unknown}")
        settings["sweeps"] = list(args.axes)
    config_sha256 = hashlib.sha256(args.config.read_bytes()).hexdigest()
    script_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    if args.merge_parts:
        if args.axes:
            raise SystemExit("--merge-parts cannot be combined with --axes")
        all_rows = []
        all_stressors = {}
        for axis in declared_axes:
            part_dir = args.output_root / args.profile / "parts" / axis
            part_manifest = json.loads((part_dir / "manifest.json").read_text())
            if (
                part_manifest.get("status") != "complete"
                or part_manifest.get("config_sha256") != config_sha256
                or part_manifest.get("script_sha256") != script_sha256
                or part_manifest.get("selected_axes") != [axis]
            ):
                raise RuntimeError(f"Stale or incomplete threshold part: {part_dir}")
            part = json.loads((part_dir / "summary.json").read_text())
            all_rows.extend(part["rows"])
            all_stressors.update(part["stressor_definitions"])
        evidence = {
            "rows": all_rows,
            "cells": _aggregate(all_rows),
            "stressor_definitions": all_stressors,
            "thresholds": _threshold_summary(all_rows, float(settings["reliability_target"])),
        }
        output_dir = args.output_root / args.profile
        payload = {
            "schema_version": 1,
            "profile": args.profile,
            "question": config["title"],
            "settings": settings,
            "controller": config["controller"],
            "stressors": all_stressors,
            **evidence,
        }
        _write_json(output_dir / "summary.json", payload)
        _write_json(output_dir / "manifest.json", {
            "schema_version": 1,
            "status": "complete",
            "completed_utc": datetime.now(timezone.utc).isoformat(),
            "profile": args.profile,
            "config_path": str(args.config.resolve()),
            "config_sha256": config_sha256,
            "script_sha256": script_sha256,
            "selected_axes": declared_axes,
            "n_trial_runs": len(all_rows),
            "summary": "summary.json",
            "partitioned": True,
        })
        print(f"Merged {len(all_rows)} trial runs -> {output_dir / 'summary.json'}")
        return 0

    stressors = declared_stressors(config, settings)
    n_trials = len(stressors) * len(settings["regimes"]) * len(settings["methods"]) * int(settings["n_trials"])
    if args.dry_run:
        print(json.dumps({"profile": args.profile, "trial_runs": n_trials, "settings": settings}, indent=2))
        return 0

    output_dir = args.output_root / args.profile
    if args.axes:
        output_dir = output_dir / "parts" / "__".join(args.axes)
    manifest = {
        "schema_version": 1,
        "status": "running",
        "started_utc": datetime.now(timezone.utc).isoformat(),
        "profile": args.profile,
        "config_path": str(args.config.resolve()),
        "config_sha256": config_sha256,
        "script_sha256": script_sha256,
        "selected_axes": list(settings.get("sweeps", [])),
        "git_commit": _git("rev-parse", "HEAD"),
        "git_dirty": bool(_git("status", "--short")),
        "benchmark_apis": [
            "train_qonly_observer_on_pendulum",
            "train_qonly_phast_on_pendulum",
            "run_trial",
            "TruePendulum.simulate",
        ],
    }
    _write_json(output_dir / "manifest.json", manifest)
    evidence = run(config, args.profile)
    payload = {
        "schema_version": 1,
        "profile": args.profile,
        "question": config["title"],
        "settings": settings,
        "controller": config["controller"],
        "stressors": dict(stressors),
        **evidence,
    }
    _write_json(output_dir / "summary.json", payload)
    manifest.update({
        "status": "complete",
        "completed_utc": datetime.now(timezone.utc).isoformat(),
        "summary": "summary.json",
        "n_trial_runs": n_trials,
    })
    _write_json(output_dir / "manifest.json", manifest)
    print(f"Completed closed-loop diagnostic -> {output_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
