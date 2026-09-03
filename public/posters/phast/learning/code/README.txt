PHAST learning-study scripts
============================

This folder contains the exact exporter, scaling runner, and experiment
configuration referenced by the interactive PHAST learning study.

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

Primary surface profiles
------------------------
- diagnostic_surface: bounded versus uncapped PHAST-PARTIAL recovery.
- diagnostic_forecast_surface: PHAST-UNKNOWN versus pHNN and S5 forecasting.

Run every experiment from the PHAST checkout in the math conda environment.
