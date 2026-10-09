PHAST learning-study scripts
============================

This folder contains the exact exporter, diagnostic runners, package stochastic
transition, tests, and experiment configurations referenced by the interactive
PHAST learning study.

The scripts are snapshots from the CVC-Lab/phast branch
`closed-loop-phast-e0`. They expect the full PHAST package, its benchmark
dependencies, and the result/checkpoint directories named in each script.
The page's JSON files are the portable outputs needed to inspect every
displayed result without installing the training environment.

Files
-----
- export_phast_learning_gallery.py: regenerates the displayed rollout JSON
  from frozen checkpoints.
- run_phast_dissipation_scaling.py: executes the dissipation scaling matrix
  through phast.benchmarks.run_benchmark. Variant, excitation, N, and T filters
  plus --defer-summary permit disjoint parallel workers. Use --n-train-values
  and --seq-len-values to partition the matrix without overlapping cells.
- phast_dissipation_scaling.json: defines the crossed experiment profiles. The
  protocol-v2 diagnostic surfaces use nested training prefixes and fixed split
  seeds. Every validation and test trajectory retains 320 samples in every
  cell, so N and T change training evidence without changing held-out support.
- run_stochastic_calibration.py: evaluates frozen bounded PHAST-PARTIAL
  checkpoints under separate process-temperature and observation-noise sweeps.
  It compares initial-state propagation, calibrated FDT propagation, and an
  oracle stochastic plant using circular energy score and shortest predictive
  arcs through H=200.
- phast_stochastic_calibration.json: fixes the five checkpoint seeds, nine noise
  cells, 128 test trajectories, 64 particles, and seven evaluation horizons.
- phast_stochastic.py: snapshot of the package-level Itô transition,
  Euler--Maruyama step, and stochastic energy-ledger API called by the runner.
- test_stochastic_calibration_runner.py: contract tests for the grid, q-only
  data path, deterministic null, circular intervals, and reliability boundary.
- run_phast_sequential_diagnostic.py: trains six conventional update policies
  through nominal, damping, inertia, and actuation environments. Evaluation
  uses PHASTQOnlyModel.rollout_from_context with held-out future commands; it
  never substitutes one-step error for the declared H=100 forecast.
- phast_sequential_diagnostic.json: freezes the environment order, five model
  seeds, update budgets, context K=10, and rollout horizons through H=100.
- test_sequential_diagnostic_runner.py: checks command semantics, action
  indexing at the context boundary, unsupported input-map updates, and stale
  result rejection.
- run_phast_closed_loop_diagnostic.py: reuses the package Energy--Casimir trial
  implementation to sweep one feedback stressor at a time. It reports paired
  regret and Wilson intervals around the predeclared 80% reliability target.
- phast_closed_loop_diagnostic.json: defines noise, delay, sample-hold dropout,
  and actuator-gain sweeps for one frozen controller and observer stack.
- test_closed_loop_diagnostic_runner.py: verifies deterministic stress injection,
  one-factor sweeps, actuator semantics, and interval-based decisions.
- test_external_stochastic_port.py: checks separated thermal/external covariance,
  Itô generator and energy-ledger terms, and Euler--Maruyama scaling.

Primary surface profiles
------------------------
- diagnostic_surface: bounded versus uncapped PHAST-PARTIAL recovery.
- diagnostic_forecast_surface: PHAST-UNKNOWN versus pHNN and S5 forecasting.

Run every experiment from the PHAST checkout in the math conda environment.

Stochastic calibration
----------------------
Run one seed at a time (the seeds may be dispatched in parallel), then aggregate:

  conda run -n math python scripts/run_stochastic_calibration.py --profile full --model-seeds 0 --defer-summary
  conda run -n math python scripts/run_stochastic_calibration.py --profile full --summary-only

Sequential environments
-----------------------
Run one model seed per worker, then aggregate only hash-current artifacts:

  conda run -n math python scripts/run_phast_sequential_diagnostic.py --profile full --model-seeds 0 --defer-summary
  conda run -n math python scripts/run_phast_sequential_diagnostic.py --profile full --summary-only

Closed-loop thresholds
----------------------
Run one axis per worker, then merge only complete parts whose config and script
hashes match the current files:

  conda run -n math python scripts/run_phast_closed_loop_diagnostic.py --profile thresholds --axes measurement_noise
  conda run -n math python scripts/run_phast_closed_loop_diagnostic.py --profile thresholds --axes measurement_delay
  conda run -n math python scripts/run_phast_closed_loop_diagnostic.py --profile thresholds --axes measurement_dropout
  conda run -n math python scripts/run_phast_closed_loop_diagnostic.py --profile thresholds --axes actuator_gain
  conda run -n math python scripts/run_phast_closed_loop_diagnostic.py --profile thresholds --merge-parts

Omit --axes to run all four sweeps in one process.
