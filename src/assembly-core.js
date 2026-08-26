const MAX_STEPS = 200;

export function normalizeManifest(input) {
  const errors = [];
  const warnings = [];
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    return { errors: ['Manifest must be a JSON object.'], warnings, manifest: null };
  }

  const title = String(input.title || 'Untitled assembly').trim().slice(0, 80);
  if (!Array.isArray(input.steps)) {
    return { errors: ['Manifest must contain a steps array.'], warnings, manifest: null };
  }
  if (!input.steps.length) errors.push('Manifest must contain at least one stage.');
  if (input.steps.length > MAX_STEPS) errors.push(`Manifest is limited to ${MAX_STEPS} stages.`);

  const ids = new Set();
  const steps = input.steps.slice(0, MAX_STEPS).map((raw, index) => {
    const baseId = String(raw?.id || `step-${String(index + 1).padStart(2, '0')}`).trim();
    let id = baseId || `step-${String(index + 1).padStart(2, '0')}`;
    if (ids.has(id)) {
      warnings.push(`Duplicate ID “${id}” was made unique.`);
      id = `${id}-${index + 1}`;
    }
    ids.add(id);

    const label = String(raw?.label || `Stage ${index + 1}`).trim().slice(0, 100);
    const group = String(raw?.group || 'ASSEMBLY').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 20) || 'ASSEMBLY';
    let durationMs = Math.round(Number(raw?.durationMs));
    if (!Number.isFinite(durationMs)) durationMs = 1200;
    if (durationMs < 250 || durationMs > 120000) {
      warnings.push(`${id}: duration was clamped to the supported 250–120000 ms range.`);
      durationMs = Math.min(120000, Math.max(250, durationMs));
    }
    return { id, label, group, durationMs };
  });

  return {
    errors,
    warnings,
    manifest: {
      $schema: './schemas/assembly-sequence.schema.json',
      version: 1,
      title,
      steps,
    },
  };
}

export function totalDuration(steps) {
  return steps.reduce((total, step) => total + step.durationMs, 0);
}

export function timelineAt(steps, timeMs) {
  const total = totalDuration(steps);
  if (!steps.length || total <= 0) return { index: -1, localProgress: 0, fills: [] };
  const safeTime = Math.min(Math.max(0, timeMs), total);
  let cursor = 0;
  let activeIndex = steps.length - 1;
  const fills = steps.map((step, index) => {
    const start = cursor;
    const end = cursor + step.durationMs;
    cursor = end;
    const fill = Math.min(1, Math.max(0, (safeTime - start) / step.durationMs));
    if (safeTime >= start && (safeTime < end || safeTime === total)) activeIndex = index;
    return fill;
  });
  return { index: activeIndex, localProgress: fills[activeIndex] ?? 0, fills };
}
