import './shell.js';
import { normalizeManifest, timelineAt, totalDuration } from './assembly-core.js';

const initial = {
  title: 'SO-101 assembly',
  steps: [
    { id: 'prepare', label: 'Prepare the workspace', group: 'PREP', durationMs: 1200 },
    { id: 'base', label: 'Build the base', group: 'FRAME', durationMs: 1800 },
    { id: 'arm', label: 'Add the arm links', group: 'MOTION', durationMs: 2400 },
    { id: 'wrist', label: 'Install the wrist', group: 'MOTION', durationMs: 1800 },
    { id: 'cable', label: 'Route the servo cable', group: 'WIRING', durationMs: 2100 },
    { id: 'check', label: 'Run final checks', group: 'CHECK', durationMs: 1400 },
  ],
};

let manifest = normalizeManifest(initial).manifest;
let currentMs = 0;
let playing = false;
let playbackRate = 1;
let lastFrame = 0;
let frameHandle = 0;

const titleInput = document.querySelector('#sequence-title');
const stepsTable = document.querySelector('#steps-table');
const segments = document.querySelector('#progress-segments');
const activeStep = document.querySelector('#active-step');
const playButton = document.querySelector('#play');
const scrubber = document.querySelector('#scrubber');
const messagePanel = document.querySelector('#sequence-messages');
const fileInput = document.querySelector('#sequence-file');

function formatTime(value) {
  const seconds = Math.max(0, value) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function showMessages(errors = [], warnings = [], success = '') {
  messagePanel.replaceChildren();
  messagePanel.hidden = !errors.length && !warnings.length && !success;
  messagePanel.classList.toggle('is-success', Boolean(success) && !errors.length);
  if (success) messagePanel.textContent = success;
  const items = [...errors, ...warnings];
  if (items.length) {
    const list = document.createElement('ul');
    for (const text of items) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    messagePanel.append(list);
  }
}

function updateManifestFromRows() {
  const input = {
    title: titleInput.value,
    steps: [...stepsTable.querySelectorAll('.step-row')].map((row) => ({
      id: row.dataset.id,
      label: row.querySelector('[data-field="label"]').value,
      group: row.querySelector('[data-field="group"]').value,
      durationMs: row.querySelector('[data-field="durationMs"]').value,
    })),
  };
  const result = normalizeManifest(input);
  if (result.manifest) manifest = result.manifest;
  currentMs = Math.min(currentMs, totalDuration(manifest.steps));
  renderTimelineStructure();
  updatePlaybackView();
  showMessages(result.errors, result.warnings);
}

function makeInput(value, field, extraClass = '') {
  const input = document.createElement('input');
  input.className = `step-input ${extraClass}`.trim();
  input.value = value;
  input.dataset.field = field;
  input.setAttribute('aria-label', field === 'durationMs' ? 'Stage duration in milliseconds' : `Stage ${field}`);
  if (field === 'durationMs') { input.type = 'number'; input.min = '250'; input.max = '120000'; input.step = '50'; }
  return input;
}

function renderRows() {
  stepsTable.replaceChildren();
  manifest.steps.forEach((step, index) => {
    const row = document.createElement('div');
    row.className = 'step-row';
    row.dataset.id = step.id;
    const idx = document.createElement('span');
    idx.className = 'step-index';
    idx.textContent = String(index + 1).padStart(2, '0');
    const durationWrap = document.createElement('div');
    durationWrap.className = 'step-duration-wrap';
    durationWrap.append(makeInput(step.durationMs, 'durationMs'), Object.assign(document.createElement('span'), { textContent: 'ms' }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-step';
    remove.dataset.remove = String(index);
    remove.setAttribute('aria-label', `Remove ${step.label}`);
    remove.textContent = '×';
    row.append(idx, makeInput(step.label, 'label'), makeInput(step.group, 'group', 'step-group'), durationWrap, remove);
    stepsTable.append(row);
  });
}

function renderTimelineStructure() {
  document.querySelector('#preview-title').textContent = manifest.title;
  document.querySelector('#total-time').textContent = formatTime(totalDuration(manifest.steps));
  segments.replaceChildren();
  for (const step of manifest.steps) {
    const segment = document.createElement('span');
    segment.className = 'progress-segment';
    segment.dataset.group = step.group;
    segment.title = `${step.label} · ${step.durationMs} ms`;
    segment.style.setProperty('--duration', String(step.durationMs));
    segment.style.setProperty('--fill', '0');
    segments.append(segment);
  }
}

function updatePlaybackView() {
  const total = totalDuration(manifest.steps);
  const state = timelineAt(manifest.steps, currentMs);
  document.querySelector('#current-time').textContent = formatTime(currentMs);
  document.querySelector('#total-time').textContent = formatTime(total);
  scrubber.value = total ? String(Math.round(currentMs / total * 1000)) : '0';
  [...segments.children].forEach((segment, index) => {
    segment.style.setProperty('--fill', state.fills[index] ?? 0);
    segment.classList.toggle('is-active', index === state.index);
  });
  const step = manifest.steps[state.index];
  if (step) {
    activeStep.querySelector('.active-index').textContent = String(state.index + 1).padStart(2, '0');
    activeStep.querySelector('strong').textContent = step.label;
    activeStep.querySelector('.active-group').textContent = step.group;
  }
}

function stopPlayback() {
  playing = false;
  cancelAnimationFrame(frameHandle);
  playButton.textContent = 'Play preview';
}

function tick(timestamp) {
  if (!playing) return;
  if (!lastFrame) lastFrame = timestamp;
  currentMs += (timestamp - lastFrame) * playbackRate;
  lastFrame = timestamp;
  const total = totalDuration(manifest.steps);
  if (currentMs >= total) {
    currentMs = total;
    stopPlayback();
  }
  updatePlaybackView();
  if (playing) frameHandle = requestAnimationFrame(tick);
}

function loadManifest(input, source = 'manifest') {
  const result = normalizeManifest(input);
  if (!result.manifest || result.errors.length) {
    showMessages(result.errors, result.warnings);
    return;
  }
  stopPlayback();
  manifest = result.manifest;
  currentMs = 0;
  titleInput.value = manifest.title;
  renderRows();
  renderTimelineStructure();
  updatePlaybackView();
  showMessages([], result.warnings, `Loaded ${manifest.steps.length} stages from ${source}.`);
}

titleInput.addEventListener('input', updateManifestFromRows);
stepsTable.addEventListener('change', updateManifestFromRows);
stepsTable.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (!remove || manifest.steps.length <= 1) return;
  manifest.steps.splice(Number(remove.dataset.remove), 1);
  renderRows();
  updateManifestFromRows();
});
document.querySelector('#add-step').addEventListener('click', () => {
  manifest.steps.push({ id: `step-${Date.now().toString(36)}`, label: `Stage ${manifest.steps.length + 1}`, group: 'ASSEMBLY', durationMs: 1200 });
  renderRows();
  updateManifestFromRows();
  stepsTable.lastElementChild?.querySelector('[data-field="label"]')?.focus();
});
playButton.addEventListener('click', () => {
  if (playing) { stopPlayback(); return; }
  if (currentMs >= totalDuration(manifest.steps)) currentMs = 0;
  playing = true;
  lastFrame = 0;
  playButton.textContent = 'Pause';
  frameHandle = requestAnimationFrame(tick);
});
document.querySelector('#restart').addEventListener('click', () => { stopPlayback(); currentMs = 0; updatePlaybackView(); });
scrubber.addEventListener('input', () => { stopPlayback(); currentMs = Number(scrubber.value) / 1000 * totalDuration(manifest.steps); updatePlaybackView(); });
document.querySelector('#speed').addEventListener('change', (event) => { playbackRate = Number(event.target.value); });
document.querySelector('#import-sequence').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try { loadManifest(JSON.parse(await file.text()), file.name); }
  catch (error) { showMessages([`Could not parse this JSON: ${error.message}`]); }
});
document.querySelector('#export-sequence').addEventListener('click', () => {
  updateManifestFromRows();
  const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'so101-assembly-sequence.json';
  link.click();
  URL.revokeObjectURL(link.href);
  showMessages([], [], 'Manifest exported.');
});

renderRows();
renderTimelineStructure();
updatePlaybackView();
