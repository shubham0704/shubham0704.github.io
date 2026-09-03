#!/usr/bin/env python3
"""Build the PHAST learning-page scaling payload from completed run artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from pathlib import Path


FORECAST_VARIANTS = (
    "phast_partial_bounded",
    "phast_no_damping",
    "phast_unknown",
    "phnn_observer",
    "s5",
)

METHODS = {
    "phast_partial_bounded": {
        "label": "Bounded PHAST",
        "family": "PHAST-PARTIAL",
        "contract": "Position history plus declared potential, mass, chart, damping floor, and damping cap.",
    },
    "phast_no_damping": {
        "label": "PHAST without damping",
        "family": "PHAST ablation",
        "contract": "The PHAST-UNKNOWN architecture with the damping channel removed.",
    },
    "phast_unknown": {
        "label": "PHAST-UNKNOWN",
        "family": "PHAST",
        "contract": "Position history and coordinate chart; all physical components are learned.",
    },
    "phnn_observer": {
        "label": "pHNN observer",
        "family": "Structured baseline",
        "contract": "Position history and coordinate chart; learned Hamiltonian and PSD damping.",
    },
    "s5": {
        "label": "S5",
        "family": "Sequence baseline",
        "contract": "Position history; no supplied physical components.",
    },
    "transformer": {
        "label": "Transformer",
        "family": "Sequence baseline",
        "contract": "Position history; no supplied physical components.",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--phast-root",
        type=Path,
        required=True,
        help="Root of the phast_cvc_lab checkout containing results/.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/posters/phast/learning/data/scaling.json"),
    )
    return parser.parse_args()


def read_json(path: Path):
    if not path.is_file():
        raise FileNotFoundError(path)
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cell_key(row: dict) -> tuple[str, int, int]:
    return row["excitation"], int(row["n_train"]), int(row["hidden_dim"])


def compact_metric(row: dict, stem: str) -> dict[str, float]:
    return {
        "mean": float(row[f"{stem}_mean"]),
        "std": float(row[f"{stem}_std"]),
    }


def build_forecast_and_recovery(pilot: list[dict], bounded: list[dict]) -> tuple[list[dict], list[dict]]:
    pilot_index = {(cell_key(row), row["variant"]): row for row in pilot}
    bounded_index = {cell_key(row): row for row in bounded}
    cells = sorted(bounded_index)
    forecast = []
    recovery = []

    for excitation, n_train, hidden_dim in cells:
        key = excitation, n_train, hidden_dim
        bounded_row = bounded_index[key]
        values = []
        for variant in FORECAST_VARIANTS:
            row = bounded_row if variant == "phast_partial_bounded" else pilot_index[(key, variant)]
            values.append({
                "method": variant,
                **compact_metric(row, "test_rollout_theta_wrap_mse_h100"),
            })
        forecast.append({
            "excitation": excitation,
            "n_train": n_train,
            "hidden_dim": hidden_dim,
            "values": values,
        })

        uncapped = pilot_index[(key, "phast_partial")]
        recovery.append({
            "excitation": excitation,
            "n_train": n_train,
            "hidden_dim": hidden_dim,
            "bounded": {
                **compact_metric(bounded_row, "test_damping_r2"),
                "mae": compact_metric(bounded_row, "test_damping_mae"),
            },
            "uncapped": {
                **compact_metric(uncapped, "test_damping_r2"),
                "mae": compact_metric(uncapped, "test_damping_mae"),
            },
        })
    return forecast, recovery


def reviewer_run_dir(root: Path, method: str, epochs: int) -> Path:
    suffix = "__constant" if method == "phast_unknown_qonly" else ""
    return root / f"windy_pendulum_qonly__{method}__e{epochs}{suffix}"


def build_optimization(root: Path) -> list[dict]:
    method_aliases = {
        "phast_unknown_qonly": "phast_unknown",
        "phnn_observer_qonly": "phnn_observer",
        "s5": "s5",
        "transformer": "transformer",
    }
    output = []
    for raw_method, method in method_aliases.items():
        for epochs in (50, 100, 200):
            path = reviewer_run_dir(root, raw_method, epochs) / "results.json"
            result = read_json(path)[raw_method]
            if len(result) != 5:
                raise ValueError(f"Expected five seeds in {path}, found {len(result)}")
            values = [float(seed["test_metrics"]["rollout_theta_wrap_mse_h100"]) for seed in result]
            output.append({
                "method": method,
                "epochs": epochs,
                "mean": statistics.mean(values),
                "std": statistics.stdev(values),
                "n": len(values),
                "median_best_epoch": statistics.median(int(seed["best_epoch"]) for seed in result),
            })
    return output


def main() -> None:
    args = parse_args()
    phast_root = args.phast_root.resolve()
    pilot_path = phast_root / "results/dissipation_scaling/pilot/summary.json"
    bounded_path = phast_root / "results/dissipation_scaling/bounded_pilot/summary.json"
    reviewer_root = phast_root / "results/reviewer_studies/full/convergence"

    pilot = read_json(pilot_path)
    bounded = read_json(bounded_path)
    forecast, recovery = build_forecast_and_recovery(pilot, bounded)
    optimization = build_optimization(reviewer_root)

    payload = {
        "study": {
            "title": "When does PHAST recover dissipation?",
            "system": "Windy pendulum",
            "data_seed": 42,
            "model_seeds": 3,
            "trajectory_length": 160,
            "history": 10,
            "horizon": 100,
            "pilot_epochs": 50,
            "damping_floor": 0.3,
            "damping_variation_cap": 0.5,
            "excitation": {
                "narrow": "Small starting angular momentum; scale 0.35.",
                "broad": "Large starting angular momentum; scale 4.0. The pendulum visits a wider range of states.",
            },
        },
        "methods": METHODS,
        "forecast": forecast,
        "recovery": recovery,
        "optimization": {
            "system": "Windy pendulum",
            "n_train": 1000,
            "model_seeds": 5,
            "values": optimization,
        },
        "provenance": {
            "api": "phast.benchmarks.run_benchmark",
            "forecast_source": str(pilot_path.relative_to(phast_root)),
            "bounded_source": str(bounded_path.relative_to(phast_root)),
            "optimization_source": str(reviewer_root.relative_to(phast_root)),
            "source_sha256": {
                str(pilot_path.relative_to(phast_root)): sha256(pilot_path),
                str(bounded_path.relative_to(phast_root)): sha256(bounded_path),
            },
            "note": "The 50-epoch scaling study and the 50/100/200-epoch optimization study use separate matched protocols and are displayed separately.",
        },
    }

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(output)


if __name__ == "__main__":
    main()
