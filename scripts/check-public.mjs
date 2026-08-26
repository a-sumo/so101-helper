import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const root = new URL('..', import.meta.url).pathname;
const ignored = new Set(['.git', 'dist', 'node_modules']);
const blockedExtensions = new Set(['.glb', '.gltf', '.stl', '.step', '.wav', '.mp3', '.mov', '.mp4', '.lspkg']);
const blockedText = [
  'BEGIN PRIVATE KEY',
  'PRIVATE_API_KEY',
  'calibration/robots/',
  '/Users/',
];
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    const name = relative(root, path);
    if (name === 'scripts/check-public.mjs') continue;
    const info = await stat(path);
    if (info.size > 500_000) findings.push(`${name}: file exceeds 500 KB`);
    if (blockedExtensions.has(extname(path).toLowerCase())) findings.push(`${name}: private/product asset type is not allowed`);
    if (info.size < 500_000) {
      const text = await readFile(path, 'utf8').catch(() => '');
      for (const marker of blockedText) {
        if (text.includes(marker)) findings.push(`${name}: contains a blocked private-data marker`);
      }
    }
  }
}

await walk(root);

if (findings.length) {
  console.error('Public payload audit failed:\n' + findings.map((finding) => `- ${finding}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Public payload audit passed: no private product markers or binary product assets found.');
}
