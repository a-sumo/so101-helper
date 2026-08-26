import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManifest, timelineAt, totalDuration } from '../src/assembly-core.js';

const input = {
  title: 'Test assembly',
  steps: [
    { id: 'one', label: 'One', group: 'prep', durationMs: 1000 },
    { id: 'two', label: 'Two', group: 'frame', durationMs: 2000 },
  ],
};

test('normalizes a compact assembly manifest', () => {
  const result = normalizeManifest(input);
  assert.equal(result.errors.length, 0);
  assert.equal(result.manifest.version, 1);
  assert.equal(result.manifest.steps[0].group, 'PREP');
  assert.equal(totalDuration(result.manifest.steps), 3000);
});

test('evaluates segmented timeline progress', () => {
  const steps = normalizeManifest(input).manifest.steps;
  const state = timelineAt(steps, 1500);
  assert.equal(state.index, 1);
  assert.deepEqual(state.fills, [1, 0.25]);
});

test('clamps unsupported durations', () => {
  const result = normalizeManifest({ title: 'Clamp', steps: [{ id: 'x', label: 'X', group: 'test', durationMs: 5 }] });
  assert.equal(result.manifest.steps[0].durationMs, 250);
  assert.match(result.warnings[0], /clamped/);
});

test('rejects an empty sequence', () => {
  const result = normalizeManifest({ title: 'Empty', steps: [] });
  assert.match(result.errors[0], /at least one stage/);
});
