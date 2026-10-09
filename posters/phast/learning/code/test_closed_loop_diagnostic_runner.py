from __future__ import annotations

import importlib.util
from pathlib import Path

import torch

from phast.benchmarks.control.casimir.benchmark_casimir_phast import TruePendulum


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "run_phast_closed_loop_diagnostic.py"


def _load_runner():
    spec = importlib.util.spec_from_file_location("closed_loop_diagnostic", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ConstantController:
    def __call__(self, q, p):
        return torch.ones_like(q)


def test_delay_and_dropout_are_deterministic_and_finite():
    plant = TruePendulum()
    kwargs = dict(
        q0=torch.tensor(0.4),
        p0=torch.tensor(0.1),
        n_steps=20,
        controller=ConstantController(),
        measurement_noise_std=0.02,
        measurement_delay_steps=3,
        measurement_dropout_probability=0.25,
    )
    first_gen = torch.Generator().manual_seed(7)
    second_gen = torch.Generator().manual_seed(7)
    first = plant.simulate(**kwargs, noise_generator=first_gen)
    second = plant.simulate(**kwargs, noise_generator=second_gen)
    assert torch.isfinite(first["q"]).all()
    assert torch.equal(first["q"], second["q"])


def test_actuator_gain_scales_applied_but_not_commanded_effort():
    initial = dict(q0=torch.tensor(0.0), p0=torch.tensor(0.0), n_steps=5, controller=ConstantController())
    nominal = TruePendulum(actuator_gain=1.0).simulate(**initial)
    weak = TruePendulum(actuator_gain=0.5).simulate(**initial)
    assert torch.equal(nominal["u_command"], weak["u_command"])
    assert torch.allclose(weak["u"], 0.5 * nominal["u"])
    assert not torch.equal(nominal["p"], weak["p"])


def test_smoke_profile_declares_all_feedback_stressors():
    runner = _load_runner()
    config = runner.json.loads(runner.DEFAULT_CONFIG.read_text())
    assert config["profiles"]["smoke"]["stressors"] == [
        "nominal", "noise", "delay", "dropout", "actuator_loss", "combined"
    ]


def test_threshold_profile_varies_one_feedback_factor_at_a_time():
    runner = _load_runner()
    config = runner.json.loads(runner.DEFAULT_CONFIG.read_text())
    settings = config["profiles"]["thresholds"]
    records = runner.declared_stressors(config, settings)

    assert len(records) == 29
    for _, stressor in records:
        changed = sum((
            stressor["measurement_noise_std"] != 0.0,
            stressor["measurement_delay_steps"] != 0,
            stressor["measurement_dropout_probability"] != 0.0,
            stressor["actuator_gain"] != 1.0,
        ))
        assert changed <= 1
    assert settings["reliability_target"] == 0.8


def test_threshold_summary_uses_intervals_not_only_point_estimates():
    runner = _load_runner()
    rows = []
    for method, successes in (("strong", 100), ("weak", 60)):
        for trial in range(100):
            rows.append({
                "axis": "noise",
                "level": 0.0,
                "severity_index": 0,
                "method": method,
                "success": trial < successes,
                "final_error_regret": 0.0 if method == "strong" else 1.0,
                "velocity_error_mean": 0.0,
                "casimir_drift": 0.0,
            })
    summary = runner._threshold_summary(rows, 0.8)
    by_method = {cell["method"]: cell for cell in summary["cells"]}

    assert by_method["strong"]["conclusion"] == "reliable"
    assert by_method["weak"]["conclusion"] == "unreliable"
    assert by_method["strong"]["wilson_95"][0] > 0.8
    assert by_method["weak"]["wilson_95"][1] < 0.8
    assert by_method["weak"]["final_error_regret_mean"] == 1.0


def test_one_axis_partition_preserves_the_full_cell_contract():
    runner = _load_runner()
    config = runner.json.loads(runner.DEFAULT_CONFIG.read_text())
    settings = dict(config["profiles"]["thresholds"])
    settings["sweeps"] = ["measurement_delay"]
    records = runner.declared_stressors(config, settings)

    assert len(records) == len(config["sweeps"]["measurement_delay"]["levels"])
    assert {item[1]["axis"] for item in records} == {"measurement_delay"}
