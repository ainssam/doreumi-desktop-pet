import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { loadReviewedContactPlan, validateReviewedContactPlan } from '../scripts/doreumi/meshy-reviewed-contact.mjs';
import { createMasterSupport, createSourceSupport } from '../scripts/doreumi/meshy-master-support.mjs';
import { createPlanarFootSampler, retargetSourceLegPose } from '../scripts/doreumi/meshy-planar-support.mjs';
import { splitReviewedStageSupport, stageSourceSampleTime } from '../scripts/doreumi/meshy-stage-support.mjs';
import { sourceTailEvidence } from '../scripts/doreumi/meshy-source-tail.mjs';
import { retargetAnimation } from '../scripts/doreumi/meshy-retarget.mjs';

const read = id => JSON.parse(fs.readFileSync(`scripts/doreumi/contact-plans/${id}.json`, 'utf8'));
const identity = plan => ({ actionId: plan.actionId, sourceSha256: plan.sourceSha256, masterSha256: plan.masterSha256 });

test('stage support uses the audited source-tail clock and rejects mismatched provenance', () => {
  const metadata = { actionId: 463, sourceSha256: '4d4ada0b91b84eca55bcefd07e582555d0822e35cd7e13e432e47209d55eb018' };
  const sourceDuration = 2.3333332538604736, repair = sourceTailEvidence(metadata, sourceDuration);
  const evidence = { sourceDuration, sourceTailRepair: repair };
  assert.equal(stageSourceSampleTime('meshy:463', evidence, metadata, sourceDuration), repair.retainedSourceDuration);
  assert.equal(stageSourceSampleTime('meshy:463', evidence, metadata, 1.8), 1.8);
  assert.equal(stageSourceSampleTime('meshy:40', {}, undefined, 1.8), 1.8);
  assert.throws(() => stageSourceSampleTime('meshy:463', evidence, undefined, sourceDuration), /metadata/);
  assert.throws(() => stageSourceSampleTime('meshy:463', evidence, { ...metadata, sourceSha256: '0'.repeat(64) }, sourceDuration), /checksum/);
  assert.throws(() => stageSourceSampleTime('meshy:463', { ...evidence, sourceTailRepair: undefined }, metadata, sourceDuration), /repair differs/);
});

test('reviewed plans bind to the published exact clips and preserve complete sample paths', () => {
  for (const id of [22, 23, 24, 27, 40, 63, 67, 578, 591, 592, 596, 599]) {
    const expected = read(id), plan = loadReviewedContactPlan(identity(expected));
    const bytes = fs.readFileSync(`public/doreumi/motions/meshy-${id}.json`);
    assert.equal(plan.convertedSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(plan.plannedRootPath.length, Math.ceil(plan.sourceDuration * 30) + 1);
    assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(loadReviewedContactPlan({ actionId: 68 }), undefined);
});

test('changed donor/master and truncated planned paths fail before retarget writes', () => {
  const plan = read(23), expected = identity(plan);
  assert.throws(() => validateReviewedContactPlan(plan, { ...expected, sourceSha256: '0'.repeat(64) }), /hash changed/);
  assert.throws(() => validateReviewedContactPlan(plan, { ...expected, masterSha256: '0'.repeat(64) }), /hash changed/);
  const truncated = structuredClone(plan); truncated.plannedContactFrames.pop();
  assert.throws(() => validateReviewedContactPlan(truncated, expected), /sample count/);
});

test('stage plans require both virtual clip and regenerated frame/travel hashes', () => {
  for (const actionId of [40, 578]) {
  const plan = read(actionId), expected = identity(plan);
  for (const key of ['virtualClipSha256', 'stageMetadataSha256']) {
    const missing = structuredClone(plan); delete missing[key];
    assert.throws(() => validateReviewedContactPlan(missing, expected), /stage split contract/);
  }
  const unsplit = structuredClone(plan); delete unsplit.stageSplit;
  assert.throws(() => validateReviewedContactPlan(unsplit, expected), /stage split contract/);
  }
  const stationary = read(22); stationary.stageSplit = true;
  assert.throws(() => validateReviewedContactPlan(stationary, identity(stationary)), /stage split contract/);
});

test('nonfinite skin goals and unbounded root/pole corrections are rejected', () => {
  const original = read(24), expected = identity(original);
  const root = structuredClone(original); root.plannedRootPath[0][0] = 2.1;
  assert.throws(() => validateReviewedContactPlan(root, expected), /bounded/);
  const skin = structuredClone(original), contact = skin.plannedContactFrames.find(frame => Object.keys(frame).length);
  Object.values(contact)[0].goal[0] = NaN;
  assert.throws(() => validateReviewedContactPlan(skin, expected), /skin contact/);
  const angle = structuredClone(original); angle.plannedPoleAngles[0].L = Math.PI + .001;
  assert.throws(() => validateReviewedContactPlan(angle, expected), /knee-plane/);
});

test('actual acquired donors and reviewed plans reproduce the exact published bytes', async context => {
  const cache = '.artifacts/doreumi-meshy', ledgerFile = `${cache}/ledger.json`;
  if (!fs.existsSync(ledgerFile)) return context.skip('Offline donor acquisition cache is not present.');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile));
  const contract = JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json'));
  const masterFile = 'public/doreumi/doreumi-master.glb';
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const masterSha256 = hash(fs.readFileSync(masterFile));
  const support = await createMasterSupport(masterFile, contract);
  const targetSampler = createPlanarFootSampler(support.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const targetLegSampler = createPlanarFootSampler(support.document, { L: ['kneeL', 'shinL'], R: ['kneeR', 'shinR'] }, { morphWeight: 1 });
  const handSampler = createPlanarFootSampler(support.document, { L: ['wristL'], R: ['wristR'] }, { morphWeight: 1 });
  const catalog = JSON.parse(fs.readFileSync('scripts/doreumi/meshy-library.json')).motions;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const actionId of [22, 23, 24, 27, 40, 63, 67, 578, 591, 592, 596, 599]) {
    const batch = ledger.batches.find(item => item.status === 'downloaded' && item.actionIds.includes(actionId));
    assert.ok(batch, `Acquired donor ${actionId} is required for reproduction.`);
    const sourceFile = `${cache}/${batch.file}`, sourceSha256 = hash(fs.readFileSync(sourceFile));
    const plan = loadReviewedContactPlan({ actionId, sourceSha256, masterSha256 });
    const document = await io.read(sourceFile), sourceSupport = createSourceSupport(document);
    const sourceSampler = createPlanarFootSampler(document, { L: ['LeftFoot', 'LeftToeBase'], R: ['RightFoot', 'RightToeBase'] }, { morphWeight: 0 });
    const adaptSourceLegs = (target, source, _ratio, update) => retargetSourceLegPose(target,
      Object.fromEntries(['L', 'R'].map(side => [side, Object.fromEntries([['hip', 'UpLeg'], ['knee', 'Leg'], ['foot', 'Foot']]
        .map(([key, suffix]) => [key, source.byName.get((side === 'L' ? 'Left' : 'Right') + suffix).worldPosition.toArray()]))])), update);
    const metadata = { ...catalog.find(item => item.actionId === actionId), sourceSha256 };
    let { json, evidence } = retargetAnimation(document, document.getRoot().listAnimations()[batch.actionIds.indexOf(actionId)],
      actionId, contract, support, sourceSupport, metadata, { sourceSampler, targetSampler, targetLegSampler, handSampler, ...plan, adaptSourceLegs });
    if (plan.stageSplit) {
      assert.equal(hash(JSON.stringify(json) + '\n'), plan.virtualClipSha256);
      ({ json, evidence } = splitReviewedStageSupport({ json, evidence, document, animation: document.getRoot().listAnimations()[batch.actionIds.indexOf(actionId)], contract, support, sourceSampler, targetSampler }));
      assert.equal(evidence.semantics.travel.contactEvidence.sourcePlantedPairs, actionId === 40 ? 383 : 50);
      assert.equal(evidence.semantics.travel.contactEvidence.missingTargetContactPairs, 0);
      assert.equal(evidence.planarSupport, undefined);
      assert.equal(hash(JSON.stringify({ frame: evidence.framing, travel: evidence.semantics.travel })), plan.stageMetadataSha256);
    }
    assert.ok(Math.abs(evidence.sourceDuration - plan.sourceDuration) < 1e-7);
    const bytes = JSON.stringify(json) + '\n';
    assert.equal(hash(bytes), plan.convertedSha256, `Reviewed motion ${actionId} no longer reproduces the approved clip.`);
    assert.equal(bytes, fs.readFileSync(`public/doreumi/motions/meshy-${actionId}.json`, 'utf8'));
    context.diagnostic(JSON.stringify({ actionId, sourceSha256, masterSha256, planSha256: plan.planSha256, reproducedClipSha256: hash(bytes) }));
  }
});
