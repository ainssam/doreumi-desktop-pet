/**
 * Runtime motion index: the small list the page actually needs.
 *
 * `public/doreumi/motions/registry.json` (about 2.4MB) is the review registry: 524 entries with
 * provenance hashes, semantics audits and evidence paths. The page-wide mascot only ever plays
 * - the home director's repertoire (ambientMotionCatalog, the same filter useDoreumiPersonality,
 *   the shop motion picker and the runtime apply), and
 * - imported clips that the code asks for by id (ledge crossing, lure, startle, notebook cheer).
 * This script writes exactly those entries, with only the fields the runtime reads, to
 * `registry.runtime.json` (about 50KB). Dev and review tools keep reading the full registry, and
 * the runtime falls back to the full registry for any id that is not in this index.
 *
 *   node --import ./tests/register-alias.mjs scripts/doreumi/build-motion-runtime.mjs          # write
 *   node --import ./tests/register-alias.mjs scripts/doreumi/build-motion-runtime.mjs --check  # fail when stale (prebuild)
 */
import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ambientMotionCatalog, parseMotionLibrary } from '../../src/lib/doreumi/motion-library.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(root, 'public/doreumi/motions/registry.json');
const OUTPUT = path.join(root, 'public/doreumi/motions/registry.runtime.json');
/** Fields the runtime, the director and the shop picker read. Everything else is review provenance. */
export const RUNTIME_MOTION_FIELDS = ['id', 'sourceActionId', 'label', 'family', 'duration', 'review', 'ambient', 'url', 'exclusionReason',
  'props', 'expression', 'frame', 'travel', 'entryDuration', 'exitDuration', 'planarSupport', 'environmentSupport'];

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Dev review pages read the full registry themselves.
      if (full === path.join(root, 'src/app/dev')) continue;
      out.push(...await sourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Imported clips named in code (`"meshy:417"`), so a new literal can never miss the index. */
async function referencedIds() {
  const ids = new Set();
  for (const file of await sourceFiles(path.join(root, 'src'))) {
    for (const match of (await readFile(file, 'utf8')).matchAll(/["'`]meshy:(\d{1,4})["'`]/g)) ids.add(`meshy:${match[1]}`);
  }
  return ids;
}

export async function buildRuntimeIndex() {
  const library = parseMotionLibrary(JSON.parse(await readFile(SOURCE, 'utf8')));
  const wanted = new Set(ambientMotionCatalog(library.motions).map(item => item.id));
  const named = await referencedIds();
  const missing = [...named].filter(id => !library.motions.some(item => item.id === id));
  if (missing.length) throw new Error(`Code names motions that are not in the registry: ${missing.join(', ')}`);
  for (const id of named) wanted.add(id);
  const motions = library.motions.filter(item => wanted.has(item.id) && item.url)
    .map(item => Object.fromEntries(RUNTIME_MOTION_FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]])));
  // The runtime parses this with the same validator as the full registry.
  const index = parseMotionLibrary({ version: 1, motions });
  return `${JSON.stringify(index)}\n`;
}

const check = process.argv.includes('--check');
const next = await buildRuntimeIndex();
const current = await readFile(OUTPUT, 'utf8').catch(() => null);
if (check) {
  if (current !== next) {
    console.error('[doreumi] public/doreumi/motions/registry.runtime.json is stale. Run: node --import ./tests/register-alias.mjs scripts/doreumi/build-motion-runtime.mjs');
    process.exit(1);
  }
} else if (current !== next) {
  await writeFile(`${OUTPUT}.tmp`, next);
  await rename(`${OUTPUT}.tmp`, OUTPUT);
  console.log(`[doreumi] wrote ${path.relative(root, OUTPUT)} (${JSON.parse(next).motions.length} motions, ${next.length} bytes)`);
} else console.log('[doreumi] runtime motion index is up to date');
