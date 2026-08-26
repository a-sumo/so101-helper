# Assembly animation timeline

The timeline builder creates a JSON sequence with stage ordering, grouping, and duration.

Use the [official SO-101 guide](https://huggingface.co/docs/lerobot/main/en/so101#assemble-the-so-101) alongside the timeline.

## Format

```json
{
  "$schema": "./schemas/assembly-sequence.schema.json",
  "version": 1,
  "title": "SO-101 assembly",
  "steps": [
    {
      "id": "base",
      "label": "Build the base",
      "group": "FRAME",
      "durationMs": 1800
    }
  ]
}
```

Fields:

- `id`: stable stage identifier.
- `label`: viewer-facing stage name.
- `group`: short uppercase category for styling or filtering.
- `durationMs`: playback duration between 250 and 120000 milliseconds.

The complete schema is [`schemas/assembly-sequence.schema.json`](../schemas/assembly-sequence.schema.json).

## Timing

Accumulate stage durations, select the active stage from elapsed time, and use local stage progress for animation timing.
