import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseMotionLibrary, chooseAmbientMotion } from '../src/lib/doreumi/motion-library.ts';
import { motionMetadataSha256 } from '../scripts/doreumi/motion-metadata.mjs';

const environmentSupport = {
  version: 1, kind: 'low-ledge',
  geometry: { width: 2.25, frontZ: .68, depth: .22, wallTop: .75, top: .8, railZ: .545,
    railRadius: .024, rails: [[-.98, -.24], [.42, .98]], footstepTop: .154, footstepFrontZ: .3, footstepBackZ: .75 },
  targetHandVertices: { L: 78037, R: 850 }, targetFootVertices: { L: 65106, R: 13384 },
};
const entry = { id: 'meshy:619', sourceActionId: 619, label: 'wall', family: 'play', duration: 5,
  review: 'passed', ambient: true, url: '/doreumi/motions/meshy-619.json', props: ['climbing-surface'],
  planarSupport: { version: 1, maxOffset: .18 }, environmentSupport };

test('a fixed environment is accepted only with its bounded local movement and reviewed action', () => {
  assert.equal(parseMotionLibrary({ version: 1, motions: [entry] }).motions.length, 1);
  assert.equal(chooseAmbientMotion([entry], [])?.id, entry.id);
  assert.equal(chooseAmbientMotion([{ ...entry, review: 'pending' }], []), null);
  for (const invalid of [
    { ...entry, planarSupport: undefined },
    { ...entry, id: 'meshy:618', sourceActionId: 618 },
    { ...entry, environmentSupport: { ...environmentSupport, geometry: { ...environmentSupport.geometry, width: Infinity } } },
  ]) assert.throws(() => parseMotionLibrary({ version: 1, motions: [invalid] }));
});

test('support geometry changes invalidate metadata identity without changing existing review identities', () => {
  const source = JSON.parse(readFileSync(new URL('../public/doreumi/motions/meshy-source-manifest.json', import.meta.url)));
  const registry = JSON.parse(readFileSync(new URL('../public/doreumi/motions/registry.json', import.meta.url)));
  for (const registered of registry.motions) {
    const imported = source.motions.find(item => item.actionId === registered.sourceActionId);
    if (imported?.retarget === 'converted') assert.equal(motionMetadataSha256(imported), registered.metadataSha256);
  }
  const imported = { retargetEvidence: { environmentSupport } };
  const changed = structuredClone(imported);
  changed.retargetEvidence.environmentSupport.geometry.top += .01;
  assert.notEqual(motionMetadataSha256(imported), motionMetadataSha256(changed));
});
