import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAcrobaticsContract, validateAcrobaticsOutput } from '../scripts/doreumi/meshy-acrobatics-contract.mjs';

const identity = { actionId: 406,
  sourceSha256: 'f0b484f4bf1fe3f7113cd0be005e6306c5cc6a908e88b3e17088a41ea1aa77ba',
  masterSha256: 'ff950b38e254c5a92c4d198bc333cf9b5763883f5f824de06b8c688019f0afa1' };

test('acrobatics replay is bound to the actual donor and immutable master', () => {
  assert.ok(loadAcrobaticsContract(identity));
  for (const key of ['sourceSha256', 'masterSha256']) assert.throws(() => loadAcrobaticsContract({ ...identity, [key]: '0'.repeat(64) }), /changed/);
  assert.equal(loadAcrobaticsContract({ ...identity, actionId: 395 }), undefined);
});

test('changed output and changed support metadata cannot bypass the exact replay contract', () => {
  const contract = loadAcrobaticsContract(identity);
  assert.throws(() => validateAcrobaticsOutput({ ...contract }, {}, {}), /Unknown/);
  assert.throws(() => validateAcrobaticsOutput(contract, {}, {}), /not written/);
});

test('airborne fall replay also binds the explicit source clock and fixed camera', () => {
  const airborne = { ...identity, actionId: 502, sourceSha256: 'd4eeaeea8e16dc1ec703aeb13f42eaf7fd638923258ef4923efdd5efa847990b' };
  assert.equal(loadAcrobaticsContract(airborne).version, 2);
  assert.throws(() => loadAcrobaticsContract({ ...airborne, sourceSha256: identity.sourceSha256 }), /changed/);
});

test('shipping acrobatics preserve the reviewed clip, timing, framing, and support', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/doreumi/motions/meshy-source-manifest.json', import.meta.url)));
  for (const actionId of [406, 502]) {
    const entry = manifest.motions.find(motion => motion.actionId === actionId);
    const json = JSON.parse(fs.readFileSync(new URL(`../public/doreumi/motions/meshy-${actionId}.json`, import.meta.url)));
    const contract = loadAcrobaticsContract({ actionId, sourceSha256: entry.sourceSha256, masterSha256: identity.masterSha256 });
    const result = validateAcrobaticsOutput(contract, json, entry.retargetEvidence);
    assert.equal(result.convertedSha256, entry.convertedSha256);
    const altered = structuredClone(entry.retargetEvidence);
    altered.framing.halfHeight += .01;
    assert.throws(() => validateAcrobaticsOutput(contract, json, altered), /support metadata/);
    if (actionId === 502) {
      const clock = { ...entry.retargetEvidence, sourceTimeScale: 1 };
      assert.throws(() => validateAcrobaticsOutput(contract, json, clock), /support metadata/);
    }
  }
});
