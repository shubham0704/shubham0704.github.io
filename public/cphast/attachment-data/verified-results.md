# Verified frozen attachment campaign

All 12 frozen scenarios, two attachments and five saved fits per method were evaluated: 360 planned trajectories. No training, tuning, corrected variants or accuracy-driven retries were used. All 15 workers returned without timeouts.

| Method | Qualified trajectories /120 | Correct selected decisions /60 | Exact feasible sets /60 | Abstained pairs /60 |
|---|---:|---:|---:|---:|
| C-PHAST | 120 | 60 | 60 | 0 |
| cPHNN | 120 | 55 | 55 | 0 |
| N-PHDAE | 38 | 18 | 16 | 42 |

A selected decision means choosing A, choosing B, or rejecting both under the frozen current/voltage screens and peak-utilization objective. Both candidate forecasts must qualify. Abstentions are not incorrect completed decisions. N-PHDAE chooses B correctly in two pairs while falsely rejecting A, which explains the difference between its 18 correct choices and 16 exact feasible sets.

## The preselected stress corner

At 80% initial corridor loading and 1.45x future demand, the independent reference rejects both attachments. For attachment B, the reference peak is 404.544 mA against the declared 400 mA screen. cPHNN predicts 395.310, 396.760, 399.480, 398.311 and 397.557 mA across fits 1-5 and selects B in every fit. C-PHAST correctly rejects both in every fit. No case was selected using learned-model advantage.

This supplies an actual false-accept example for cPHNN, not for N-PHDAE. N-PHDAE produces no qualified false-accept decision in this campaign; its principal observed limitation here is forecast availability.

## Forecast errors

Mean per-path RMSE over each method's qualified trajectories:

| Method | Cohort | Voltage (mV) | Line current (mA) |
|---|---:|---:|---:|
| C-PHAST | 120 | 0.05682 | 0.08645 |
| cPHNN | 120 | 42.58175 | 5.58747 |
| N-PHDAE | 38 | 14.47926 | 15.89772 |

For the same 38 trajectories that qualify for all three methods:

| Method | Voltage (mV) | Line current (mA) |
|---|---:|---:|
| C-PHAST | 0.06342 | 0.09923 |
| cPHNN | 40.06864 | 4.23710 |
| N-PHDAE | 14.47926 | 15.89772 |

The common subset contains eight paths from fit 1, 22 from fit 3 and eight from fit 5. It is selected by numerical completion, not representative full-suite evidence. Reference peaks use the saved 0.001-second grid; errors use the common 0.01-second grid including time zero.

## Failure attribution and logging caveat

N-PHDAE has 80 bounded adapter-entry failures and two upstream consistency failures. All 80 entry failures occur while converting existing-network current to flux, before candidate initialization or upstream solving. No root candidate was found within the four sampled search windows. This does not prove that a root cannot exist elsewhere or between sampled points.

The two upstream failures are fit 3, attachment A, at 80% loading with demand multipliers 1.30 and 1.45. They occur at 17.24 and 11.45 seconds after successful initialization. Upstream fsolve stops for insufficient progress with residuals 0.000921668 and 0.00166970. This evidence does not establish a singular Jacobian, absence of a solution, or a uniquely identified learned-law cause.

There is a diagnostics-only logging defect in the frozen harness: 32 failed rows retain stale `adapter_records.candidate` fields. These are fits 1 and 5, both 65% and 80% loading, every demand and both attachments. Candidate initialization was not attempted; those fields came from the previous successful 50% case for the same attachment. The remaining 48 entry failures in fits 2 and 4 have empty candidate fields. Attribute all 80 entry failures using fresh `adapter_records.actual` and traceback only. Forecasts and outcome counts are unaffected. Raw records and the frozen harness have not been edited.

## Verification and scope

A read-only reviewer independently recomputed all 360 rows, 180 pairs, 18 summaries and 360 CSV entries from saved arrays. These agree with the parent analysis. The reviewer verified the checkpoint, import, raw and 2,319 frozen source hashes, supplied inputs and retained states. All 30,895 protected files remain unchanged. The rendered overview was inspected and agrees with the audited outcomes. Post-rollout parameter fingerprint assertions passed; final live tensors were not separately saved for independent post-hoc tensor hashing.

This is a supplied-state extrapolation stress study, not the component-only headline benchmark. Existing training data and budgets differ: C-PHAST and cPHNN use isolated-component fits; N-PHDAE uses its original network-derived local-data fits. The result is not an equal-training, architecture-only comparison. Screens are synthetic task limits, not hardware ratings or safety guarantees. Assigned connected states do not model a physical switch-closing transient.

The website, live paper, slides and pre-existing results are unchanged.

## Artifacts

- [Frozen protocol](../PROTOCOL.json)
- [Independent verification](../INDEPENDENT_VERIFICATION.json)
- [Preservation check](../preservation_check.json)
- [Every planned outcome](all_outcomes.csv)
- [Analysis report](REPORT.md)
- [Overview figure](all_scenarios.png)
- [Raw result directories](../results/)
