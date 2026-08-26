import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FASTENER_PHASES,
  FASTENER_WAVE_SIZE,
  GRID_PHASES,
  KIT_BARYCENTER_OFFSET,
  MOTION_TRAJECTORY_MODES,
  STAGING_PHASES,
  effectiveStepWindow,
  kindForStagingId,
  orientationAlignmentProgress,
  sampleStagedCenter,
  sampleStagedTangent,
  stagingCenterForStep,
} from '../src/assembly-staging.js';

const sequence = JSON.parse(
  readFileSync(new URL('../public/default-sequence.json', import.meta.url), 'utf8'),
);
const steps = sequence.steps;

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function nearVector(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    near(actual[index], expected[index], tolerance);
  }
}

test('canonical sequence uses the 26-second staged-layout schema', () => {
  assert.equal(sequence.schema_version, 3);
  assert.equal(sequence.duration, 26);
  assert.equal(steps.length, 76);
});

test('every part gets a unique slot, tightly clustered by type and lifted away', () => {
  const centers = steps.map((_, index) => stagingCenterForStep(steps, index));
  assert.equal(new Set(centers.map(center => center.join(','))).size, 76);
  for (const [x, y, z] of centers) {
    assert.ok(x >= -0.20 && x <= 0.25, `x ${x}`);
    assert.ok(y >= -0.52 && y <= -0.22, `y ${y}`);
    // Kit is lifted in GLB +Z (world up) to clear the assembled robot volume.
    assert.ok(z >= KIT_BARYCENTER_OFFSET[2] - 1e-9 && z <= KIT_BARYCENTER_OFFSET[2] + 0.02, `z ${z}`);
  }

  // Each part type forms one tight cluster around a shared barycentre.
  const byKind = new Map();
  for (let index = 0; index < steps.length; index += 1) {
    const kind = kindForStagingId(steps[index].id);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(centers[index]);
  }
  assert.deepEqual(
    [...byKind.keys()].sort(),
    ['actuator', 'fastener', 'mount', 'structure'],
  );
  for (const members of byKind.values()) {
    const cx = members.reduce((sum, c) => sum + c[0], 0) / members.length;
    const cy = members.reduce((sum, c) => sum + c[1], 0) / members.length;
    for (const [x, y] of members) {
      assert.ok(
        Math.hypot(x - cx, y - cy) <= 0.12,
        'part stays within 12cm of its type barycentre',
      );
    }
  }
});

test('fasteners land in waves of at most four within their authored window', () => {
  const groups = new Map();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step.id.startsWith('screw/')) continue;
    const key = `${step.link}:${step.time.join('-')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
    const effective = effectiveStepWindow(steps, index);
    assert.ok(effective[0] >= step.time[0]);
    assert.ok(effective[1] <= step.time[1] + 1e-9);
  }

  for (const indexes of groups.values()) {
    const allowedConcurrency = Math.min(FASTENER_WAVE_SIZE, indexes.length);
    const authored = steps[indexes[0]].time;
    for (let sample = 0; sample <= 100; sample += 1) {
      const time = authored[0] + (authored[1] - authored[0]) * sample / 100;
      const active = indexes.filter(index => {
        const [start, end] = effectiveStepWindow(steps, index);
        return time >= start && time < end;
      }).length;
      assert.ok(active <= allowedConcurrency);
    }
  }
});

test('fastener flight turns tip-first into a long entry-axis corridor', () => {
  const input = {
    stagingCenter: [0.30, 0.10, 0.018],
    restCenter: [0.02, 0.04, 0],
    approachOffset: [0, 0, 0.035],
    sourceIndex: 7,
    fastener: true,
  };
  const corridorStart = sampleStagedCenter({
    ...input,
    normalizedTime: FASTENER_PHASES.corridorEntry,
  });
  near(corridorStart[0], input.restCenter[0]);
  near(corridorStart[1], input.restCenter[1]);
  assert.ok(corridorStart[2] >= 0.105 - 1e-9);

  for (const t of [0.40, 0.55, 0.70, FASTENER_PHASES.threadStart, 0.94]) {
    const tangent = sampleStagedTangent({...input, normalizedTime: t});
    near(tangent[0], 0);
    near(tangent[1], 0);
    near(tangent[2], -1);
    const position = sampleStagedCenter({...input, normalizedTime: t});
    near(position[0], input.restCenter[0]);
    near(position[1], input.restCenter[1]);
  }
  assert.deepEqual(
    sampleStagedCenter({...input, normalizedTime: FASTENER_PHASES.threadStart}),
    [0.02, 0.04, 0.035],
  );
  assert.deepEqual(sampleStagedCenter({...input, normalizedTime: 1}), input.restCenter);
});

test('engineering orientation locks before the final approach corridor', () => {
  near(orientationAlignmentProgress(0), 0);
  near(orientationAlignmentProgress(STAGING_PHASES.liftComplete), 0);
  assert.ok(orientationAlignmentProgress(0.4) > 0);
  assert.ok(orientationAlignmentProgress(0.4) < 1);
  near(orientationAlignmentProgress(STAGING_PHASES.orientationLocked), 1);
  near(orientationAlignmentProgress(STAGING_PHASES.alignedForInsertion), 1);
  assert.ok(STAGING_PHASES.orientationLocked < STAGING_PHASES.clearanceReached);
  assert.ok(FASTENER_PHASES.orientationStart < FASTENER_PHASES.axisLocked);
  near(FASTENER_PHASES.axisLocked, FASTENER_PHASES.corridorEntry);
  assert.ok(FASTENER_PHASES.axisLocked < FASTENER_PHASES.threadStart);
});

test('motion lifts, aligns at the manual approach, then inserts exactly', () => {
  const stagingCenter = [-0.09, 0.31, 0];
  const restCenter = [0.02, 0.04, 0];
  const approachOffset = [0, 0, 0.06];
  const input = {stagingCenter, restCenter, approachOffset, sourceIndex: 0};

  assert.deepEqual(sampleStagedCenter({...input, normalizedTime: 0}), stagingCenter);
  const lifted = sampleStagedCenter({
    ...input,
    normalizedTime: STAGING_PHASES.liftComplete,
  });
  near(lifted[2], 0.042);

  const aligned = sampleStagedCenter({
    ...input,
    normalizedTime: STAGING_PHASES.alignedForInsertion,
  });
  assert.deepEqual(aligned, [0.02, 0.04, 0.06]);
  assert.deepEqual(sampleStagedCenter({...input, normalizedTime: 1}), restCenter);
});

test('grid mode moves one receiving-frame axis at a time', () => {
  const input = {
    stagingCenter: [-0.09, 0.31, 0],
    restCenter: [0.02, 0.04, 0],
    approachOffset: [0, 0, 0.06],
    sourceIndex: 0,
    fastener: true,
    trajectoryMode: MOTION_TRAJECTORY_MODES.grid,
  };
  nearVector(
    sampleStagedCenter({...input, normalizedTime: 0}),
    input.stagingCenter,
  );
  nearVector(
    sampleStagedCenter({
      ...input,
      normalizedTime: GRID_PHASES.firstAxisComplete,
    }),
    [0.02, 0.31, 0],
  );
  nearVector(
    sampleStagedCenter({
      ...input,
      normalizedTime: GRID_PHASES.secondAxisComplete,
    }),
    [0.02, 0.04, 0],
  );
  nearVector(
    sampleStagedCenter({
      ...input,
      normalizedTime: GRID_PHASES.approachReached,
    }),
    [0.02, 0.04, 0.06],
  );
  nearVector(
    sampleStagedCenter({...input, normalizedTime: 1}),
    input.restCenter,
  );
  nearVector(sampleStagedTangent({...input, normalizedTime: 0.1}), [1, 0, 0]);
  nearVector(sampleStagedTangent({...input, normalizedTime: 0.3}), [0, -1, 0]);
  nearVector(sampleStagedTangent({...input, normalizedTime: 0.6}), [0, 0, 1]);
  nearVector(sampleStagedTangent({...input, normalizedTime: 0.9}), [0, 0, -1]);
});
