import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBatches, assertBudget, inspectGlb, PILOT_IDS } from '../scripts/doreumi/meshy-acquire.mjs';

const catalog = JSON.parse(fs.readFileSync(new URL('../scripts/doreumi/meshy-library.json', import.meta.url)));

test('paid acquisition covers each of the 524 approved actions exactly once in batches of at most ten', () => {
  const batches = makeBatches(catalog.motions);
  assert.equal(batches.length, 53);
  assert.deepEqual(batches[0].actionIds, PILOT_IDS);
  assert.equal(new Set(batches.flatMap(batch => batch.actionIds)).size, 524);
  assert.equal(batches.reduce((sum, batch) => sum + batch.expectedCredits, 0), 1572);
  assert(batches.every(batch => batch.actionIds.length > 0 && batch.actionIds.length <= 10));
  assert.throws(() => makeBatches(catalog.motions.slice(1)), /exactly 524/);
  assert.throws(() => makeBatches(catalog.motions.map((item, index) => index ? item : { ...item, sourceCategory: 'Fighting' })), /non-Fighting/);
});

test('budget retains 180 credits and counts unresolved POST intents against the approved maximum', () => {
  const ledger = { rig: { status: 'not_submitted', expectedCredits: 5 }, batches: makeBatches(catalog.motions) };
  assertBudget(ledger, ledger.rig, 185);
  assert.throws(() => assertBudget(ledger, ledger.rig, 184), /Reserved/);
  ledger.rig.status = 'submission_unknown';
  assert.throws(() => assertBudget(ledger, ledger.rig, 1757), /already submitted/);
  for (const batch of ledger.batches) { assertBudget(ledger, batch, 1757); batch.status = 'PENDING'; }
  assert.throws(() => assertBudget(ledger, { status: 'not_submitted', expectedCredits: 3 }, 1757), /budget/);
  assert.throws(() => assertBudget(ledger, ledger.batches[0], Number.NaN), /Invalid balance/);
});

function fixture() {
  const doc = { asset: { version: '2.0' }, nodes: [{ name: 'Hips' }], skins: [{ joints: [0] }],
    buffers: [{ byteLength: 12 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 4 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR' }, { bufferView: 1, componentType: 5126, count: 1, type: 'SCALAR' }],
    animations: [{ name: 'motion', channels: [{}, {}], samplers: [{ input: 0 }, { input: 1 }] }] };
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const bytes = Buffer.alloc(12 + 8 + json.length + 8 + 12);
  bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  const binary = 20 + json.length;
  bytes.writeUInt32LE(12, binary); bytes.writeUInt32LE(0x004e4942, binary + 4);
  bytes.writeFloatLE(0, binary + 8); bytes.writeFloatLE(2, binary + 12); bytes.writeFloatLE(0, binary + 16);
  return bytes;
}

test('GLB verification accepts constant bone channels without optional time min/max, but rejects truncated or missing clips', () => {
  const bytes = fixture();
  assert.equal(inspectGlb(bytes, 1).clips[0].duration, 2);
  assert.throws(() => inspectGlb(bytes, 2), /Expected 2/);
  assert.throws(() => inspectGlb(bytes.subarray(0, bytes.length - 1), 1), /complete GLB/);
});
