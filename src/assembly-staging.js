/**
 * Deterministic kitting layout and motion choreography for the canonical
 * SO-101 assembly. Coordinates are GLB/world metres before the Lens scene's
 * authored root transform is applied.
 *
 * Manual start_offset vectors remain authoritative for the final insertion
 * axis. This module only owns the pre-assembly spread and clearance path.
 */

export const ASSEMBLY_STAGING_VERSION = 6;

// Whole-kit offset (GLB/world metres) added to every staging centre. In the
// imported Lens hierarchy the observed screen-up direction is GLB -Z; keep
// the explicit negative anchor so the initial parts strip sits above the
// assembled robot instead of below the dashboard.
// Move the disassembled kit roughly an arm's length away from the wearer.
// The authored zup_to_yup node maps GLB +Y to Lens local -Z (the wearer-facing
// front), so GLB -Y is the away-from-wearer direction. +Z remains the lift.
// Explicit initial-parts anchor: keep the disassembled kit clearly above the
// robot's final/base datum, not merely barely clear of its bounding volume.
export const KIT_BARYCENTER_OFFSET = Object.freeze([0.0, -0.55, -0.50]);

// Parts are grouped into tight per-type clusters (motors together, mounts
// together, etc.). Each cluster packs its members into a small centred grid so
// they stay close, while the clusters themselves sit apart and — via
// KIT_BARYCENTER_OFFSET — away from the built robot. Centres are GLB metres in
// the kit's x/y plane before the offset lift. Classification mirrors
// MechanicalAssemblyOperations.kindForOperation.
export const GROUP_STAGING_CLUSTERS = Object.freeze({
  structure: Object.freeze({center: [-0.095, 0.235], columns: 3, spacingX: 0.070, spacingY: 0.070, z: 0.0}),
  actuator: Object.freeze({center: [0.095, 0.245], columns: 3, spacingX: 0.060, spacingY: 0.060, z: 0.0}),
  mount: Object.freeze({center: [-0.095, 0.075], columns: 2, spacingX: 0.060, spacingY: 0.060, z: 0.0}),
  fastener: Object.freeze({center: [0.105, 0.080], columns: 12, spacingX: 0.013, spacingY: 0.015, z: 0.006}),
});

/** Part-type classification from an operation id (parity with the Lens registry). */
export function kindForStagingId(id) {
  const lower = String(id).toLowerCase();
  if (lower.startsWith('screw/')) return 'fastener';
  if (lower.indexOf('sts3215') >= 0) return 'actuator';
  if (lower.indexOf('motor_holder') >= 0 || lower.indexOf('mounting_plate') >= 0) {
    return 'mount';
  }
  return 'structure';
}

export const MOTION_TRAJECTORY_MODES = Object.freeze({
  spatial: 'spatial',
  grid: 'grid',
});

export const GRID_PHASES = Object.freeze({
  firstAxisComplete: 0.22,
  secondAxisComplete: 0.40,
  approachReached: 0.82,
});

export const STAGING_PHASES = Object.freeze({
  liftComplete: 0.16,
  transitMidpoint: 0.46,
  orientationLocked: 0.64,
  clearanceReached: 0.68,
  alignedForInsertion: 0.80,
});

// Fasteners use a powered-descent profile rather than the major-part path.
// The Bezier intercept finishes early; everything after corridorEntry is
// collinear with the receiving-hole axis. Threading begins only after the
// screw reaches the manually authored approach point.
export const FASTENER_PHASES = Object.freeze({
  orientationStart: 0.22,
  corridorEntry: 0.38,
  axisLocked: 0.38,
  threadStart: 0.82,
});

export const FASTENER_WAVE_SIZE = 4;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function smoothstep(t) {
  const bounded = clamp01(t);
  return bounded * bounded * (3 - 2 * bounded);
}

/**
 * Shortest-path datum alignment for major parts. Rotation begins only after
 * the part clears its kit fixture and is locked before the final approach.
 */
export function orientationAlignmentProgress(normalizedTime) {
  const t = clamp01(normalizedTime);
  if (t <= STAGING_PHASES.liftComplete) return 0;
  if (t >= STAGING_PHASES.orientationLocked) return 1;
  return smoothstep(
    (t - STAGING_PHASES.liftComplete) /
      (STAGING_PHASES.orientationLocked - STAGING_PHASES.liftComplete),
  );
}

// Unit slope at launch and zero slope at touchdown: it joins a constant-speed
// corridor without a pause, then performs a controlled final landing.
function softLanding(t) {
  const bounded = clamp01(t);
  return bounded + bounded * bounded - bounded * bounded * bounded;
}

function length(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function scale(vector, amount) {
  return vector.map(component => component * amount);
}

function normalize(vector, fallback = [0, 0, -1]) {
  const magnitude = length(vector);
  return magnitude > 1e-9 ? scale(vector, 1 / magnitude) : [...fallback];
}

function cubicBezier(a, b, c, d, t) {
  const u = 1 - t;
  return [0, 1, 2].map(index =>
    u * u * u * a[index] +
    3 * u * u * t * b[index] +
    3 * u * t * t * c[index] +
    t * t * t * d[index]
  );
}

function cubicBezierTangent(a, b, c, d, t) {
  const u = 1 - t;
  return [0, 1, 2].map(index =>
    3 * u * u * (b[index] - a[index]) +
    6 * u * t * (c[index] - b[index]) +
    3 * t * t * (d[index] - c[index])
  );
}

// Position within a kind: how many earlier steps share this kind, and the kind
// total. Drives a deterministic, unique, centred grid slot per part.
function kindOrdinal(steps, sourceIndex) {
  const kind = kindForStagingId(steps[sourceIndex].id);
  let ordinal = 0;
  let total = 0;
  for (let index = 0; index < steps.length; index += 1) {
    if (kindForStagingId(steps[index].id) !== kind) continue;
    if (index < sourceIndex) ordinal += 1;
    total += 1;
  }
  return {ordinal, total};
}

export function stagingCenterForStep(steps, sourceIndex) {
  const step = steps[sourceIndex];
  if (!step) throw new Error(`Missing assembly step ${sourceIndex}`);
  const kind = kindForStagingId(step.id);
  const cluster = GROUP_STAGING_CLUSTERS[kind];
  if (!cluster) throw new Error(`Missing staging cluster for kind: ${kind}`);

  const {ordinal, total} = kindOrdinal(steps, sourceIndex);
  const columns = cluster.columns;
  const rows = Math.max(1, Math.ceil(total / columns));
  const column = ordinal % columns;
  const row = Math.floor(ordinal / columns);
  // Centre the grid on the cluster so its barycentre equals cluster.center.
  const x = cluster.center[0] + (column - (columns - 1) / 2) * cluster.spacingX;
  const y = cluster.center[1] - (row - (rows - 1) / 2) * cluster.spacingY;
  const z = cluster.z;
  return [
    x + KIT_BARYCENTER_OFFSET[0],
    y + KIT_BARYCENTER_OFFSET[1],
    z + KIT_BARYCENTER_OFFSET[2],
  ];
}

/**
 * Stagger repeated fasteners without changing the authored group. Hardware is
 * installed in explicit waves of four, matching the four-corner motor pattern
 * and keeping the choreography legible.
 */
export function effectiveStepWindow(steps, sourceIndex) {
  const step = steps[sourceIndex];
  if (!step) throw new Error(`Missing assembly step ${sourceIndex}`);
  const authored = [...step.time];
  if (!step.id.startsWith('screw/')) return authored;

  const siblings = [];
  for (let index = 0; index < steps.length; index += 1) {
    const candidate = steps[index];
    if (
      candidate.id.startsWith('screw/') &&
      candidate.link === step.link &&
      candidate.time[0] === step.time[0] &&
      candidate.time[1] === step.time[1]
    ) siblings.push(index);
  }
  if (siblings.length <= 1) return authored;

  const groupIndex = siblings.indexOf(sourceIndex);
  const waveCount = Math.ceil(siblings.length / FASTENER_WAVE_SIZE);
  const waveIndex = Math.floor(groupIndex / FASTENER_WAVE_SIZE);
  const authoredDuration = authored[1] - authored[0];
  const motionDuration = authoredDuration / waveCount;
  const stagger = motionDuration;
  const start = authored[0] + waveIndex * stagger;
  return [start, start + motionDuration];
}

/**
 * Samples the five-stage rigid-part path. The part lifts out of its kit slot,
 * follows a shallow curved transfer, aligns at the manually authored approach
 * point, then moves only along that final physical insertion vector.
 */
export function sampleStagedCenter({
  stagingCenter,
  restCenter,
  approachOffset,
  normalizedTime,
  sourceIndex = 0,
  fastener = false,
  trajectoryMode = MOTION_TRAJECTORY_MODES.spatial,
}) {
  const t = clamp01(normalizedTime);
  if (trajectoryMode === MOTION_TRAJECTORY_MODES.grid) {
    return sampleGridFlight({
      stagingCenter,
      restCenter,
      approachOffset,
      normalizedTime: t,
      sourceIndex,
      fastener,
    }).position;
  }
  if (fastener) {
    return sampleFastenerFlight({
      stagingCenter,
      restCenter,
      approachOffset,
      normalizedTime: t,
      sourceIndex,
    }).position;
  }
  const lift = fastener ? 0.022 : 0.042;
  const arc = fastener ? 0.008 : 0.018;
  const approachCenter = add(restCenter, approachOffset);
  const stagingLifted = add(stagingCenter, [0, 0, lift]);
  const approachLifted = add(approachCenter, [0, 0, lift]);
  const travel = subtract(approachLifted, stagingLifted);
  const planarLength = Math.hypot(travel[0], travel[1]) || 1;
  const arcSign = sourceIndex % 2 === 0 ? 1 : -1;
  const perpendicular = [
    (-travel[1] / planarLength) * arc * arcSign,
    (travel[0] / planarLength) * arc * arcSign,
    lift * 0.22,
  ];
  const transitMidpoint = add(mix(stagingLifted, approachLifted, 0.5), perpendicular);

  const points = [
    stagingCenter,
    stagingLifted,
    transitMidpoint,
    approachLifted,
    approachCenter,
    restCenter,
  ];
  const times = [
    0,
    STAGING_PHASES.liftComplete,
    STAGING_PHASES.transitMidpoint,
    STAGING_PHASES.clearanceReached,
    STAGING_PHASES.alignedForInsertion,
    1,
  ];

  for (let index = 0; index < times.length - 1; index += 1) {
    if (t <= times[index + 1]) {
      const local = (t - times[index]) / (times[index + 1] - times[index]);
      return mix(points[index], points[index + 1], smoothstep(local));
    }
  }
  return [...restCenter];
}

/**
 * Receiving-frame grid flight. The authored insertion vector becomes one
 * axis of an orthonormal construction grid; the other two axes span its
 * receiving plane. Parts move one axis at a time, so the practical mode stays
 * strictly Manhattan while retaining the exact physical landing direction.
 */
function sampleGridFlight({
  stagingCenter,
  restCenter,
  approachOffset,
  normalizedTime,
  sourceIndex,
  fastener,
}) {
  const t = clamp01(normalizedTime);
  const outward = normalize(approachOffset, [0, 0, 1]);
  const insertionDirection = scale(outward, -1);
  const reference = Math.abs(dot(outward, [0, 0, 1])) < 0.82
    ? [0, 0, 1]
    : [0, 1, 0];
  let firstPlaneAxis = normalize(cross(reference, outward), [1, 0, 0]);
  let secondPlaneAxis = normalize(cross(outward, firstPlaneAxis), [0, 1, 0]);
  if (sourceIndex % 2 === 1) {
    const swap = firstPlaneAxis;
    firstPlaneAxis = secondPlaneAxis;
    secondPlaneAxis = swap;
  }

  const approachCenter = add(restCenter, approachOffset);
  const toApproach = subtract(approachCenter, stagingCenter);
  const firstCorner = add(
    stagingCenter,
    scale(firstPlaneAxis, dot(toApproach, firstPlaneAxis)),
  );
  const secondCorner = add(
    firstCorner,
    scale(secondPlaneAxis, dot(toApproach, secondPlaneAxis)),
  );
  const points = [
    stagingCenter,
    firstCorner,
    secondCorner,
    approachCenter,
    restCenter,
  ];
  const approachReached = fastener
    ? GRID_PHASES.approachReached
    : STAGING_PHASES.alignedForInsertion;
  const times = [
    0,
    GRID_PHASES.firstAxisComplete,
    GRID_PHASES.secondAxisComplete,
    approachReached,
    1,
  ];

  for (let index = 0; index < times.length - 1; index += 1) {
    if (t <= times[index + 1]) {
      const duration = times[index + 1] - times[index];
      const local = duration > 1e-9 ? (t - times[index]) / duration : 1;
      const segment = subtract(points[index + 1], points[index]);
      return {
        position: mix(points[index], points[index + 1], smoothstep(local)),
        tangent: normalize(segment, insertionDirection),
      };
    }
  }
  return {position: [...restCenter], tangent: insertionDirection};
}

/**
 * Screw translation path. A cubic Bezier launch turns onto the receiving-hole
 * axis with a tangent-continuous intercept. Orientation is handled separately
 * as one fixture-to-receiver alignment. The remaining 62% is a straight
 * powered descent along the axis, including the final threaded segment.
 */
function sampleFastenerFlight({
  stagingCenter,
  restCenter,
  approachOffset,
  normalizedTime,
  sourceIndex,
}) {
  const t = clamp01(normalizedTime);
  const outward = normalize(approachOffset, [0, 0, 1]);
  const insertionDirection = scale(outward, -1);
  const authoredApproachDistance = Math.max(0.001, length(approachOffset));
  const corridorDistance = Math.max(0.105, authoredApproachDistance * 2.8);
  const corridorStart = add(restCenter, scale(outward, corridorDistance));
  const approachCenter = add(restCenter, approachOffset);

  // The first handle gives the bank launch altitude and a slight alternating
  // yaw. The second handle lies on the insertion axis, guaranteeing that the
  // Bezier arrives tip-first with no corner at corridor entry.
  const arcSign = sourceIndex % 2 === 0 ? 1 : -1;
  const launchControl = add(stagingCenter, [0.014 * arcSign, 0, 0.052]);
  const corridorSpeed =
    (corridorDistance - authoredApproachDistance) /
    (FASTENER_PHASES.threadStart - FASTENER_PHASES.corridorEntry);
  const interceptHandle = Math.max(
    0.012,
    corridorSpeed * FASTENER_PHASES.corridorEntry / 3,
  );
  const interceptControl = add(
    corridorStart,
    scale(outward, interceptHandle),
  );

  if (t <= FASTENER_PHASES.corridorEntry) {
    const local = t / FASTENER_PHASES.corridorEntry;
    return {
      position: cubicBezier(
        stagingCenter,
        launchControl,
        interceptControl,
        corridorStart,
        local,
      ),
      tangent: normalize(cubicBezierTangent(
        stagingCenter,
        launchControl,
        interceptControl,
        corridorStart,
        local,
      ), insertionDirection),
    };
  }

  if (t <= FASTENER_PHASES.threadStart) {
    const local = (t - FASTENER_PHASES.corridorEntry) /
      (FASTENER_PHASES.threadStart - FASTENER_PHASES.corridorEntry);
    return {
      position: mix(corridorStart, approachCenter, local),
      tangent: insertionDirection,
    };
  }

  const local = (t - FASTENER_PHASES.threadStart) /
    (1 - FASTENER_PHASES.threadStart);
  return {
    position: mix(approachCenter, restCenter, softLanding(local)),
    tangent: insertionDirection,
  };
}

/** Unit world-space flight direction used for trajectory analysis and cues. */
export function sampleStagedTangent({
  stagingCenter,
  restCenter,
  approachOffset,
  normalizedTime,
  sourceIndex = 0,
  fastener = false,
  trajectoryMode = MOTION_TRAJECTORY_MODES.spatial,
}) {
  if (trajectoryMode === MOTION_TRAJECTORY_MODES.grid) {
    return sampleGridFlight({
      stagingCenter,
      restCenter,
      approachOffset,
      normalizedTime,
      sourceIndex,
      fastener,
    }).tangent;
  }
  if (fastener) {
    return sampleFastenerFlight({
      stagingCenter,
      restCenter,
      approachOffset,
      normalizedTime,
      sourceIndex,
    }).tangent;
  }
  const epsilon = 0.0005;
  const before = sampleStagedCenter({
    stagingCenter,
    restCenter,
    approachOffset,
    normalizedTime: clamp01(normalizedTime - epsilon),
    sourceIndex,
    fastener: false,
    trajectoryMode,
  });
  const after = sampleStagedCenter({
    stagingCenter,
    restCenter,
    approachOffset,
    normalizedTime: clamp01(normalizedTime + epsilon),
    sourceIndex,
    fastener: false,
    trajectoryMode,
  });
  return normalize(subtract(after, before));
}

export const STAGING_KEY_SAMPLES = Object.freeze([...new Set([
  0,
  0.06,
  0.12,
  STAGING_PHASES.liftComplete,
  GRID_PHASES.firstAxisComplete - 0.01,
  GRID_PHASES.firstAxisComplete,
  GRID_PHASES.firstAxisComplete + 0.01,
  0.24,
  0.32,
  GRID_PHASES.secondAxisComplete - 0.01,
  GRID_PHASES.secondAxisComplete,
  GRID_PHASES.secondAxisComplete + 0.01,
  FASTENER_PHASES.orientationStart,
  FASTENER_PHASES.corridorEntry,
  STAGING_PHASES.transitMidpoint,
  0.57,
  STAGING_PHASES.orientationLocked,
  STAGING_PHASES.clearanceReached,
  0.74,
  STAGING_PHASES.alignedForInsertion,
  FASTENER_PHASES.threadStart,
  0.86,
  0.90,
  0.94,
  0.98,
  1,
])].sort((a, b) => a - b));
