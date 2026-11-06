# C-PHAST: Claim-to-Evidence Audit

6 November 2026. Read-only source inspection for a separate research-page preview.
No scientific experiments, training, calibration, integrator changes, or paper edits.
The copied paper is identified by SHA256 in provenance.json. Page references use
that copied PDF, not a future arXiv revision.

## What Changed in the Website

Before: generic C-PHAST heading; separate electrical/robotics tabs; the full paper
title, abstract, authors, moving Spot footage, and theorem-evidence map were absent.

After: exact paper identity and source-derived abstract; four contribution links;
shared learn/connect/predict explanation; electrical anchor; supporting robot
transfer and hardware studies; explicit theorem checks and open questions.
The prior preview and published site are preserved. No result is replaced or pooled.

## Contributions

### Frozen attachment update

The primary interactive experiment now uses the completed
`attachment_original_models_20261106` campaign: all 12 scenarios, both attachments,
and five fits for each unchanged model. All 360 attempts remain accessible.
The 400 mA corridor and 800 mA other-line screens, voltage window, 20-second horizon,
and peak-utilization ranking are taken from its frozen protocol. The default
80% / 1.45x scenario was preselected before learned-model evaluation, not chosen
by searching for a favorable comparison.

C-PHAST: 120/120 qualified paths and 60/60 correct choices. cPHNN: 120/120 and
55/60. N-PHDAE: 38/120 and 18/60, with 42 abstained pairs. Its 80 state-conversion
failures are separate from its two upstream propagation-time consistency failures.
At the default corner, N-PHDAE fit 3 completes B and predicts 633.67 mA versus the
404.54 mA reference: correct rejection, inaccurate trajectory. No N-PHDAE false
accept is manufactured or implied. Failed pairs do not become reject-both decisions.

The export is saved-array playback only. Plot thinning retains all-channel extrema
and endpoints; full-resolution audited metrics determine decisions. Partial
trajectories stop at the last saved point. All raw data, checkpoints, protocols,
paper/slides and published-site files remain unchanged. The earlier corrected-model
walkthrough remains separately labeled. The new study uses different existing
training data/budgets and does not replace the paper's component-only result.

Sources: `attachment-data/protocol.json`, `attachment-data/verification.json`,
`attachment-data/all-outcomes.csv`, `attachment-preservation.json`.

| Paper contribution | Website evidence | Boundary |
| --- | --- | --- |
| Predict proposed systems from reusable laws | Electrical attachment tutorial, method, supplied-state study, separate history-inference results | Learned nonlinear laws, voltage-only initialization, and certified reconfiguration are not all validated in one experiment. |
| Interconnection creates emergent properties | Theorems 3.2 and 3.4; retained dissipation and inference audits | Benefits require conditions. The tested learned-DGU rewiring benefit was negative; the positive sensing result uses known laws. |
| Reliable comparisons under prediction uncertainty | Known-law nine-command certificate explorer; shared-uncertainty rewiring bounds | Bounds are not certificates for the learned robot or learned electrical studies. |
| Evidence of reuse across changed systems | Component-only electrical comparison, ANYmal-D to Go2 transfer, planar-arm count changes | Different protocols answer different questions; no pooled ranking. Spot supports physical readouts, not transferred PHASTCore dynamics. |

## Theorem and Proposition Coverage

### Theorem 3.1: Power-preserving interconnection
The paper recalls the skew-cancellation identity (page 8). The construction is
not itself a novel empirical result. Collocation and compatible port pairing
matter. Discrete balance needs separate numerical assumptions.

### Theorem 3.2 and its strict-benefit corollary
Known linear-quadratic expected-dissipation statement, page 17, with analytic
examples and counterexamples in Appendix B. The retained local-checkpoint audit
establishes a small local decay region for one learned DGU model. The expanded
wiring audit establishes negative leading-order expected benefit for each of
three alternative receiving buses relative to its baseline.

Missing: a positive learned-law application witness in this frozen family.
Do not present its absence as a theorem refutation, global instability, or
failure of every possible graph. It also does not establish physical-plant
validation or nonlinear ordering over a large state region.

Sources: sources/local-decay-audit.txt; sources/dissipation-audit.txt.

### Theorem 3.4 and hidden-mode corollary
Known-linear Gaussian initial-state inference, page 18; full observability is
not required for a particular target. Priors and sampling matter.

The saved triangle/parallel-line study reports 20.8-31.1% lower expected risk
for the same initial-current target, with the same voltage sensors. All four
conditions have positive paired empirical MSE contrasts; both native step sizes
and an independent numerical checker pass. The 384 reused episodes, not 9,216
analysis outcomes, are the independent sampling units. Both graphs have rank
8 of 9; a different hidden mode remains after rewiring.

Missing: validation of a learned nonlinear initializer, continuous-Brownian
observation extension, physical switching, and hardware sensing benefit.

Source: sources/inference-audit.txt. This is supplemental workspace evidence;
it has not been silently added to the paper.

### Theorem D.1: Finite-step balance defect
Paper pages 62-63 include an untrained known-oscillator implementation test.
Reported local slopes are 2.99, 1.98, and approximately 3.0-3.4 for the specified
conservative, left-endpoint, and trapezoidal cases. This supports scaling in the
tested regime, not exact energy conservation or unconditional discrete passivity.

### Proposition D.2: Electrical solver-error extension
Paper page 63. The separate current-code audit records 1,920 completed learned
rollouts and 30 known-law conditions; no fit was discarded. Solver tightening
has little effect on the tested predictions. Phase, nonquadratic energy,
unequal-storage coupling, stiff damping, and peak-sampling controls expose
limitations that prediction RMSE alone would miss.

The explicit-midpoint coupling path is not implicit midpoint. Continuous
cancellation and finite-step conservation must not be conflated. The audit does
not establish universal stability, contact behavior, or exact energy balance.

Sources: sources/energy-balance.tex; sources/integrator-audit.md.

### Theorems E.2 and E.4: Deployment-error transfer
Paper pages 67 onward. A known affine oscillator supplies 3,000 rollouts of
horizon 200 with the declared observation/noise construction. All reported
coverages are 1.000; bounds are conservative (roughly 17-18x and 6-7x empirical
quantiles for the two constructions). Finite sampling is a diagnostic, not a
certificate. This is not a learned nonlinear uncertainty-calibration result.

Source: sources/transfer-check.tex. Certified readout constants and map-error
bounds are additional requirements, not estimated test-set averages.

### Theorem F.2, related channel/feasibility/regret statements
Paper pages 71 onward. The known-law three-DGU certificate example has nine
source-voltage candidates, outward interval arithmetic, 11,529 candidate-vertex
checks, and an independent adaptive-ODE comparison. The interval argument,
not the finite checks, establishes the box-wide result. Limits are synthetic
sampled-current thresholds, not certified hardware ratings.

Missing: validated joint envelopes for the learned-model/partial-history case,
intersample overload certification, and repeated closed-loop execution.

Source: sources/decision-check.tex. The website's bounds explorer uses this
fixed-topology command study, not the separate topology-comparison table.

### Appendix F.4: Paired candidate-difference enclosure
Known affine flow, affine state assignments and quadratic scores. The 18
topology/command candidates give 81 cross-graph pairs. At radius 0.05 and the
same 2 A screen, paired bounds resolve 74/81 versus 62/81 separate polynomial
bounds (56/81 raw state-box bounds). Twelve exact-rational regression tests and
756 finite reference paths check implementation; they do not replace validated
outward arithmetic. The full table is on paper page 81.

Source: sources/paired-bounds.tex. Missing: learned-law and nonlinear remainder
certificates. No claim of tighter feasibility or superior trained-model accuracy.

## Hardware and Baseline Integrity

- Spot video is real teleoperated hardware footage. Reported predictors map
  summaries directly to consequences; neither advances PHASTCore nor transfers
  its dynamics weights. Some descriptors come from the executed future.
- Spot fixed-split results contain 173 overlapping held-out windows from two
  bags, not 173 independent trials. Six-fold score agreement is lower than the
  fixed-split value. Exact energetic-ensemble retraining remains unverified:
  checkpoints, resolved settings and stopping epochs were not retained.
- Battery draw means mean discharge current, not electrical energy.
- The original-model supplied-state comparison retains N-PHDAE fit 2 and the
  33/40 completion count. No successful-only pooled five-fit error is invented.
- The existing electrical interactive tutorial uses the separately calibrated,
  corrected N-PHDAE arm. That is stated at its entry. It is not the headline
  component-only or original-model comparison and is never pooled with either.
- Robot footage illustrates the simulated experiments. Transfer means dynamics
  prediction, not transfer of a deployed locomotion controller.
- Component-count transfer includes untrained new dense coupling entries; it
  does not establish learned arbitrary interfaces, friction, or joint limits.

## Next Evidence, Not New Claims

1. One frozen joint study combining learned laws, partial-history initialization,
   unseen attachment and independently evaluated decisions. This closes the
   central untested conjunction explicitly acknowledged by the paper.
2. A theorem-linked positive dissipation example whose assumptions and outcome
   are visible, while retaining the negative learned-model rewiring audit.
3. A compact recorded visual for the existing same-sensor inference audit,
   showing both the recovered target and the remaining hidden mode.
4. Prospective Spot inputs and episode-level validation before claims about
   live hardware decisions; retain complete retraining provenance.

These are proposed evidence improvements, not authorized or executed runs.
