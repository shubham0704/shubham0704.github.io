#!/usr/bin/env python3
"""Run a conventional sequential-environment diagnostic for current PHAST.

This study intentionally excludes adaptive structure discovery, parameter growth,
and future-reachability plasticity. It asks whether ordinary freezing, fine-tuning,
replay, oracle block updates, joint retraining, or separate experts can retain a
q-only controlled PHAST model across typed physical changes.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
from typing import Any, Mapping, Optional

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "configs" / "experiments" / "phast_sequential_diagnostic.json"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "results" / "sequential_diagnostic"


class ActionGainPendulumEnv:
    """Typed controlled pendulum whose reported command has a chosen plant gain.

    The inherited simulator applies physical torque ``u_phys``. Reporting
    ``a = u_phys / gain`` makes the observed plant obey ``p_dot = ... + gain*a``
    without duplicating the pendulum dynamics implementation.
    """

    def __init__(self, *, action_gain: float, **kwargs: Any):
        from benchmarks_core.envs.pendulum_v2 import PendulumEnv

        if action_gain <= 0:
            raise ValueError("action_gain must be positive")
        self._base = PendulumEnv(control=True, qonly=True, **kwargs)
        self.action_gain = float(action_gain)
        self.name = self._base.name
        self.physics = self._base.physics

    def rollout(self, cfg):
        batch = self._base.rollout(cfg)
        for split in (batch.train, batch.val, batch.test):
            if split is not None and split.actions is not None:
                split.actions = split.actions / self.action_gain
                split.meta["action_gain"] = self.action_gain
        return batch

    def task(self):
        return self._base.task()

    def viz(self):
        return self._base.viz()


@dataclass(frozen=True)
class EnvironmentRecord:
    id: str
    label: str
    changed_block: str
    registry_name: str


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    return json.loads(path.read_text())


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


def _stable_hash(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=False, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    return result.stdout.strip()


def register_environments(config: Mapping[str, Any], profile: str) -> list[EnvironmentRecord]:
    from phast.benchmarks import RegisteredEnv, get_env, register_env

    settings = config["profiles"][profile]
    source = get_env("windy_pendulum_qonly_control")
    records: list[EnvironmentRecord] = []
    for environment_id in settings["environments"]:
        definition = dict(config["environment_definitions"][environment_id])
        label = str(definition.pop("label"))
        changed_block = str(definition.pop("changed_block"))
        action_gain = float(definition.pop("action_gain"))
        environment = ActionGainPendulumEnv(
            action_gain=action_gain,
            damping="windy",
            torque_scale=2.0,
            torque_clip=5.0,
            dt=0.05,
            **definition,
        )
        registry_name = f"phast_sequential_{environment_id}_qonly_control"
        register_env(RegisteredEnv(
            name=registry_name,
            environment=environment,
            default_models=[str(settings["model"])],
            compatible_models=sorted(set(source.compatible_models) | {str(settings["model"])}),
            description=f"Sequential PHAST diagnostic: {label}.",
            supports_variable_n=False,
            domain_chart=source.domain_chart,
        ))
        records.append(EnvironmentRecord(environment_id, label, changed_block, registry_name))
    return records


def _attach_chart(data: dict[str, Any], chart_spec: Any) -> dict[str, Any]:
    output = dict(data)
    if "actions" in output and "torques" not in output:
        output["torques"] = output["actions"]
    if chart_spec is not None:
        output.setdefault("domain_chart", chart_spec)
    return output


def generate_data(records: list[EnvironmentRecord], settings: Mapping[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    from phast.benchmarks import get_env, rollout_legacy

    generated: dict[str, dict[str, dict[str, Any]]] = {}
    for index, record in enumerate(records):
        env = get_env(record.registry_name)
        data_seed = int(settings["data_seed"]) + 1000 * index
        torch.manual_seed(data_seed)
        np.random.seed(data_seed)
        train, val, test = rollout_legacy(
            env,
            device="cpu",
            n_train=int(settings["n_train"]),
            n_val=int(settings["n_val"]),
            n_test=int(settings["n_test"]),
            seq_len=int(settings["seq_len"]),
        )
        generated[record.id] = {
            "train": _attach_chart(train, env.domain_chart),
            "val": _attach_chart(val, env.domain_chart),
            "test": _attach_chart(test, env.domain_chart),
        }
    return generated


def _model_dimensions(data: Mapping[str, Any]) -> tuple[int, Optional[int]]:
    state_dim = int(data["states"].shape[-1])
    actions = data.get("actions", data.get("torques"))
    action_dim = int(actions.shape[-1]) if isinstance(actions, torch.Tensor) else None
    return state_dim, action_dim


def create_model(
    record: EnvironmentRecord,
    data: Mapping[str, Any],
    config: Mapping[str, Any],
    settings: Mapping[str, Any],
    seed: int,
):
    from benchmarks_core.charts import make_chart
    from phast.benchmarks import get_env, get_model

    torch.manual_seed(seed)
    np.random.seed(seed)
    state_dim, action_dim = _model_dimensions(data)
    model_kwargs = dict(config.get("model_kwargs", {}))
    model = get_model(str(settings["model"])).creator(
        env_name=record.registry_name,
        state_dim=state_dim,
        action_dim=action_dim,
        hidden_dim=int(settings["hidden_dim"]),
        n_layers=int(settings["n_layers"]),
        **model_kwargs,
    )
    chart_spec = get_env(record.registry_name).domain_chart
    if chart_spec is not None:
        model.domain_chart = make_chart(chart_spec)
    if bool(model_kwargs.get("warmstart", False)):
        inner = getattr(model, "model", model)
        if hasattr(inner, "warmstart_from_data"):
            dt = float(data.get("dt", 0.05))
            inner.warmstart_from_data(dict(data), dt=dt)
    return model


def _set_trainable(model, policy: str) -> int:
    if policy == "all":
        for parameter in model.parameters():
            parameter.requires_grad_(True)
    elif policy == "none":
        for parameter in model.parameters():
            parameter.requires_grad_(False)
    else:
        token = {
            "damping": "damping",
            "mass": "mass",
            "input_matrix": "input_matrix",
        }.get(policy)
        if token is None:
            raise ValueError(f"Unknown trainable policy {policy!r}")
        for name, parameter in model.named_parameters():
            parameter.requires_grad_(token in name)
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)


def _concat_data(parts: list[Mapping[str, Any]], limit_per_part: Optional[int] = None) -> dict[str, Any]:
    if not parts:
        raise ValueError("Cannot concatenate an empty data list")
    output: dict[str, Any] = {}
    keys = set().union(*(part.keys() for part in parts))
    for key in keys:
        values = [part.get(key) for part in parts]
        tensors = [value for value in values if isinstance(value, torch.Tensor)]
        if len(tensors) == len(parts) and all(tensor.ndim > 0 for tensor in tensors):
            if limit_per_part is not None:
                tensors = [tensor[:limit_per_part] for tensor in tensors]
            if len({tuple(tensor.shape[1:]) for tensor in tensors}) == 1:
                output[key] = torch.cat(tensors, dim=0)
                continue
        output[key] = next((value for value in values if value is not None), None)
    return output


def train_model(
    model,
    data: Mapping[str, Any],
    task,
    settings: Mapping[str, Any],
    epochs: int,
    policy: str,
) -> dict[str, Any]:
    from benchmarks_core.registry import train_epoch

    n_trainable = _set_trainable(model, policy)
    history: list[float] = []
    if epochs <= 0 or n_trainable == 0:
        return {
            "epochs": 0,
            "trainable_parameters": n_trainable,
            "supported": policy in {"all", "none"} or n_trainable > 0,
            "loss": history,
        }
    optimizer = torch.optim.AdamW(
        [parameter for parameter in model.parameters() if parameter.requires_grad],
        lr=float(settings["learning_rate"]),
        weight_decay=1e-5,
    )
    train_kwargs = {"domain_chart": data["domain_chart"]} if "domain_chart" in data else {}
    for _ in range(int(epochs)):
        history.append(float(train_epoch(
            model,
            task.train_step,
            dict(data),
            optimizer,
            batch_size=int(settings["batch_size"]),
            train_step_kwargs=train_kwargs,
        )))
    return {
        "epochs": int(epochs),
        "trainable_parameters": n_trainable,
        "supported": True,
        "loss": history,
    }


def evaluate_model(model, data: Mapping[str, Any], task, settings: Mapping[str, Any]) -> dict[str, Any]:
    kwargs = {
        "rollout_horizons": tuple(int(value) for value in settings["rollout_horizons"]),
        "rollout_context": int(settings["rollout_context"]),
        "rollout_n": int(settings["rollout_n"]),
    }
    if "domain_chart" in data:
        kwargs["domain_chart"] = data["domain_chart"]
    model.eval()
    with torch.no_grad():
        metrics = dict(task.eval_step(model, dict(data), **kwargs))
        metrics.update(_controlled_rollout_metrics(model, data, settings))
        return _jsonable(metrics)


def _controlled_rollout_metrics(
    model,
    data: Mapping[str, Any],
    settings: Mapping[str, Any],
) -> dict[str, float]:
    """Evaluate takeover rollouts while replaying held-out future commands.

    The context ends at q[k-1]. The first future command is therefore u[k-1],
    which drives the transition q[k-1] -> q[k]. This is a conditional world-
    model forecast: future actions are supplied, but future states are not.
    """
    states = data.get("states")
    actions = data.get("actions", data.get("torques"))
    if not isinstance(states, torch.Tensor) or not isinstance(actions, torch.Tensor):
        raise ValueError("Controlled rollout evaluation requires tensor states and actions")
    if not hasattr(model, "rollout_from_context"):
        raise TypeError(
            f"{type(model).__name__} does not implement action-conditioned rollout_from_context"
        )

    context_len = int(settings["rollout_context"])
    rollout_n = min(int(settings["rollout_n"]), int(states.shape[0]))
    if context_len < 1 or context_len >= int(states.shape[1]):
        raise ValueError(
            f"rollout_context must be in [1, T-1], got {context_len} for T={int(states.shape[1])}"
        )

    context = states[:rollout_n, :context_len]
    metrics: dict[str, float] = {}
    for horizon in sorted({int(value) for value in settings["rollout_horizons"]}):
        if horizon <= 0:
            continue
        target_end = context_len + horizon
        action_start = context_len - 1
        action_end = action_start + horizon
        if target_end > int(states.shape[1]) or action_end > int(actions.shape[1]):
            raise ValueError(
                f"H={horizon} exceeds available controlled rollout: "
                f"states T={int(states.shape[1])}, actions T={int(actions.shape[1])}, "
                f"context={context_len}"
            )
        future_actions = actions[:rollout_n, action_start:action_end]
        predicted = model.rollout_from_context(
            context,
            n_steps=horizon,
            actions=future_actions,
        )
        target = states[:rollout_n, context_len:target_end]
        if predicted.shape != target.shape:
            raise ValueError(
                f"Controlled rollout shape mismatch at H={horizon}: "
                f"predicted={tuple(predicted.shape)}, target={tuple(target.shape)}"
            )
        wrapped_error = torch.atan2(
            torch.sin(predicted - target),
            torch.cos(predicted - target),
        )
        metrics[f"rollout_theta_wrap_mse_h{horizon}"] = float(
            wrapped_error.square().mean().detach().cpu().item()
        )
    return metrics


def _forecast_metric(metrics: Mapping[str, Any]) -> Optional[float]:
    value = metrics.get("rollout_theta_wrap_mse_h100")
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError("Sequential diagnostic requires finite rollout_theta_wrap_mse_h100")
    return float(value)


def _selected_metrics(metrics: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "forecast_error": _forecast_metric(metrics),
        "damping_r2": metrics.get("damping_r2"),
        "next_step_mse": metrics.get("mse"),
        "energy_budget_error": metrics.get("energy_budget_error"),
    }


def _evaluate_row(
    *, arm: str, stage: int, trained_on: str, model, records: list[EnvironmentRecord],
    datasets: Mapping[str, Any], settings: Mapping[str, Any], task,
) -> list[dict[str, Any]]:
    rows = []
    for evaluation_index, evaluation in enumerate(records):
        metrics = evaluate_model(model, datasets[evaluation.id]["test"], task, settings)
        rows.append({
            "arm": arm,
            "stage": stage,
            "trained_on": trained_on,
            "evaluation_index": evaluation_index,
            "evaluation_environment": evaluation.id,
            "metrics": _selected_metrics(metrics),
        })
    return rows


def run_seed(
    config: Mapping[str, Any], profile: str, records: list[EnvironmentRecord],
    datasets: Mapping[str, Any], seed: int,
) -> dict[str, Any]:
    from phast.benchmarks import get_env

    settings = config["profiles"][profile]
    task = get_env(records[0].registry_name).task()
    rows: list[dict[str, Any]] = []
    training: list[dict[str, Any]] = []
    initial_record = records[0]
    initial_data = datasets[initial_record.id]["train"]

    for arm in settings["arms"]:
        if arm == "separate_experts":
            experts = []
            for stage, record in enumerate(records):
                model = create_model(record, datasets[record.id]["train"], config, settings, seed + 100 * stage)
                outcome = train_model(model, datasets[record.id]["train"], task, settings, int(settings["epochs_initial"]), "all")
                experts.append(model)
                training.append({"arm": arm, "stage": stage, "environment": record.id, **outcome})
                for evaluation_index, evaluation in enumerate(records):
                    selected = experts[evaluation_index] if evaluation_index <= stage else model
                    metrics = evaluate_model(selected, datasets[evaluation.id]["test"], task, settings)
                    rows.append({
                        "arm": arm,
                        "stage": stage,
                        "trained_on": record.id,
                        "evaluation_index": evaluation_index,
                        "evaluation_environment": evaluation.id,
                        "seen": evaluation_index <= stage,
                        "metrics": _selected_metrics(metrics),
                    })
            continue

        model = create_model(initial_record, initial_data, config, settings, seed)
        for stage, record in enumerate(records):
            if arm == "joint_offline":
                model = create_model(initial_record, initial_data, config, settings, seed + stage)
                stage_data = _concat_data([datasets[item.id]["train"] for item in records[:stage + 1]])
                epochs = int(settings["epochs_initial"]) + stage * int(settings["epochs_adapt"])
                policy = "all"
            elif stage == 0:
                stage_data = initial_data
                epochs = int(settings["epochs_initial"])
                policy = "all"
            elif arm == "frozen":
                stage_data = datasets[record.id]["train"]
                epochs = 0
                policy = "none"
            elif arm == "finetune":
                stage_data = datasets[record.id]["train"]
                epochs = int(settings["epochs_adapt"])
                policy = "all"
            elif arm == "oracle_block":
                stage_data = datasets[record.id]["train"]
                epochs = int(settings["epochs_adapt"])
                policy = record.changed_block
            elif arm == "replay":
                stage_data = _concat_data(
                    [datasets[item.id]["train"] for item in records[:stage + 1]],
                    limit_per_part=int(settings["replay_per_environment"]),
                )
                epochs = int(settings["epochs_adapt"])
                policy = "all"
            else:
                raise ValueError(f"Unknown arm {arm!r}")

            outcome = train_model(model, stage_data, task, settings, epochs, policy)
            training.append({
                "arm": arm,
                "stage": stage,
                "environment": record.id,
                "policy": policy,
                **outcome,
            })
            rows.extend(_evaluate_row(
                arm=arm,
                stage=stage,
                trained_on=record.id,
                model=model,
                records=records,
                datasets=datasets,
                settings=settings,
                task=task,
            ))

    return {"seed": seed, "rows": rows, "training": training}


def summarize(seed_results: list[Mapping[str, Any]], records: list[EnvironmentRecord]) -> dict[str, Any]:
    arms = sorted({row["arm"] for result in seed_results for row in result["rows"]})
    cells = []
    for arm in arms:
        for stage in range(len(records)):
            for evaluation_index, evaluation in enumerate(records):
                matched = [
                    row for result in seed_results for row in result["rows"]
                    if row["arm"] == arm and row["stage"] == stage
                    and row["evaluation_environment"] == evaluation.id
                ]
                cell = {
                    "arm": arm,
                    "stage": stage,
                    "evaluation_environment": evaluation.id,
                    "seen": evaluation_index <= stage,
                }
                for metric in ("forecast_error", "damping_r2", "next_step_mse", "energy_budget_error"):
                    values = [row["metrics"].get(metric) for row in matched]
                    numeric = [float(value) for value in values if isinstance(value, (int, float)) and math.isfinite(float(value))]
                    cell[metric] = {
                        "mean": float(np.mean(numeric)) if numeric else None,
                        "std": float(np.std(numeric)) if numeric else None,
                        "n": len(numeric),
                    }
                cells.append(cell)

    forgetting = []
    final_stage = len(records) - 1
    for arm in arms:
        for environment_index, environment in enumerate(records):
            history = [
                cell for cell in cells
                if cell["arm"] == arm and cell["evaluation_environment"] == environment.id
                and cell["stage"] >= environment_index and cell["forecast_error"]["mean"] is not None
            ]
            final = next((cell for cell in history if cell["stage"] == final_stage), None)
            if not history or final is None:
                continue
            best = min(float(cell["forecast_error"]["mean"]) for cell in history)
            final_value = float(final["forecast_error"]["mean"])
            forgetting.append({
                "arm": arm,
                "environment": environment.id,
                "best_error_after_learning": best,
                "final_error": final_value,
                "absolute_forgetting": final_value - best,
                "relative_forgetting": final_value / best - 1.0 if best > 0 else None,
            })
    return {"cells": cells, "forgetting": forgetting}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--profile", default="smoke")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--max-seeds", type=int, default=None)
    parser.add_argument("--model-seeds", type=int, nargs="+")
    parser.add_argument("--defer-summary", action="store_true")
    parser.add_argument("--summary-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def _load_current_seed_results(
    output_dir: Path,
    seeds: list[int],
    *,
    config_hash: str,
    script_hash: str,
) -> list[dict[str, Any]]:
    results = []
    for seed in seeds:
        path = output_dir / f"seed_{seed}.json"
        if not path.is_file():
            continue
        result = json.loads(path.read_text())
        provenance = result.get("provenance", {})
        if (
            int(result.get("seed", -1)) == seed
            and provenance.get("config_hash") == config_hash
            and provenance.get("script_hash") == script_hash
        ):
            results.append(result)
    return results


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    if args.profile not in config["profiles"]:
        raise ValueError(f"Unknown profile {args.profile!r}")
    settings = config["profiles"][args.profile]
    torch.set_num_threads(int(settings.get("torch_threads", 1)))
    expected_count = int(settings["seeds"])
    expected_seeds = [int(settings["seed_offset"]) + index for index in range(expected_count)]
    if args.model_seeds and args.max_seeds is not None:
        raise ValueError("Use either --model-seeds or --max-seeds, not both")
    if args.model_seeds:
        selected_seeds = [int(seed) for seed in args.model_seeds]
    elif args.max_seeds is not None:
        selected_seeds = expected_seeds[: max(0, int(args.max_seeds))]
    else:
        selected_seeds = expected_seeds
    undeclared = sorted(set(selected_seeds) - set(expected_seeds))
    if undeclared:
        raise ValueError(f"Seeds are not declared by profile {args.profile!r}: {undeclared}")
    records = register_environments(config, args.profile)
    print(
        f"Profile {args.profile}: {len(records)} environments, "
        f"{len(settings['arms'])} arms, seeds {selected_seeds}"
    )
    print("Sequence: " + " -> ".join(record.id for record in records))
    if args.dry_run:
        return 0

    output_dir = args.output_root / args.profile
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    config_hash = _stable_hash(config)
    script_hash = _file_hash(Path(__file__).resolve())

    if not args.summary_only:
        datasets = generate_data(records, settings)
        try:
            for seed in selected_seeds:
                seed_path = output_dir / f"seed_{seed}.json"
                current = _load_current_seed_results(
                    output_dir,
                    [seed],
                    config_hash=config_hash,
                    script_hash=script_hash,
                )
                if current and not args.force:
                    print(f"[skip seed {seed}] {seed_path.name}")
                    continue
                print(f"[seed {seed}] sequential diagnostic")
                result = run_seed(config, args.profile, records, datasets, seed)
                result["provenance"] = {
                    "generated_utc": datetime.now(timezone.utc).isoformat(),
                    "config_hash": config_hash,
                    "script_hash": script_hash,
                    "git_commit": _git("rev-parse", "HEAD"),
                    "git_dirty": bool(_git("status", "--short")),
                }
                _write_json(seed_path, result)
        except KeyboardInterrupt:
            print("Interrupted; completed seed files remain resumable.")
            return 130

    if args.defer_summary:
        completed = _load_current_seed_results(
            output_dir,
            expected_seeds,
            config_hash=config_hash,
            script_hash=script_hash,
        )
        print(f"Deferred aggregation; {len(completed)}/{expected_count} current seed files exist.")
        return 0

    seed_results = _load_current_seed_results(
        output_dir,
        expected_seeds,
        config_hash=config_hash,
        script_hash=script_hash,
    )
    summary = summarize(seed_results, records) if seed_results else {"cells": [], "forgetting": []}
    payload = {
        "schema_version": 2,
        "profile": args.profile,
        "question": config["title"],
        "environments": [record.__dict__ for record in records],
        "arms": list(settings["arms"]),
        "settings": settings,
        "completed_seeds": len(seed_results),
        "expected_seeds": expected_count,
        "model_seeds": [int(result["seed"]) for result in seed_results],
        "provenance": {
            "generated_utc": datetime.now(timezone.utc).isoformat(),
            "config_hash": config_hash,
            "script_hash": script_hash,
        },
        "summary": summary,
    }
    _write_json(output_dir / "summary.json", payload)
    is_complete = len(seed_results) == expected_count
    manifest = {
        "status": "complete" if is_complete else "partial",
        "completed_utc": datetime.now(timezone.utc).isoformat() if is_complete else None,
        "config_hash": config_hash,
        "script_hash": script_hash,
        "profile": args.profile,
        "git_commit": _git("rev-parse", "HEAD"),
        "git_dirty": bool(_git("status", "--short")),
        "selected_seeds": selected_seeds,
        "completed_seeds": len(seed_results),
        "expected_seeds": expected_count,
        "summary": "summary.json",
        "benchmark_apis": [
            "phast.benchmarks.rollout_legacy",
            "phast.benchmarks.get_model",
            "benchmarks_core.registry.train_epoch",
            "Environment.task().eval_step",
            "PHASTQOnlyModel.rollout_from_context(actions=...)",
        ],
    }
    _write_json(manifest_path, manifest)
    print(f"Recorded {len(seed_results)}/{expected_count} seeds -> {output_dir / 'summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
