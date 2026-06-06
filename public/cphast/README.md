# C-PHAST Static Project Page

This folder is a dependency-free static project page for C-PHAST. It contains
the website HTML/CSS plus representative assets for candidate futures,
model-predictive safety criticism, embodiment transfer, and baseline failure.

Open `index.html` directly in a browser for a local preview, or deploy the
entire folder as a static site.  The page has no build step and no external
runtime dependencies.

## Website Sections

1. **Landing hero.**
   Uses `videos/cphast_candidate_futures_interpreted_h264.mp4`
   to lead with the current paper framing: same observed state, multiple
   candidate futures, typed physical scoring.

2. **One state, three futures.**
   A compact text/metric section explaining the public-facing intuition:
   fast-but-risky, robust-but-costly, and unsafe.

3. **Evidence cards.**
   Four cards: candidate futures, safety critic, embodiment transfer, and
   baseline contrast. This is the fastest section for a new reader to scan.

4. **Candidate-future interface.**
   Uses `videos/cphast_candidate_futures_interpreted_h264.mp4`
   and `images/cphast_candidate_futures_px2p25_start82_filmstrip.png`.

5. **Structured dynamics transfer.**
   Use `images/isaaclab_source_target_transfer_hero.png` as the static
   source-target hero.
   Use `videos/anymal_to_go2_source_target_comparison_slow8.mp4` and
   `videos/go2_zero_shot_model_failure_comparison_slow8.mp4`.

6. **Rollout contract.**
   Uses `images/cphast_rollout_contract.png` to show how DeploymentSpec,
   charted observations, typed PHASTCore blocks, deployed interconnects, and
   native readouts fit together.

7. **Microgrid redeployment.**
   Uses `images/microgrid_redeployment.png` to show the electrical analogue:
   candidate network futures from the same typed pH asset library.

8. **Video gallery.**
   Four clips only: candidate futures, safety critic, embodiment transfer,
   and baseline failure comparison.

## Notes

- The main paper uses PDF versions of the figures in `paper/figures/`; this
  website bundle keeps PNG copies for browser use.
- The safety-critic videos show the current interface: C-PHAST provides early
  warning/ranking from predicted physical consequences. Recovery-action
  generation is a separate component.
- The manifest in `manifest.json` records captions and suggested placement.
