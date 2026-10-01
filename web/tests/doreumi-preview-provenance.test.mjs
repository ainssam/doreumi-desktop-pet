import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Execute the actual pre-browser input guard, with in-memory files. No renderer,
// filesystem fixture writes, or public registry mutations are involved.
const source = fs.readFileSync(new URL('../scripts/doreumi/motion-qa.mjs', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('if (clipOverride) {'), source.indexOf("\nif (process.argv.includes('--library'))"));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(grouped = false) {
  const bytes = Buffer.from(JSON.stringify({ name: 'meshy:22', duration: 2, tracks: [] }));
  const original = { actionId: 22, sourceSha256: 'a'.repeat(64) };
  const item = { ...original, targetRigSignature: 'rig-v3', convertedSha256: hash(bytes), retargetEvidence: { framing: { halfHeight: 2, centerY: 1 }, planarSupport: { maxOffset: .2 } } };
  const candidate = { candidate: true, motions: [item] };
  const clipContact = { actionId: 22, sourceSha256: original.sourceSha256, clipSha256: hash(bytes) };
  const contact = grouped ? { modelSha256: 'master', clips: [clipContact] } : { modelSha256: 'master', clipSha256: hash(bytes) };
  return { bytes, original, item, candidate, contact, filename: '/safe/candidate.json' };
}
async function preview(data) {
  const files = new Map([
    ['/safe/candidate.json', data.bytes], ['/safe/manifest.json', Buffer.from(JSON.stringify(data.candidate))],
    ['/safe/contact.json', JSON.stringify(data.contact)],
    ['public/doreumi/motions/meshy-source-manifest.json', JSON.stringify({ motions: [data.original] })],
    ['public/doreumi/rig-contract.json', JSON.stringify({ rigSignature: 'rig-v3', height: 2.14 })],
  ]);
  const context = vm.createContext({ process: { argv: ['--isolated-component', '--library'] }, path, createHash,
    arg: () => `meshy:${data.original.actionId}`, realpath: async file => file === '.artifacts/doreumi-contact-audit' ? '/safe' : data.filename,
    readFile: async file => { assert(files.has(file), `Unexpected file read: ${file}`); return files.get(file); },
  });
  return vm.runInContext(`(async()=>{const clipOverride='candidate',modelSha256='master',sourceRegistrySha256='registry';
    const testedRegistry={motions:[{id:'meshy:${data.original.actionId}',masterSha256:'master'}]};let overrideBytes,registrySha256,clipOverrideEvidence;
    ${block};return {review:testedRegistry.motions[0].review,ambient:testedRegistry.motions[0].ambient};})()`, context);
}
test('both measured contact formats permit only an unapproved isolated preview', async () => {
  for (const grouped of [false, true]) {
    const data = fixture(grouped);
    data.contact.manifestSha256 = hash(JSON.stringify(data.candidate));
    const result = await preview(data);
    assert.equal(result.review, 'pending'); assert.equal(result.ambient, false);
  }
});
function airborneFixture() {
  const data = fixture(true); data.original.actionId = 502; data.item.actionId = 502;
  data.bytes = Buffer.from(JSON.stringify({ name: 'meshy:502', duration: 2.5, tracks: [{ name: 'DoreumiRig.position', times: [0, 2.5], values: [0, 1, 0, 0, 1, 0] }] }));
  data.item.convertedSha256 = hash(data.bytes); delete data.item.retargetEvidence.planarSupport;
  Object.assign(data.item.retargetEvidence, { sourceTimeScale: 5, playbackSourceDuration: .9, sourceDuration: 4.5, entryDuration: .75, exitDuration: .85 });
  data.item.retargetEvidence.airborneFall = { version: 2, authoredRoot: true, sourceRootIsBallistic: false,
    sourceTimeRetimed: true, sourceTimeScale: 5, playbackSourceDuration: .9, sourceCoreDuration: 4.5, cameraPolicy: 'fixed-ground',
    verifiedSourceSha256: data.original.sourceSha256, verifiedMasterSha256: 'master', airborneSupport: 'none', palmContactClaimed: false, takeoff: .5, impact: 1.9 };
  Object.assign(data.contact.clips[0], { actionId: 502, clipSha256: hash(data.bytes), airborneSupport: 'none', palmContactClaimed: false, fps: 120,
    sourceAirborne: { confirmed: true, originalRootIsBallistic: false, minimumSkinY: .65, restFloor: 0 }, bounds: { minY: .002, maxY: 3 },
    minimumCoreSkinY: .6, maximumRootBallisticError: 1e-6, maximumPreservedCoreQuaternionError: 1e-4,
    supportPhases: [{ from: 0, to: .5, samples: 61 }, { from: 1.9, to: 2.5, samples: 74 }].map(phase => ({ ...phase,
      minimumFootY: .002, maximumFootMinimumY: .003, maximumMaterialPointDrift: .004 })),
  });
  return data;
}
test('authored airborne preview requires exact scope, source evidence and measured supported phases', async () => {
  const result = await preview(airborneFixture()); assert.equal(result.review, 'pending'); assert.equal(result.ambient, false);
  for (const tamper of [
    data => { delete data.item.retargetEvidence.airborneFall; },
    data => { data.item.retargetEvidence.airborneFall.verifiedSourceSha256 = 'b'.repeat(64); },
    data => { data.item.retargetEvidence.airborneFall.verifiedMasterSha256 = 'stale'; },
    data => { data.item.retargetEvidence.airborneFall.sourceRootIsBallistic = true; },
    data => { data.item.retargetEvidence.airborneFall.palmContactClaimed = true; },
    data => { data.item.retargetEvidence.airborneFall.version = 1; },
    data => { data.item.retargetEvidence.airborneFall.sourceTimeScale = 1; },
    data => { data.item.retargetEvidence.sourceTimeScale = 1; },
    data => { data.item.retargetEvidence.exitDuration = 3; },
    data => { data.item.retargetEvidence.airborneFall.cameraPolicy = 'tracking'; },
    data => { delete data.contact.clips[0].sourceAirborne; },
    data => { data.contact.clips[0].sourceAirborne.minimumSkinY = 0; },
    data => { data.contact.clips[0].bounds.minY = -.02; },
    data => { data.contact.clips[0].minimumCoreSkinY = 0; },
    data => { data.contact.clips[0].maximumRootBallisticError = .1; },
    data => { data.contact.clips[0].maximumPreservedCoreQuaternionError = 90; },
    data => { data.contact.clips[0].supportPhases = []; },
    data => { data.contact.clips[0].supportPhases[1].maximumMaterialPointDrift = .1; },
    data => { data.contact.clips[0].supportPhases[0].maximumFootMinimumY = .3; },
    data => { data.contact.clips[0].supportPhases[1].samples = 0; },
    data => { data.item.retargetEvidence.airborneFall.takeoff = -.5; data.contact.clips[0].supportPhases[0].to = -.5; },
    data => { data.item.retargetEvidence.airborneFall.impact = 8; data.contact.clips[0].supportPhases[1].from = 8; },
    data => { data.contact.clips[0].supportPhases[0].samples = 61.5; },
    data => { const clip = JSON.parse(data.bytes); clip.tracks[0].values[0] = .01; data.bytes = Buffer.from(JSON.stringify(clip));
      data.item.convertedSha256 = hash(data.bytes); data.contact.clips[0].clipSha256 = hash(data.bytes); },
  ]) { const data = airborneFixture(); tamper(data); await assert.rejects(preview(data), /invalid authored airborne support evidence/); }
  const unrelated = fixture(); delete unrelated.item.retargetEvidence.planarSupport;
  await assert.rejects(preview(unrelated), /invalid authored airborne support evidence/);
});
test('preview rejects malformed framing before opening the browser', async () => {
  for (const frame of [{ halfHeight: 1e9, centerY: 0 }, { halfHeight: 2, centerY: null },
    { halfHeight: 2, centerY: 1, tracking: { times: [0, 2], centerY: [0, 100] } },
    { halfHeight: 2, centerY: 1, tracking: { times: [0, 0], centerY: [0, 1] } }]) {
    const data = fixture(); data.item.retargetEvidence.framing = frame;
    await assert.rejects(preview(data), /invalid framing/);
  }
});
test('present manifest and retarget durations must match the actual clip clock', async () => {
  const valid = fixture(); valid.item.duration = 2; valid.item.retargetEvidence.duration = 2 + 1e-7;
  assert.equal((await preview(valid)).review, 'pending');
  for (const owner of ['manifest', 'evidence']) for (const duration of [10.6, null, '2']) {
    const data = fixture();
    (owner === 'manifest' ? data.item : data.item.retargetEvidence).duration = duration;
    await assert.rejects(preview(data), /duration metadata mismatch/);
  }
});
test('stationary preview rejects stale clip, source, master, rig, and manifest evidence', async () => {
  for (const tamper of [
    data => { data.contact.clipSha256 = 'b'.repeat(64); },
    data => { delete data.contact.clipSha256; },
    data => { data.item.sourceSha256 = 'b'.repeat(64); },
    data => { data.contact.sourceSha256 = 'b'.repeat(64); },
    data => { data.contact.modelSha256 = 'another-master'; },
    data => { data.item.targetRigSignature = 'another-rig'; },
    data => { data.contact.manifestSha256 = 'b'.repeat(64); },
    data => { data.bytes = Buffer.from(JSON.stringify({ name: 'meshy:22', duration: 3 })); },
    data => { data.candidate.candidate = 'true'; },
  ]) { const data = fixture(); tamper(data); await assert.rejects(preview(data), /provenance mismatch/); }
  const grouped = fixture(true); grouped.contact.clips[0].sourceSha256 = 'b'.repeat(64);
  await assert.rejects(preview(grouped), /provenance mismatch/);
});
test('resolved paths outside the candidate root fail before any candidate bytes are read', async () => {
  for (const filename of ['/safe-other/candidate.json', '/elsewhere/symlink-target.json', '/safe/candidate.txt']) {
    const data = fixture(); data.filename = filename;
    await assert.rejects(preview(data), /limited to local contact-audit/);
  }
});
