import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnimationClip, Vector3 } from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { solveHand } from '../scripts/doreumi/meshy-adaptation.mjs';
import { adaptHeart, heartCheek, heartWeight, HEART_CONTACTS } from '../scripts/doreumi/meshy-heart.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const contract = await json('public/doreumi/rig-contract.json');
const manifest = await json('public/doreumi/motions/meshy-source-manifest.json');
const item = manifest.motions.find(item => item.actionId === 27), evidence = item.retargetEvidence;
const clip = AnimationClip.parse(await json('public/doreumi/motions/meshy-27.json'));

function skinPoint(mesh, vertex) { return mesh.localToWorld(mesh.getVertexPosition(vertex, new Vector3())); }
function syncSkin(asset, target) {
  for (const pose of target.ordered) {
    const bone = asset.scene.getObjectByName(pose.name);
    if (bone) { bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale); }
  }
  asset.scene.updateMatrixWorld(true); asset.skinned[0].object.skeleton.update();
}

test('cheek-heart anchors are measured skin vertices on the unchanged master', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), mesh = asset.skinned[0].object, target = targetGraph(contract);
  syncSkin(asset, target);
  for (const side of ['L', 'R']) {
    const contact = HEART_CONTACTS[side], wrist = target.byName.get(`wrist${side}`);
    const hand = new Vector3(...contact.handLocal).applyQuaternion(wrist.worldQuaternion).add(wrist.worldPosition);
    assert.ok(hand.distanceTo(skinPoint(mesh, contact.handVertex)) < 1e-6);
    assert.ok(heartCheek(target, side).point.distanceTo(skinPoint(mesh, contact.cheekVertex)) < 1e-6);
  }
});

test('heart adaptation keeps real skin near both cheeks without stretching any measured bone', async context => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), mesh = asset.skinned[0].object, target = targetGraph(contract);
  const samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const hands = Object.fromEntries(['L', 'R'].map(side => {
    const joint = mesh.skeleton.bones.findIndex(bone => bone.name === `wrist${side}`), vertices = [];
    for (let vertex = 0; vertex < indices.count; vertex++) {
      let total = 0;
      for (let index = 0; index < 4; index++) if (indices.getComponent(vertex, index) === joint) total += weights.getComponent(vertex, index);
      if (total > .6) vertices.push(vertex);
    }
    return [side, vertices];
  }));
  let maximumGap = 0, maximumReachClamp = 0, minimumTangentClearance = Infinity, maximumWristAngle = 0, samples = 0;
  for (let index = 0; index <= 36; index++) {
    const sourceTime = evidence.sourceDuration * index / 36;
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + sourceTime));
    target.ordered.forEach(updateNode);
    const before = target.ordered.map(node => ({ name: node.name, position: node.position.toArray(), scale: node.scale.toArray() }));
    const result = adaptHeart(target, item, sourceTime, evidence.sourceDuration, () => target.ordered.forEach(updateNode), solveHand);
    for (const rest of before) {
      assert.deepEqual(target.byName.get(rest.name).position.toArray(), rest.position, rest.name);
      assert.deepEqual(target.byName.get(rest.name).scale.toArray(), rest.scale, rest.name);
    }
    if (heartWeight(sourceTime, evidence.sourceDuration) < .999) continue;
    syncSkin(asset, target); maximumReachClamp = Math.max(maximumReachClamp, result.maxReachClamp);
    for (const side of ['L', 'R']) {
      const contact = HEART_CONTACTS[side], cheek = skinPoint(mesh, contact.cheekVertex), hand = skinPoint(mesh, contact.handVertex);
      const normal = heartCheek(target, side).normal;
      maximumGap = Math.max(maximumGap, cheek.distanceTo(hand));
      for (const vertex of hands[side]) minimumTangentClearance = Math.min(minimumTangentClearance, skinPoint(mesh, vertex).sub(cheek).dot(normal));
      const wrist = target.byName.get(`wrist${side}`);
      maximumWristAngle = Math.max(maximumWristAngle, wrist.quaternion.angleTo(wrist.restLocalQuaternion) * 180 / Math.PI);
      samples++;
    }
  }
  context.diagnostic(JSON.stringify({ samples, maximumGap, maximumReachClamp, minimumTangentClearance, maximumWristAngle }));
  assert.ok(samples >= 30);
  assert.ok(maximumReachClamp < 1e-6, 'both cheeks must be reachable with original bone lengths');
  assert.ok(maximumGap < .0214, 'skin contact must remain within 1% of body height');
  assert.ok(minimumTangentClearance >= -.002, 'mitten skin must not cross the cheek tangent plane');
  assert.ok(maximumWristAngle <= 105, 'mitten orientation must stay within the master wrist range');
});

test('the shipped heart clip itself reaches both skin contacts without applying the helper again', async context => {
  assert.equal(evidence.semantics.contactAdaptation, 'bilateral-cheek-heart-skin-contact');
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), mesh = asset.skinned[0].object, target = targetGraph(contract);
  const samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  let maximumGap = 0, minimumGap = Infinity, samples = 0;
  for (let index = 0; index <= 90; index++) {
    const sourceTime = evidence.sourceDuration * index / 90;
    if (heartWeight(sourceTime, evidence.sourceDuration) < .999) continue;
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + sourceTime));
    target.ordered.forEach(updateNode); syncSkin(asset, target);
    for (const contact of Object.values(HEART_CONTACTS)) {
      const gap = skinPoint(mesh, contact.cheekVertex).distanceTo(skinPoint(mesh, contact.handVertex));
      maximumGap = Math.max(maximumGap, gap); minimumGap = Math.min(minimumGap, gap); samples++;
    }
  }
  assert.ok(samples > 80); assert.ok(maximumGap < .0214); assert.ok(minimumGap > .008);
  context.diagnostic(JSON.stringify({ shippingClipContactSamples: samples, maximumGap, minimumGap }));
});

test('heart adaptation is scoped and its source entry/exit return to zero weight', () => {
  const target = targetGraph(contract), before = target.ordered.map(node => node.quaternion.toArray());
  assert.deepEqual(adaptHeart(target, { actionId: 28, sourceName: 'Big_Wave_Hello' }, 2, 6, () => assert.fail('unrelated motion was touched'), solveHand), { active: false, maxReachClamp: 0 });
  assert.deepEqual(target.ordered.map(node => node.quaternion.toArray()), before);
  assert.equal(heartWeight(0, 6), 0); assert.equal(heartWeight(6, 6), 0); assert.equal(heartWeight(3, 6), 1);
  assert.equal(heartWeight(1, 0), 0); assert.equal(heartWeight(NaN, 6), 0);
});

test('heart approach and release keep one wrist branch throughout the source interval', context => {
  const target = targetGraph(contract), samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const arms = target.ordered.filter(node => /^(shoulder|arm|elbow|wrist)/.test(node.name));
  let previous, maximumStep = 0, maximumWristAngle = 0;
  for (let frame = 0; frame <= evidence.sourceDuration * 60; frame++) {
    const sourceTime = frame / 60;
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + sourceTime));
    target.ordered.forEach(updateNode);
    adaptHeart(target, item, sourceTime, evidence.sourceDuration, () => target.ordered.forEach(updateNode), solveHand);
    for (const [index, node] of arms.entries()) {
      if (previous) maximumStep = Math.max(maximumStep, node.quaternion.angleTo(previous[index]) * 180 / Math.PI);
      if (node.name.startsWith('wrist')) maximumWristAngle = Math.max(maximumWristAngle, node.quaternion.angleTo(node.restLocalQuaternion) * 180 / Math.PI);
    }
    previous = arms.map(node => node.quaternion.clone());
  }
  assert.ok(maximumStep < 3, `heart wrist release changed IK branch: ${maximumStep}`);
  assert.ok(maximumWristAngle < 105, `heart wrist compensates for a twisted forearm: ${maximumWristAngle}`);
  context.diagnostic(JSON.stringify({ fps: 60, maximumStep, maximumWristAngle }));
});
