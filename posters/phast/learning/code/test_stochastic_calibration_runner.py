"""Contract tests for the PHAST q-only stochastic-calibration study."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_runner():
    path = REPO_ROOT / "scripts" / "run_stochastic_calibration.py"
    spec = importlib.util.spec_from_file_location("stochastic_calibration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def runner():
    return _load_runner()


def test_full_profile_declares_five_model_seeds_and_long_horizon(runner):
    config = runner.load_config()
    profile = config["profiles"]["full"]
    assert profile["model_seeds"] == [0, 1, 2, 3, 4]
    assert profile["horizons"] == [1, 5, 10, 25, 50, 100, 200]
    assert profile["max_horizon"] == 200
    assert config["primary_coverage"] == pytest.approx(0.8)


def test_condition_grid_changes_process_and_observation_noise_separately(runner):
    config = runner.load_config()
    cells = runner.conditions(config["profiles"]["full"])
    assert len(cells) == 9
    assert {(cell.temperature, cell.observation_noise) for cell in cells} == {
        (theta, sigma)
        for theta in (0.0, 0.05, 0.1)
        for sigma in (0.0, 0.02, 0.05)
    }
    assert {cell.excitation for cell in cells} == {"broad"}


def test_zero_temperature_split_recovers_deterministic_map(runner):
    x = torch.tensor([[0.2, -0.3], [0.7, 0.4]], dtype=torch.float64)

    def deterministic(value):
        return value + torch.tensor([0.1, -0.2], dtype=value.dtype)

    out = runner._thermal_split_step(
        x,
        deterministic_step=deterministic,
        damping=lambda q: torch.ones_like(q),
        temperature=0.0,
        dt=0.05,
        generator=torch.Generator().manual_seed(3),
    )
    assert torch.allclose(out, deterministic(x))


def test_shortest_circular_arcs_cross_the_angle_seam(runner):
    samples = torch.tensor(
        [[3.10, -3.12, 3.08, -3.09], [0.05, -0.03, 0.02, -0.01]],
        dtype=torch.float64,
    )
    truth = torch.tensor([-3.13, 0.01], dtype=torch.float64)
    summary = runner._circular_summary(
        samples,
        truth,
        coverage_levels=[0.5, 0.8, 0.95],
        energy_score_pairings=3,
    )
    assert summary["point_mse"] < 0.01
    assert summary["coverage"]["0.8"] == pytest.approx(1.0)
    assert summary["width"]["0.95"] < 0.2
    assert torch.abs(summary["arc_center"]["0.8"][0]) > 3.0
    assert torch.isfinite(torch.tensor(summary["energy_score"]))


def test_qonly_case_is_reproducible_and_noise_changes_only_observation(runner):
    condition = runner.Condition(temperature=0.05, observation_noise=0.0, excitation="broad")
    kwargs = dict(
        n_trajectories=4,
        context=10,
        max_horizon=12,
        seed=17,
        dt=0.05,
        damping_base=0.3,
        damping_amplitude=0.5,
    )
    states_a, context_a = runner.generate_qonly_case(condition, **kwargs)
    states_b, context_b = runner.generate_qonly_case(condition, **kwargs)
    assert torch.equal(states_a, states_b)
    assert torch.equal(context_a, context_b)

    noisy = runner.Condition(temperature=0.05, observation_noise=0.1, excitation="broad")
    states_noisy, context_noisy = runner.generate_qonly_case(noisy, **kwargs)
    assert torch.equal(states_a, states_noisy)
    assert not torch.equal(context_a, context_noisy)


def test_reliability_boundary_reports_first_failed_declared_horizon(runner):
    method = {
        "metrics": [
            {"horizon": 1, "coverage": {"0.8": {"mean": 0.79}}, "width": {"0.8": {"mean": 0.5}}},
            {"horizon": 5, "coverage": {"0.8": {"mean": 0.76}}, "width": {"0.8": {"mean": 0.8}}},
            {"horizon": 10, "coverage": {"0.8": {"mean": 0.70}}, "width": {"0.8": {"mean": 1.0}}},
        ]
    }
    boundary = runner._reliability_boundary(
        method,
        primary_level=0.8,
        tolerance=0.05,
        uninformative_width=3.14,
    )
    assert boundary["calibrated_through"] == 5
    assert boundary["first_failure_horizon"] == 10
    assert boundary["first_uninformative_horizon"] is None
