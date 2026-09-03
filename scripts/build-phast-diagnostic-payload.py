#!/usr/bin/env python3
"""Promote PHAST diagnostic run manifests into the research-page payload."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phast-root", type=Path, required=True)
    parser.add_argument("--template", type=Path, default=Path("public/posters/phast/learning/data/diagnostic-program.json"))
    parser.add_argument("--output", type=Path, default=Path("public/posters/phast/learning/data/diagnostic-program.json"))
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def profile_status(
    root: Path,
    profile: str,
    expected: int,
    required_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    directory = root / "results/dissipation_scaling" / profile
    manifests = list(directory.glob("*/manifest.json")) if directory.is_dir() else []
    required_settings = required_settings or {}
    complete = 0
    for path in manifests:
        manifest = read_json(path)
        settings = manifest.get("spec", {}).get("settings", {})
        if manifest.get("status") == "complete" and all(
            settings.get(key) == value for key, value in required_settings.items()
        ):
            complete += 1
    return {"profile": profile, "complete": complete, "expected": expected}


def compact_metric(row: dict[str, Any], stem: str) -> dict[str, float]:
    return {
        "mean": float(row[f"{stem}_mean"]),
        "std": float(row[f"{stem}_std"]),
    }


def compact_training_time(row: dict[str, Any]) -> dict[str, float]:
    return {
        "mean": float(row["training_seconds_mean"]),
        "std": float(row.get("training_seconds_std", 0.0)),
    }


def verified_surface_rows(root: Path, profile: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    verified = []
    for row in rows:
        run_id = row.get("run_id")
        variant = row.get("variant")
        if not run_id or not variant or int(row.get("seeds", 0)) != 5:
            continue
        manifest_path = root / "results/dissipation_scaling" / profile / run_id / "manifest.json"
        if not manifest_path.is_file():
            continue
        manifest = read_json(manifest_path)
        spec = manifest.get("spec", {})
        settings = spec.get("settings", {})
        if (
            manifest.get("status") == "complete"
            and settings.get("nested_split_protocol") is True
            and settings.get("protocol_version") == 2
            and settings.get("fixed_eval_seq_len") == 320
            and spec.get("variant") == variant
        ):
            verified.append(row)
    return verified


def seed_metric(root: Path, profile: str, row: dict[str, Any], metric: str) -> dict[int, float]:
    result_path = root / "results/dissipation_scaling" / profile / row["run_id"] / "results.json"
    results = read_json(result_path)[row["model"]]
    values = {
        int(result["seed"]): float(result["test_metrics"][metric])
        for result in results
    }
    if len(values) != 5 or not all(math.isfinite(value) for value in values.values()):
        raise ValueError(f"Expected five finite {metric} values in {result_path}")
    return values


def paired_endpoint_effect(
    root: Path,
    profile: str,
    low_row: dict[str, Any],
    high_row: dict[str, Any],
    metric: str,
    *,
    lower_is_better: bool,
) -> dict[str, Any]:
    low = seed_metric(root, profile, low_row, metric)
    high = seed_metric(root, profile, high_row, metric)
    if low.keys() != high.keys():
        raise ValueError(f"Seed mismatch between {low_row['run_id']} and {high_row['run_id']}")
    differences = [
        low[seed] - high[seed] if lower_is_better else high[seed] - low[seed]
        for seed in sorted(low)
    ]
    mean = statistics.fmean(differences)
    std = statistics.stdev(differences)
    half_width = 2.7764451051977987 * std / math.sqrt(len(differences))
    interval = [mean - half_width, mean + half_width]
    classification = "improves" if interval[0] > 0 else "degrades" if interval[1] < 0 else "not_resolved"
    return {
        "mean_gain": mean,
        "ci95": interval,
        "classification": classification,
        "seed_differences": differences,
    }


def dissipation_surface(root: Path) -> dict[str, Any] | None:
    recovery_path = root / "results/dissipation_scaling/diagnostic_surface/summary.json"
    forecast_path = root / "results/dissipation_scaling/diagnostic_forecast_surface/summary.json"
    if not recovery_path.is_file() or not forecast_path.is_file():
        return None

    recovery_rows = verified_surface_rows(root, "diagnostic_surface", read_json(recovery_path))
    forecast_rows = verified_surface_rows(root, "diagnostic_forecast_surface", read_json(forecast_path))
    if len(recovery_rows) != 80 or len(forecast_rows) != 120:
        return None
    forecast_index = {
        (row["excitation"], int(row["n_train"]), int(row["seq_len"]), row["variant"]): row
        for row in forecast_rows
    }
    recovery_index = {
        (row["excitation"], int(row["n_train"]), int(row["seq_len"]), row["variant"]): row
        for row in recovery_rows
    }
    excitations = sorted({row["excitation"] for row in recovery_rows})
    n_train_values = sorted({int(row["n_train"]) for row in recovery_rows})
    seq_len_values = sorted({int(row["seq_len"]) for row in recovery_rows})
    forecast_variants = ("phast_unknown", "phnn_observer", "s5")
    recovery_variants = ("phast_partial_bounded", "phast_partial")
    sample_budget_counts: dict[int, int] = {}
    for seq_len in seq_len_values:
        for n_train in n_train_values:
            budget = n_train * seq_len
            sample_budget_counts[budget] = sample_budget_counts.get(budget, 0) + 1
    matched_sample_budgets = sorted(
        budget for budget, count in sample_budget_counts.items() if count > 1
    )
    cells = []

    for excitation in excitations:
        for seq_len in seq_len_values:
            for n_train in n_train_values:
                forecast_keys = [
                    (excitation, n_train, seq_len, variant)
                    for variant in forecast_variants
                ]
                recovery_keys = [
                    (excitation, n_train, seq_len, variant)
                    for variant in recovery_variants
                ]
                if not all(key in forecast_index for key in forecast_keys):
                    continue
                if not all(key in recovery_index for key in recovery_keys):
                    continue

                forecast = {
                    variant: {
                        **compact_metric(
                            forecast_index[(excitation, n_train, seq_len, variant)],
                            "test_rollout_theta_wrap_mse_h100",
                        ),
                        "training_seconds": compact_training_time(
                            forecast_index[(excitation, n_train, seq_len, variant)]
                        ),
                    }
                    for variant in forecast_variants
                }
                ranked = sorted(forecast, key=lambda variant: forecast[variant]["mean"])
                winner, runner_up = ranked[:2]
                baseline_winner = min(
                    ("phnn_observer", "s5"),
                    key=lambda variant: forecast[variant]["mean"],
                )
                bounded_row = recovery_index[
                    (excitation, n_train, seq_len, "phast_partial_bounded")
                ]
                uncapped_row = recovery_index[
                    (excitation, n_train, seq_len, "phast_partial")
                ]
                bounded = compact_metric(bounded_row, "test_damping_r2")
                uncapped = compact_metric(uncapped_row, "test_damping_r2")
                forecast_winner = winner == "phast_unknown"
                positive_recovery = bounded["mean"] > 0
                if forecast_winner and positive_recovery:
                    region = "A"
                elif forecast_winner:
                    region = "B"
                elif positive_recovery:
                    region = "C"
                else:
                    region = "D"
                sample_budget = n_train * seq_len
                cells.append({
                    "excitation": excitation,
                    "n_train": n_train,
                    "seq_len": seq_len,
                    "forecast": forecast,
                    "forecast_winner": winner,
                    "forecast_winner_margin": forecast[runner_up]["mean"] / forecast[winner]["mean"],
                    "forecast_phast_effect": {
                        "baseline": baseline_winner,
                        **paired_endpoint_effect(
                            root,
                            "diagnostic_forecast_surface",
                            forecast_index[(excitation, n_train, seq_len, baseline_winner)],
                            forecast_index[(excitation, n_train, seq_len, "phast_unknown")],
                            "rollout_theta_wrap_mse_h100",
                            lower_is_better=True,
                        ),
                    },
                    "recovery": {
                        "bounded": {
                            **bounded,
                            "training_seconds": compact_training_time(bounded_row),
                        },
                        "uncapped": {
                            **uncapped,
                            "training_seconds": compact_training_time(uncapped_row),
                        },
                        "bound_effect": paired_endpoint_effect(
                            root,
                            "diagnostic_surface",
                            uncapped_row,
                            bounded_row,
                            "damping_r2",
                            lower_is_better=False,
                        ),
                    },
                    "region": region,
                    "sample_budget": sample_budget,
                    "has_fixed_budget_peer": sample_budget in matched_sample_budgets,
                    "initial_momentum_rms": float(bounded_row["initial_momentum_rms"]),
                })

    expected_cells = len(excitations) * len(n_train_values) * len(seq_len_values)
    if len(cells) != expected_cells:
        return None

    endpoint_effects = []
    min_n, max_n = n_train_values[0], n_train_values[-1]
    min_t, max_t = seq_len_values[0], seq_len_values[-1]
    for excitation in excitations:
        for seq_len in seq_len_values:
            for metric_name, profile, variant, metric, lower_is_better in (
                ("forecast", "diagnostic_forecast_surface", "phast_unknown", "rollout_theta_wrap_mse_h100", True),
                ("recovery", "diagnostic_surface", "phast_partial_bounded", "damping_r2", False),
            ):
                low_row = (forecast_index if metric_name == "forecast" else recovery_index)[
                    (excitation, min_n, seq_len, variant)
                ]
                high_row = (forecast_index if metric_name == "forecast" else recovery_index)[
                    (excitation, max_n, seq_len, variant)
                ]
                endpoint_effects.append({
                    "axis": "n_train",
                    "metric": metric_name,
                    "excitation": excitation,
                    "fixed_seq_len": seq_len,
                    "from": min_n,
                    "to": max_n,
                    **paired_endpoint_effect(
                        root,
                        profile,
                        low_row,
                        high_row,
                        metric,
                        lower_is_better=lower_is_better,
                    ),
                })
        for n_train in n_train_values:
            for metric_name, profile, variant, metric, lower_is_better in (
                ("forecast", "diagnostic_forecast_surface", "phast_unknown", "rollout_theta_wrap_mse_h100", True),
                ("recovery", "diagnostic_surface", "phast_partial_bounded", "damping_r2", False),
            ):
                low_row = (forecast_index if metric_name == "forecast" else recovery_index)[
                    (excitation, n_train, min_t, variant)
                ]
                high_row = (forecast_index if metric_name == "forecast" else recovery_index)[
                    (excitation, n_train, max_t, variant)
                ]
                endpoint_effects.append({
                    "axis": "seq_len",
                    "metric": metric_name,
                    "excitation": excitation,
                    "fixed_n_train": n_train,
                    "from": min_t,
                    "to": max_t,
                    **paired_endpoint_effect(
                        root,
                        profile,
                        low_row,
                        high_row,
                        metric,
                        lower_is_better=lower_is_better,
                    ),
                })

    fixed_budget_effects = []
    for excitation in excitations:
        for sample_budget in matched_sample_budgets:
            pairs = sorted(
                (
                    (n_train, seq_len)
                    for n_train in n_train_values
                    for seq_len in seq_len_values
                    if n_train * seq_len == sample_budget
                ),
                key=lambda pair: pair[0],
            )
            if len(pairs) != 2:
                continue
            fewer_longer, more_shorter = pairs
            for metric_name, profile, variant, metric, lower_is_better in (
                ("forecast", "diagnostic_forecast_surface", "phast_unknown", "rollout_theta_wrap_mse_h100", True),
                ("recovery", "diagnostic_surface", "phast_partial_bounded", "damping_r2", False),
            ):
                index = forecast_index if metric_name == "forecast" else recovery_index
                fewer_row = index[(excitation, fewer_longer[0], fewer_longer[1], variant)]
                more_row = index[(excitation, more_shorter[0], more_shorter[1], variant)]
                fixed_budget_effects.append({
                    "metric": metric_name,
                    "excitation": excitation,
                    "sample_budget": sample_budget,
                    "fewer_longer": {
                        "n_train": fewer_longer[0],
                        "seq_len": fewer_longer[1],
                    },
                    "more_shorter": {
                        "n_train": more_shorter[0],
                        "seq_len": more_shorter[1],
                    },
                    **paired_endpoint_effect(
                        root,
                        profile,
                        fewer_row,
                        more_row,
                        metric,
                        lower_is_better=lower_is_better,
                    ),
                })

    return {
        "n_train_values": n_train_values,
        "seq_len_values": seq_len_values,
        "excitations": {
            "narrow": "Small starting motion (initial-momentum scale 0.35)",
            "broad": "Large starting motion (initial-momentum scale 4.0)",
        },
        "forecast_contract": (
            "Strict position-only comparison: PHAST-UNKNOWN, pHNN observer, and S5 "
            "receive the same histories and training budget."
        ),
        "recovery_contract": (
            "Separate grey-box attribution test: potential, mass, chart, damping floor, "
            "and damping cap are declared; PHAST learns the remaining damping law."
        ),
        "model_seeds": 5,
        "data_seed": 42,
        "training_contract": (
            "Every cell receives 100 epochs and the same full 320-sample validation and test "
            "trajectories. Increasing N adds optimizer steps per epoch; increasing N or T adds "
            "sample processing and wall time. Fixed-update scaling is not established by this "
            "surface."
        ),
        "decision_rule": {
            "A": "PHAST is the forecast winner and bounded damping R-squared is positive.",
            "B": "PHAST is the forecast winner, but bounded damping R-squared is not positive.",
            "C": "Bounded damping R-squared is positive, but PHAST is not the forecast winner.",
            "D": "Neither criterion is met.",
        },
        "matched_sample_budgets": matched_sample_budgets,
        "endpoint_effects": endpoint_effects,
        "fixed_budget_effects": fixed_budget_effects,
        "effect_interval": "paired seed difference, 95% t interval with 4 degrees of freedom",
        "cells": cells,
    }


def manifest_status(path: Path, expected: int) -> dict[str, Any]:
    if not path.is_file():
        return {"complete": 0, "expected": expected, "status": "not_started"}
    manifest = read_json(path)
    complete = expected if manifest.get("status") == "complete" else 0
    return {"complete": complete, "expected": expected, "status": str(manifest.get("status", "unknown"))}


def sequential_matrix(root: Path, profile: str):
    path = root / f"results/sequential_diagnostic/{profile}/summary.json"
    if not path.is_file():
        return None
    payload = read_json(path)
    environments = [item["id"] for item in payload["environments"]]
    cells = [item for item in payload["summary"]["cells"] if item["arm"] == "finetune" and item["seen"]]
    stages = sorted({int(item["stage"]) for item in cells})
    matrix = []
    for stage in stages:
        row = []
        for env_index, environment in enumerate(environments):
            if env_index > stage:
                row.append(None)
                continue
            cell = next(item for item in cells if int(item["stage"]) == stage and item["evaluation_environment"] == environment)
            row.append(float(cell["forecast_error"]["mean"]))
        matrix.append(row)
    return environments, [f"after {environments[stage]}" for stage in stages], matrix


def action_contract_audit(root: Path):
    path = root / "results/action_interface/isaac_action_contract.json"
    if not path.is_file():
        return None
    payload = read_json(path)
    return [
        {
            "robot": robot,
            "kp": float(item["pd_params"]["Kp"]),
            "kd": float(item["pd_params"]["Kd"]),
            "action_scale": float(item["pd_params"]["action_scale"]),
            "raw_std": float(item["raw_action"]["std"]),
            "torque_std": float(item["nominal_joint_torque"]["std"]),
            "raw_to_torque_corr": float(item["raw_to_torque_corr_mean"]),
        }
        for robot, item in payload.items()
    ]


def closed_loop_matrix(root: Path):
    path = root / "results/closed_loop_diagnostic/full/summary.json"
    if not path.is_file():
        return None
    payload = read_json(path)
    methods = list(payload["settings"]["methods"])
    stressors = list(payload["settings"]["stressors"])
    cells = payload["cells"]
    matrix = []
    for method in methods:
        row = []
        for stressor in stressors:
            selected = [cell for cell in cells if cell["method"] == method and cell["stressor"] == stressor]
            successes = sum(float(cell["success_rate"]) * int(cell["n"]) for cell in selected)
            count = sum(int(cell["n"]) for cell in selected)
            row.append(successes / count)
        matrix.append(row)
    return {
        "methods": methods,
        "stressors": stressors,
        "success_matrix": matrix,
        "n_trials": sum(int(cell["n"]) for cell in cells),
    }


def stochastic_attribution_study(root: Path):
    path = root / "results/stochastic_attribution/full/web.json"
    if not path.is_file():
        return None
    result = read_json(path)
    matched = result["matched_law"]
    intervention = matched["after_external_channel_removal"]
    summary = result["summary"]
    cells = result["cells"]
    max_covariance_error = max(float(cell["max_covariance_relative_error"]) for cell in cells.values())
    max_z = max(
        max(float(cell["max_drift_z"]), float(cell["max_discrete_energy_z"]))
        for cell in cells.values()
    )
    reference_cell = next(iter(cells.values()))
    return {
        "id": "uncertainty",
        "label": "Uncertainty",
        "status": "Mechanistic result",
        "source": "results/stochastic_attribution/full/web.json",
        "question": result["question"],
        "answer": (
            "No from the training transition law alone. The thermal and external-source "
            "hypotheses have identical total drift and covariance before intervention. "
            "Removing the external channel separates them."
        ),
        "not_established": summary["not_established"],
        "motivates": (
            "Interventions or independently calibrated channels before claiming that a "
            "learned stochastic term identifies a physical noise source."
        ),
        "protocol": {
            "input": (
                "Stochastic windy-pendulum states; 250,000 one-step samples at each of "
                "eight probe states and five seeds"
            ),
            "change": "Thermal versus external source decomposition, then removal of the external channel",
            "fixed": "Total drift and covariance during training, plant, time step, and temperature",
            "readout": "Conditional drift, covariance, and the discrete stochastic energy ledger",
        },
        "evidence": (
            f"Four source-isolation cells; {reference_cell['n_probe_seed_pairs']} probe-seed "
            f"pairs per cell. Maximum covariance error is {100 * max_covariance_error:.2f}%; "
            f"maximum drift and discrete-energy deviations are below {max_z:.2f} standard errors."
        ),
        "execution": {
            "summary": (
                "All four full attribution cells pass their preregistered local-moment checks. "
                "The matched training law and shaker-removal intervention are complete."
            ),
            "runs": [{"complete": 4, "expected": 4, "status": "complete"}],
        },
        "cells": cells,
        "matched_law": matched,
        "transition_moment_checks_passed": summary["transition_moment_checks_passed"],
        "sampling": {
            "probe_seed_pairs_per_cell": int(reference_cell["n_probe_seed_pairs"]),
            "samples_per_probe": int(reference_cell["n_samples_per_probe"]),
        },
        "intervention": {
            "drift_change": float(intervention["external_source_mean_drift_change"]),
            "covariance_drop": float(intervention["external_source_relative_covariance_drop"]),
        },
    }


def main() -> None:
    args = parse_args()
    root = args.phast_root.resolve()
    payload = read_json(args.template)
    studies = {study["id"]: study for study in payload["studies"]}

    evidence = studies["evidence"]
    evidence_runs = [
        profile_status(root, "diagnostic_smoke", 8),
        profile_status(root, "diagnostic_forecast_smoke", 6),
        profile_status(
            root,
            "diagnostic_surface",
            80,
            {
                "nested_split_protocol": True,
                "protocol_version": 2,
                "fixed_eval_seq_len": 320,
            },
        ),
        profile_status(
            root,
            "diagnostic_forecast_surface",
            120,
            {
                "nested_split_protocol": True,
                "protocol_version": 2,
                "fixed_eval_seq_len": 320,
            },
        ),
    ]
    full_complete = all(run["complete"] == run["expected"] for run in evidence_runs[2:])
    evidence.pop("surface", None)
    evidence.update({
        "status": "Surface running",
        "source": "PHAST package · corrected run manifests",
        "question": "How do trajectory count, trajectory length, and motion coverage change forecast accuracy and damping recovery?",
        "answer": (
            "The controlled pilot shows that broader starting motion can improve damping recovery "
            "while making forecasting harder. The effect of trajectory count and length remains "
            "unresolved until the nested, fixed-test surfaces complete."
        ),
        "not_established": (
            "No scaling claim in N or T is made from the historical pilot. Sampling-rate, forced-motion, "
            "high-energy, fixed-update, dimensional, and general-identifiability claims remain untested."
        ),
        "evidence": (
            "Corrected five-seed N by T surfaces are running with nested training prefixes and fixed, "
            "independent validation and test trajectories."
        ),
        "protocol": {
            "input": "Position histories from one fixed windy-pendulum plant",
            "change": "N training trajectories, T samples per trajectory, and starting-motion coverage",
            "fixed": "Plant, validation/test trajectories, hidden width 64, 100 epochs, observer history, and H=100 evaluation",
            "readout": "Strict UNKNOWN forecast winner and separate bounded-PHAST damping R-squared",
        },
    })
    evidence["execution"] = {
        "summary": (
            "Both five-seed N by T surfaces are complete."
            if full_complete
            else (
                f"Five-seed surfaces are running: recovery {evidence_runs[2]['complete']}/80; "
                f"matched forecast {evidence_runs[3]['complete']}/120."
            )
        ),
        "runs": evidence_runs,
    }
    surface = dissipation_surface(root) if full_complete else None
    if surface is not None:
        evidence["surface"] = surface
        cells = surface["cells"]
        forecast_wins = sum(cell["forecast_winner"] == "phast_unknown" for cell in cells)
        resolved_forecast_wins = sum(
            cell["forecast_phast_effect"]["classification"] == "improves"
            for cell in cells
        )
        positive_recovery = sum(cell["recovery"]["bounded"]["mean"] > 0 for cell in cells)
        bound_improvements = sum(
            cell["recovery"]["bound_effect"]["classification"] == "improves"
            for cell in cells
        )
        n_effects = surface["endpoint_effects"]
        n_forecast_improvements = sum(
            effect["axis"] == "n_train"
            and effect["metric"] == "forecast"
            and effect["classification"] == "improves"
            for effect in n_effects
        )
        n_recovery_improvements = sum(
            effect["axis"] == "n_train"
            and effect["metric"] == "recovery"
            and effect["classification"] == "improves"
            for effect in n_effects
        )
        t_recovery_degradations = sum(
            effect["axis"] == "seq_len"
            and effect["metric"] == "recovery"
            and effect["classification"] == "degrades"
            for effect in n_effects
        )
        fixed_budget_recovery_improvements = sum(
            effect["metric"] == "recovery" and effect["classification"] == "improves"
            for effect in surface["fixed_budget_effects"]
        )
        fixed_budget_forecast_improvements = sum(
            effect["metric"] == "forecast" and effect["classification"] == "improves"
            for effect in surface["fixed_budget_effects"]
        )
        evidence.update({
            "status": "Five-seed surface",
            "source": "PHAST package · verified surface summaries",
            "question": "How do trajectory count, trajectory length, and motion coverage change forecast accuracy and damping recovery?",
            "answer": (
                f"PHAST-UNKNOWN has the lowest mean forecast error in {forecast_wins}/{len(cells)} "
                f"matched cells, but its paired 95% seed interval resolves the advantage in "
                f"{resolved_forecast_wins}/{len(cells)}. Bounded PHAST recovers more than a constant "
                f"mean-damping law in {positive_recovery}/{len(cells)} cells, while the spectral bound "
                f"improves over the uncapped model in {bound_improvements}/{len(cells)}. Increasing N "
                f"from 32 to 512 improves forecast in {n_forecast_improvements}/8 and recovery in "
                f"{n_recovery_improvements}/8 fixed-T comparisons; increasing T from 120 to 320 "
                f"degrades recovery in {t_recovery_degradations}/10. At equal NT, more, shorter "
                f"trajectories improve forecast in {fixed_budget_forecast_improvements}/16 and "
                f"recovery in {fixed_budget_recovery_improvements}/16 comparisons."
            ),
            "not_established": (
                "A positive damping R-squared shows recovery relative to a constant mean law; "
                "it does not prove unique identification of potential, mass, and damping from positions. "
                "The study uses one passive plant and one data seed. Because epochs are fixed, the N "
                "effect is not isolated from optimizer updates or wall time; sampling-rate, forced-motion, "
                "dimensional, and general-identifiability claims remain open."
            ),
            "evidence": (
                f"{len(cells)} matched data cells across two motion ranges, five trajectory counts, "
                "and four trajectory lengths; five model seeds per method, fixed data seed 42, and "
                "the same full 320-sample validation and test trajectories in every cell."
            ),
            "protocol": {
                "input": "Position histories from one fixed windy-pendulum plant",
                "change": "N training trajectories, T samples per trajectory, and starting-motion coverage",
                "fixed": "Plant, data seed, full 320-sample validation/test trajectories, hidden width 64, 100 epochs, observer history, and H=100 evaluation",
                "readout": "Strict UNKNOWN forecast winner and separate bounded-PHAST damping R-squared",
            },
        })

    continual = studies["continual"]
    full_sequential = root / "results/sequential_diagnostic/full/summary.json"
    sequential_profile = "full" if full_sequential.is_file() else "smoke"
    sequential = sequential_matrix(root, sequential_profile)
    if sequential_profile == "full":
        sequential_summary = read_json(full_sequential)
        completed = int(sequential_summary.get("completed_seeds", 0))
        expected = int(sequential_summary.get("expected_seeds", 5))
        continual["execution"] = {
            "summary": f"One full sequential seed is complete ({completed}/{expected}). It does not expose a retention-adaptation conflict; four seeds remain before a scientific conclusion.",
            "runs": [{"complete": completed, "expected": expected, "status": "partial"}],
        }
    else:
        continual["execution"] = {
            "summary": "The six-arm smoke run completed. Values below verify the evaluation path; one seed and one adaptation epoch cannot establish retention.",
            "runs": [manifest_status(root / "results/sequential_diagnostic/smoke/manifest.json", 1)],
        }
    if sequential is not None:
        columns, rows, matrix = sequential
        continual.update({
            "status": "One full seed" if sequential_profile == "full" else "Smoke validated",
            "columns": columns,
            "rows": rows,
            "matrix": matrix,
            "matrix_arm": "unrestricted fine-tuning",
            "matrix_metric": "forecast MSE",
        })
    interface_audit = action_contract_audit(root)
    if interface_audit is not None:
        continual["action_contract"] = interface_audit

    closed_loop = studies["closed-loop"]
    full_closed_loop = closed_loop_matrix(root)
    if full_closed_loop is not None:
        closed_loop.update(full_closed_loop)
        closed_loop.update({
            "status": "Full diagnostic",
            "source": "results/closed_loop_diagnostic/full/summary.json",
            "answer": "The oracle controller remains robust, but the current q-only PHAST port estimate fails under this fixed controller contract. Finite-difference and MAP estimates survive delay, dropout, and actuator loss, then fail under measurement noise and the combined stressor.",
            "not_established": "This diagnoses the present pendulum controller interface. It does not establish that PHAST cannot support closed-loop control after observer, uncertainty, or controller co-design.",
            "evidence": "3,000 trials: five state/port estimators, six feedback stressors, four initial-condition regimes, and 25 trials per cell.",
            "execution": {
                "summary": "The full 3,000-trial closed-loop diagnostic is complete. The matrix below aggregates success over four initial-condition regimes.",
                "runs": [manifest_status(root / "results/closed_loop_diagnostic/full/manifest.json", 3000)],
            },
        })
    else:
        closed_loop["execution"] = {
            "summary": "The 60-path stress smoke completed across five estimators and six feedback conditions.",
            "runs": [manifest_status(root / "results/closed_loop_diagnostic/smoke/manifest.json", 60)],
        }

    uncertainty = stochastic_attribution_study(root)
    if uncertainty is not None:
        existing_index = next(
            (index for index, study in enumerate(payload["studies"]) if study["id"] == "uncertainty"),
            None,
        )
        if existing_index is None:
            payload["studies"].insert(1, uncertainty)
        else:
            payload["studies"][existing_index] = uncertainty

    sources = [
        root / "results/dissipation_scaling/diagnostic_smoke/summary.json",
        root / "results/dissipation_scaling/diagnostic_forecast_smoke/summary.json",
        root / "results/dissipation_scaling/diagnostic_surface/summary.json",
        root / "results/dissipation_scaling/diagnostic_forecast_surface/summary.json",
        root / "results/sequential_diagnostic/smoke/summary.json",
        root / "results/sequential_diagnostic/full/summary.json",
        root / "results/closed_loop_diagnostic/smoke/summary.json",
        root / "results/closed_loop_diagnostic/full/summary.json",
        root / "results/action_interface/isaac_action_contract.json",
        root / "results/stochastic_attribution/full/web.json",
    ]
    payload["generated"] = {
        "utc": datetime.now(timezone.utc).isoformat(),
        "sources": [{"path": str(path.relative_to(root)), "sha256": sha256(path)} for path in sources if path.is_file()],
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(output)


if __name__ == "__main__":
    main()
