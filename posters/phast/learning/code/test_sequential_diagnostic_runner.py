import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_runner():
    path = REPO_ROOT / "scripts" / "run_phast_sequential_diagnostic.py"
    spec = importlib.util.spec_from_file_location("sequential_diagnostic", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _config():
    return json.loads(
        (REPO_ROOT / "configs" / "experiments" / "phast_sequential_diagnostic.json").read_text()
    )


def test_action_gain_changes_command_semantics_without_changing_plant_rollout():
    from benchmarks_core.api import RolloutConfig

    runner = _load_runner()
    kwargs = dict(
        damping="windy", b_base=0.3, b_amplitude=0.5,
        torque_scale=2.0, torque_clip=5.0, dt=0.05, m=1.0, L=1.0,
    )
    nominal = runner.ActionGainPendulumEnv(action_gain=1.0, **kwargs)
    changed = runner.ActionGainPendulumEnv(action_gain=0.5, **kwargs)
    cfg = RolloutConfig(n_train=4, n_val=2, n_test=2, seq_len=30, device="cpu")

    torch.manual_seed(42)
    np.random.seed(42)
    nominal_batch = nominal.rollout(cfg)
    torch.manual_seed(42)
    np.random.seed(42)
    changed_batch = changed.rollout(cfg)

    assert torch.equal(nominal_batch.train.observations, changed_batch.train.observations)
    assert torch.allclose(changed_batch.train.actions, 2.0 * nominal_batch.train.actions)


def test_oracle_block_policy_exposes_fixed_input_map_ceiling():
    runner = _load_runner()
    config = _config()
    records = runner.register_environments(config, "smoke")
    datasets = runner.generate_data(records, config["profiles"]["smoke"])
    model = runner.create_model(
        records[0], datasets[records[0].id]["train"], config,
        config["profiles"]["smoke"], seed=0,
    )

    assert runner._set_trainable(model, "damping") > 0
    assert runner._set_trainable(model, "mass") > 0
    assert runner._set_trainable(model, "input_matrix") == 0


def test_zero_parameter_oracle_policy_is_marked_unsupported():
    runner = _load_runner()
    model = torch.nn.Linear(1, 1)
    outcome = runner.train_model(
        model,
        {"states": torch.zeros(1, 2, 1)},
        task=None,
        settings={"learning_rate": 1e-3, "batch_size": 1},
        epochs=5,
        policy="input_matrix",
    )
    assert outcome["trainable_parameters"] == 0
    assert outcome["epochs"] == 0
    assert outcome["supported"] is False


def test_smoke_contract_names_all_conventional_arms():
    config = _config()
    settings = config["profiles"]["smoke"]

    assert settings["environments"] == ["nominal", "damping", "inertia", "actuation"]
    assert set(settings["arms"]) == {
        "frozen", "finetune", "oracle_block", "replay", "joint_offline", "separate_experts",
    }


def test_typed_actions_are_aliased_for_the_legacy_control_task():
    runner = _load_runner()
    actions = torch.ones(2, 3, 1)
    output = runner._attach_chart({"states": torch.zeros(2, 3, 1), "actions": actions}, None)

    assert output["torques"] is actions


def test_seed_artifact_round_trips_for_resumption(tmp_path):
    runner = _load_runner()
    path = tmp_path / "seed_0.json"
    runner._write_json(path, {"seed": 0, "rows": [], "training": []})

    assert json.loads(path.read_text())["seed"] == 0


def test_seed_resumption_requires_matching_config_and_script_hash(tmp_path):
    runner = _load_runner()
    runner._write_json(
        tmp_path / "seed_0.json",
        {
            "seed": 0,
            "rows": [],
            "training": [],
            "provenance": {"config_hash": "config", "script_hash": "script"},
        },
    )
    assert len(runner._load_current_seed_results(
        tmp_path, [0], config_hash="config", script_hash="script"
    )) == 1
    assert not runner._load_current_seed_results(
        tmp_path, [0], config_hash="config", script_hash="stale"
    )


class _CommandDrivenRollout(torch.nn.Module):
    def rollout_from_context(self, context, *, n_steps, actions):
        q = context[:, -1]
        predictions = []
        for step in range(n_steps):
            q = q + actions[:, step]
            predictions.append(q)
        return torch.stack(predictions, dim=1)


def test_controlled_rollout_replays_future_actions_at_the_context_boundary():
    runner = _load_runner()
    actions = torch.arange(1.0, 8.0).reshape(1, 7, 1)
    states = torch.cat(
        [torch.zeros(1, 1, 1), actions.cumsum(dim=1)],
        dim=1,
    )
    metrics = runner._controlled_rollout_metrics(
        _CommandDrivenRollout(),
        {"states": states, "actions": actions},
        {"rollout_context": 3, "rollout_n": 1, "rollout_horizons": [1, 5]},
    )

    assert metrics["rollout_theta_wrap_mse_h1"] == 0.0
    assert metrics["rollout_theta_wrap_mse_h5"] == 0.0


def test_forecast_metric_rejects_one_step_fallback():
    runner = _load_runner()
    try:
        runner._forecast_metric({"mse": 0.0, "theta_wrap_mse": 0.0})
    except ValueError as error:
        assert "rollout_theta_wrap_mse_h100" in str(error)
    else:
        raise AssertionError("One-step metrics must not masquerade as H=100 rollout error")
