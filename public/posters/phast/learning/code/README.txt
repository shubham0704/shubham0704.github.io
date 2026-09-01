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
- run_phast_dissipation_scaling.py: executes the dissipation scaling matrix.
- phast_dissipation_scaling.json: defines the crossed experiment profiles.
