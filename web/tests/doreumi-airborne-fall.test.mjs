import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { AnimationClip } from 'three';
import { AIRBORNE_FALL, adaptAirborneFall } from '../scripts/doreumi/meshy-airborne-fall.mjs';
import { auditAirborneFall } from '../scripts/doreumi/meshy-airborne-audit.mjs';
import { createFloorTransitionLibrary } from '../scripts/doreumi/meshy-transition.mjs';
import { serializeClip, targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';
import { advanceMotionCamera, blendMotionFrames, validMotionFrame } from '../src/lib/doreumi/motion-camera.ts';

const read = file => JSON.parse(fs.readFileSync(file)), sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const master = 'public/doreumi/doreumi-master.glb', contract = read('public/doreumi/rig-contract.json');
const entry = read('public/doreumi/motions/meshy-source-manifest.json').motions.find(item => item.actionId === 502);
const originalJson = read('public' + entry.url), originalClip = AnimationClip.parse(originalJson);
const prepared = (async () => {
  const library = { ...await createFloorTransitionLibrary(master, contract), masterSha256: sha(master) };
  const result = adaptAirborneFall(originalClip, entry.retargetEvidence, entry, library, serializeClip);
  return { library, ...result, json: serializeClip(result.clip) };
})();

test('airborne adaptation is source/master bound and cannot alter another action', async () => {
  const { library } = await prepared;
  for (const [metadata, currentLibrary, evidence] of [
    [{ ...entry, sourceSha256: undefined }, library, entry.retargetEvidence],
    [{ ...entry, sourceSha256: 'f'.repeat(64) }, library, entry.retargetEvidence],
    [entry, { ...library, masterSha256: 'f'.repeat(64) }, entry.retargetEvidence],
    [entry, library, { ...entry.retargetEvidence, sourceDuration: 4.6 }],
  ]) assert.throws(() => adaptAirborneFall(originalClip, evidence, metadata, currentLibrary, serializeClip), /changed; re-audit/);
  assert.equal(adaptAirborneFall(originalClip, entry.retargetEvidence, { ...entry, actionId: 501 }, library, serializeClip).clip, originalClip);
  assert.equal(sha(master), AIRBORNE_FALL.masterSha256);
});

test('serialized airborne root preserves core rotations and actual foot material points', async context => {
  const { json, evidence, library } = await prepared;
  const audit = auditAirborneFall({ json, evidence, contract, support: library.support, originalJson, originalEvidence: entry.retargetEvidence });
  assert.ok(audit.bounds.minY > -.0001, 'The deformed skin must remain above the floor');
  assert.ok(audit.minimumCoreSkinY > .25, 'The retimed source freefall cycle must stay airborne');
  assert.ok(audit.maximumRootBallisticError < .00001);
  assert.ok(audit.maximumPreservedCoreQuaternionError < .001);
  // V2 intentionally compresses 4.5 seconds of limb motion into .9 seconds.
  // Report the absolute peaks for visual review; reject a discontinuous branch
  // beyond the measured rapid fold rather than expecting the discarded slow clock.
  assert.ok(audit.maximumLocalStep.degrees < 12 && audit.maximumWorldStep.degrees < 13, 'No branch pop at 120 Hz');
  for (const phase of audit.supportPhases) {
    assert.ok(phase.minimumFootY >= 0 && phase.maximumFootMinimumY < .005);
    assert.ok(phase.maximumMaterialPointDrift < contract.height * .01);
  }
  for (const boundary of audit.velocityContinuity) assert.ok(Math.abs(boundary.incoming - boundary.outgoing) < .05);
  for (const track of json.tracks) assert.ok(track.name.endsWith('.quaternion') || track.name === 'DoreumiRig.position', 'No limb translation or scale tracks');
  const root = json.tracks.find(track => track.name === 'DoreumiRig.position');
  assert.ok(root.values.every((value, index) => index % 3 === 1 || value === 0));
  assert.equal(evidence.airborneFall.sourceRootIsBallistic, false); assert.equal(evidence.airborneFall.authoredRoot, true);
  assert.equal(evidence.airborneFall.palmContactClaimed, false); assert.equal(evidence.airborneFall.sourceCoreDuration, 4.5);
  assert.equal(evidence.sourceTimeScale, 5); assert.equal(evidence.playbackSourceDuration, .9);
  assert.equal(evidence.airborneFall.cameraPolicy, 'fixed-ground'); assert.equal(evidence.framing.tracking, undefined);
  assert.ok(Math.abs(evidence.entryDuration + evidence.playbackSourceDuration + evidence.exitDuration - json.duration) < 1e-6);
  assert.ok(validMotionFrame(evidence.framing, json.duration));
  const { samples, ...summary } = audit; context.diagnostic(JSON.stringify(summary));
});

test('actual runtime accepts the candidate and keeps flight and interrupted recovery in frame', async context => {
  const { clip, evidence, library } = await prepared, asset = await loadDoreumiAsset(master);
  const motion = new DoreumiMotion(asset.scene, asset.clips), graph = targetGraph(contract);
  motion.registerClip(clip);
  const frameFor = name => name === clip.name ? evidence.framing : undefined;
  let frames = 0, worstOverflow = 0, maximumExitScaleStep = 0;
  const check = camera => {
    for (const node of graph.ordered) {
      const bone = asset.scene.getObjectByName(node.name);
      node.position.copy(bone.position); node.quaternion.copy(bone.quaternion); node.scale.copy(bone.scale); updateNode(node);
    }
    const bounds = library.support.measure(graph, true);
    const overflow = Math.max(0, bounds.maxY - camera.centerY - camera.halfHeight, camera.centerY - camera.halfHeight - bounds.minY, bounds.radius - camera.halfHeight);
    frames++; worstOverflow = Math.max(worstOverflow, overflow); assert.ok(overflow < .001);
  };
  try {
    for (let index = 0; index <= Math.ceil(clip.duration * 120); index++) {
      motion.seek(clip.name, Math.min(clip.duration, index / 120));
      check(blendMotionFrames(motion.inspect().framingSamples, frameFor, 1));
    }
    for (const next of ['Think', 'Dragged', 'Idle']) for (const delta of [1 / 120, .05, .1736, .25]) {
      motion.seek(clip.name, evidence.airborneFall.apexTime);
      let camera = blendMotionFrames(motion.inspect().framingSamples, frameFor, 1);
      motion.setAction(next); check(camera);
      for (let index = 0; index < Math.ceil(1 / delta); index++) {
        motion.update(delta); camera = advanceMotionCamera(camera, blendMotionFrames(motion.inspect().framingSamples, frameFor, 1), delta); check(camera);
      }
    }
    for (const delta of [1 / 60, .05, .1736, .25]) for (const rate of [1, .25]) {
      motion.seek(clip.name, clip.duration - .2);
      let camera = blendMotionFrames(motion.inspect().framingSamples, frameFor, 1);
      for (let index = 0; index < Math.ceil(3 / delta); index++) {
        motion.update(delta * rate);
        const next = advanceMotionCamera(camera, blendMotionFrames(motion.inspect().framingSamples, frameFor, 1), delta);
        const scaleStep = camera.halfHeight / next.halfHeight - 1;
        maximumExitScaleStep = Math.max(maximumExitScaleStep, scaleStep);
        assert.ok(scaleStep <= Math.expm1(.6 * Math.min(delta, 1 / 30)) + 1e-10);
        camera = next; check(camera);
      }
      assert.equal(motion.inspect().action, 'Idle');
    }
  } finally { motion.dispose(); }
  context.diagnostic(JSON.stringify({ frames, worstOverflow, maximumExitScaleStep }));
});
