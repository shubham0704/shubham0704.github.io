# C-PHAST Demo Handoff

This folder is the lightweight demo bundle for showing C-PHAST before asking a
robotics lab for hardware time. It contains browser-ready videos/images plus
references to the scripts that generated the artifacts.

## What To Show First

### 1. Structured dynamics transfer

Use:

- `images/isaaclab_source_target_transfer_hero.png`
- `videos/anymal_to_go2_source_target_comparison_slow8.mp4`
- `videos/go2_zero_shot_model_failure_comparison_slow8.mp4`

Message:

> C-PHAST transfers a structured dynamics model from ANYmal-D to Unitree Go2.
> This is model-rollout evidence: it shows target-robot physical prediction, not
> closed-loop control.

### 2. Closed-loop Go2 perturbation envelope

Use:

- `images/go2_push_envelope_filmstrip.png`
- `videos/go2_lateral_push_envelope_3tile.mp4`
- `videos/go2_policy_push_y1p5_recovery.mp4`
- `videos/go2_policy_push_y2p25_failure.mp4`
- `videos/go2_policy_push_y3p0_failure.mp4`

Message:

> These are simulator-executed Isaac Lab rollouts. The Go2 policy recovers from
> a smaller lateral push and fails at larger pushes, giving a real runtime stress
> test for the model-predictive critic.

### 3. C-PHAST safety timing

Use:

- `images/go2_safety_signal_timing.png`

Message:

> C-PHAST flags unsafe futures before simulator-level failure and attributes the
> warning to typed physical channels. The current demo is a critic/diagnostic
> interface, not a learned recovery controller.

## How To Preview

Open:

```bash
open paper/media/website_cphast/index.html
```

or serve statically:

```bash
cd paper/media/website_cphast
python -m http.server 8000
```

Then browse to `http://127.0.0.1:8000`.

## Reproducibility Pointers

The maintained Isaac Lab scripts live in:

```text
phast/scripts/isaac_lab/
```

Most relevant scripts:

- `record_closed_loop_failure_rollout.py`: record simulator-executed Go2
  rollouts with root/joint/contact/failure diagnostics.
- `make_push_envelope_artifacts.py`: build the synchronized push-envelope video
  and envelope plot from recorded runs.
- `make_safety_critic_evidence_table.py`: summarize warning/failure lead times.
- `make_multiscale_diagnostic_panels.py`: build typed diagnostic panels.
- `make_rendered_comparison_video.py`: assemble rendered model-rollout videos.

The canonical source-target model artifacts are under:

```text
phast/results/isaaclab_cross_robot_policy/
```

The generated paper/website figures are staged under:

```text
paper/figures/
paper/media/website_cphast/
```

## Real-Robot Handoff Target

The first physical-robot experiment should be read-only ROS shadow mode:

1. Record rosbags or connect to live topics.
2. Convert robot state/action streams into a C-PHAST deployment state.
3. Run short-horizon C-PHAST rollouts.
4. Publish typed residuals, warning events, and predicted physical consequences.
5. Do not send commands to the robot.

Minimum inputs:

- joint positions and velocities;
- base odometry or pose if the robot is mobile;
- commanded actions or controller targets;
- optional contact, wrench, gripper, tactile, or object-state channels.

Minimum outputs:

- typed residuals;
- safety/risk score;
- warning event with source channel;
- optional RViz markers.

The planned package shape is:

```text
cphast_ros/
  cphast_ros/state_adapter.py
  cphast_ros/critic_node.py
  cphast_ros/diagnostics_node.py
  cphast_ros/rosbag_eval.py
  config/<robot>_shadow.yaml
  launch/shadow_diagnostics.launch.py
```

This is intentionally a shadow-mode interface. Closed-loop veto or recovery
control should only be attempted after simulator validation and live read-only
diagnostics are stable.
