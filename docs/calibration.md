# Calibration inspector

Calibration JSON viewer.

## Get a calibration file

1. [Calibrate ↗](https://huggingface.co/docs/lerobot/main/en/so101#calibration)
2. Load the JSON.

The expected top-level motor keys are:

- `shoulder_pan`
- `shoulder_lift`
- `elbow_flex`
- `wrist_flex`
- `wrist_roll`
- `gripper`

Fields: `id` · `drive_mode` · `homing_offset` · `range_min` · `range_max`.

## Reading the display

- pale: encoder range
- color: usable range
- caps: physical limits
- center: zero

Flags: missing ID · duplicate ID · reversed range · narrow range · out-of-turn value.
