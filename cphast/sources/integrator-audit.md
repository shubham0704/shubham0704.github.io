# What the Integrator Audit Says

**The tested DGU predictions do not justify replacing the integrator. The useful next steps are convergence reporting and resolution checks for peaks, together with accurate finite-step claims.**

All 1,920 numerical rollouts completed: five frozen fits, two saved connections,
16 starts, three input amplitudes, and four numerical settings. Fit 2 was
retained. The learned sweep took 23.3 minutes on one numerical worker in the
`math` environment. No training, scale tuning, or production-integrator changes
were made. The paper, slides, checkpoints, and previous results were preserved.

## Prediction Changes Are Small

For the original inputs, these are five-fit median physical-reference errors.
Each fit includes both connections and all 16 starts.

| Numerical setting | Voltage (mV) | DGU current (mA) | Line current (mA) |
|---|---:|---:|---:|
| Current solve, original step | 0.222258 | 0.077915 | 0.176443 |
| Tight solve, original step | 0.222257 | 0.077915 | 0.176443 |
| Tight solve, quarter step | 0.221957 | 0.077498 | 0.176519 |

Tightening the solve alone barely moves the predictions. Smaller steps do not
uniformly improve physical-reference error: the line-current median increases
slightly. Numerical convergence and physical model accuracy are different
questions.

One case crosses the frozen investigation threshold. For fit 1, the DGU-current
RMS difference between tight full and half steps is 0.535 microampere, or 1.24%
of that fit's existing physical-reference RMSE. The threshold was 1%; it is not
a safety tolerance. No channel in any fit crosses it on the next half-to-quarter
refinement. No solve-tightening comparison crosses it.

## What Each Diagnostic Separates

**Solver convergence.** The largest recorded midpoint equation residual over
all learned runs is $5.78\times10^{-12}$ in the native charge/flux coordinate
units. No solve reaches its iteration cap. Current DGU solves use two Picard
iterations; tight full-step solves use four. These observations do not certify
conditioning or convergence outside this finite test set.

**Phase.** In the unit-frequency harmonic control, tightening the solve reduces
relative energy drift from $6.23\times10^{-5}$ to approximately $10^{-12}$, but
leaves a 0.0832-radian phase lag after 100 seconds. Reducing the step from 0.1 to
0.025 seconds reduces that lag to 0.00521 radians. Correct energy alone does not
give correct phase.

**Coupling energy.** The actual additive port path uses explicit midpoint, not
implicit midpoint. In the unequal-storage control, continuous port power
cancels to roundoff, but the finite-step update gains 0.587% energy over 20
seconds at step 0.1. An independent closed-form calculation reproduces this
gain. At step 0.025 the gain is 0.00915%. This control has two capacitor nodes
and one inductive link: three storage components, with two storage types.

In the original-input learned network, the largest accumulated absolute
aggregate coupling defect is only $1.61\times10^{-8}$ joule over the two-second
horizon. The corresponding local-conservative aggregate is
$2.25\times10^{-8}$ joule. These are aggregate measurements; opposite component
defects can cancel within an aggregate.

The worst normalized accumulated whole-path work/loss residual is
$2.21\times10^{-5}$ at the original step and $1.38\times10^{-6}$ at quarter step.
This ledger uses endpoint trapezoids, so it includes power-quadrature and
splitting effects. It is not a direct measurement of artificial energy creation.

**Nonlinearity.** The synthetic capacitor sweep fixes initial voltage and varies
$\beta\in\{0,0.25,1,4\}$. Nonquadratic energy is not preserved exactly by tight
implicit midpoint. However, increasing beta does not increase charge error in
this control: it also changes capacitance, energy and oscillation frequency.
The supplied figures show both measurements rather than treating beta as a
universal numerical-difficulty scale.

**Damping.** The scalar stiff control remains energy-nonincreasing while its
Cayley update reverses momentum instead of producing the nearly complete
physical decay. This illustrates a limitation of the damping rule, not an
observed failure in the learned-network runs.

## Consequences for Decisions

On the quarter-step trajectories, sampling only the original output grid misses
line-current peaks by up to 7.19 microamperes for the original inputs. Comparing
original and fine sampled maxima changes their first-maximum times by up to
5 milliseconds. These are sampled-peak diagnostics, not precise event-time
estimates.

A post-hoc check of the existing peak-line-current objective on the same 201
output points finds **zero ordering changes among 80 paired candidates** between
current and quarter-step settings. It uses the saved study's 2-microampere
reference-gap rule. This is descriptive stability, not a continuous-peak or
safety certificate. Small future score gaps still require numerical qualification.

## What to Upgrade

1. **Convergence reporting:** expose equation residual, iteration count and
   convergence status, and reject a failed solve explicitly. This is preventive
   hardening; no such failure was observed here.
2. **Peak and event resolution:** qualify these readouts separately from RMSE
   when decision margins are measured in microamperes or milliseconds. A smaller
   step may suffice without changing the method.
3. **Exact-energy requirements:** first specify which substep or complete forced
   system needs an exact discrete balance. The tested explicit-midpoint port
   path does not supply that guarantee. Energy-consistent constructions exist,
   including the discrete-gradient and splitting approaches of
   [Celledoni and Hoiseth](https://arxiv.org/abs/1706.08621), but this audit did
   not implement or compare replacements.

## Verification and Limits

A separate verifier, without importing the numerical runner, checked all saved
arrays, source/input hashes, matching recorded non-timestep state hashes, common horizons,
completion counts, damping signs, and the bitwise instrumentation replay.
Closed-form phase, coupling-energy and damping identities provide additional
checks. All 30 known-law conditions and 120 learned-model batch conditions are
retained. No independent reviewer agent was used.

These are frozen current-code diagnostics on existing checkpoints, not a fresh
held-out learning study. Scaled inputs have no matched new physical truth.
The audit does not test contact events, stochastic integration, posterior
calibration, or universal stability. The first source snapshot is preserved;
the second corrects only an audit-ledger call to the existing damping dispatcher,
before any learned-model execution. Scientific settings were unchanged.

The following numerical appendix contains the complete original-input summary;
four rendered figures follow it. Raw arrays, per-call solver records, frozen
sources and machine-readable checks remain alongside this report.

\newpage
