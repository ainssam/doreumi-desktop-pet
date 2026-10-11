import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCacheAssets, immutableName } from '../scripts/doreumi/build-cache-assets.mjs';

test('immutable assets retain exact bytes, stable names and previous versions across updates', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'doreumi-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public/doreumi/motions'), { recursive: true });
  const model = Buffer.from([0, 10, 255, 123]);
  const registry = Buffer.from('{"version":1,"motions":[]}\n');
  await writeFile(path.join(root, 'public/doreumi/doreumi-master.glb'), model);
  await writeFile(path.join(root, 'public/doreumi/motions/registry.runtime.json'), registry);
  await assert.rejects(buildCacheAssets(root, true), /stale/);
  await buildCacheAssets(root);
  await buildCacheAssets(root, true);
  const directory = path.join(root, 'public/doreumi/immutable');
  const original = immutableName('doreumi-master.glb', model);
  assert.deepEqual(await readFile(path.join(directory, original)), model);
  assert.deepEqual(await readFile(path.join(directory, immutableName('registry.runtime.json', registry))), registry);
  assert.match(await readFile(path.join(root, 'src/lib/doreumi/motion-asset-urls.ts'), 'utf8'), /DOREUMI_MODEL_URL = '\/doreumi\/immutable\//);
  await buildCacheAssets(root);
  assert.equal((await readdir(directory)).length, 2);
  const updated = Buffer.from([0, 10, 255, 124]);
  await writeFile(path.join(root, 'public/doreumi/doreumi-master.glb'), updated);
  await assert.rejects(buildCacheAssets(root, true), /stale/);
  await buildCacheAssets(root);
  await buildCacheAssets(root, true);
  assert.equal((await readdir(directory)).length, 3);
  assert.deepEqual(await readFile(path.join(directory, original)), model);
  assert.deepEqual(await readFile(path.join(directory, immutableName('doreumi-master.glb', updated))), updated);
  await writeFile(path.join(directory, original), 'tampered');
  await assert.rejects(buildCacheAssets(root, true), /modified/);
});

test('checked-in cache assets and generated runtime URLs match their sources', async () => {
  await buildCacheAssets(undefined, true);
});
