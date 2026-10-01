import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { AnimationClip, AnimationMixer, LoopOnce, Quaternion, Vector3 } from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { HEART_CONTACTS } from '../scripts/doreumi/meshy-heart.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('the shipping scratch reaches real cheek skin smoothly without changing the master limb lengths', async context => {
  const file = 'public/doreumi/motions/meshy-36.json', master = 'public/doreumi/doreumi-master.glb';
  const item = read('public/doreumi/motions/meshy-source-manifest.json').motions.find(item => item.actionId === 36);
  const contract = read('public/doreumi/rig-contract.json'), clip = AnimationClip.parse(read(file));
  const asset = await loadDoreumiAsset(master), mesh = asset.skinned[0].object;
  const mixer = new AnimationMixer(asset.scene), action = mixer.clipAction(clip).play();
  action.setLoop(LoopOnce, 0); action.clampWhenFinished = true;
  const contact = HEART_CONTACTS.R, handVertices = [];
  const wristIndex = mesh.skeleton.bones.findIndex(bone => bone.name === 'wristR');
  for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
    let weight = 0;
    for (let component = 0; component < 4; component++) if (mesh.geometry.attributes.skinIndex.getComponent(vertex, component) === wristIndex) weight += mesh.geometry.attributes.skinWeight.getComponent(vertex, component);
    if (weight > .6) handVertices.push(vertex);
  }
  const names = ['shoulderR', 'armR', 'elbowR', 'wristR'], previous = new Map(), jointAngles = {};
  let maximumGap = 0, minimumGap = Infinity, minimumTangentClearance = Infinity, maximumLocalStep = 0, maximumWorldStep = 0, samples = 0;
  const skin = vertex => mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(mesh.matrixWorld);
  for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++) {
    const time = Math.min(clip.duration, frame / 60), sourceTime = time - item.retargetEvidence.entryDuration;
    mixer.setTime(time); asset.scene.updateMatrixWorld(true); mesh.skeleton.update();
    for (const rest of contract.bones) {
      const bone = asset.scene.getObjectByName(rest.name);
      if (rest.name !== 'DoreumiRig') assert.ok(bone.position.distanceTo(new Vector3(...rest.restLocalPosition)) < 1e-7, rest.name);
      assert.ok(bone.scale.distanceTo(new Vector3(...rest.restLocalScale)) < 1e-7, rest.name);
    }
    for (const name of names) {
      const bone = asset.scene.getObjectByName(name), world = bone.getWorldQuaternion(new Quaternion()), before = previous.get(name);
      jointAngles[name] = Math.max(jointAngles[name] ?? 0, bone.quaternion.angleTo(new Quaternion()) * 180 / Math.PI);
      if (before) {
        maximumLocalStep = Math.max(maximumLocalStep, bone.quaternion.angleTo(before.local) * 180 / Math.PI);
        maximumWorldStep = Math.max(maximumWorldStep, world.angleTo(before.world) * 180 / Math.PI);
      }
      previous.set(name, { local: bone.quaternion.clone(), world });
    }
    // These are the two visible rubbing holds in the original source. Do not
    // reapply the adaptation helper to the shipping clip during this check.
    if (!((sourceTime >= 1.3 && sourceTime <= 4.9) || (sourceTime >= 7.8 && sourceTime <= 9.1))) continue;
    const cheek = skin(contact.cheekVertex), hand = skin(contact.handVertex), normal = new Vector3();
    for (const influence of contact.cheek) normal.addScaledVector(new Vector3(...contact.normal).applyQuaternion(asset.scene.getObjectByName(influence.bone).getWorldQuaternion(new Quaternion())), influence.weight);
    normal.normalize();
    const gap = cheek.distanceTo(hand); maximumGap = Math.max(maximumGap, gap); minimumGap = Math.min(minimumGap, gap);
    for (const vertex of handVertices) minimumTangentClearance = Math.min(minimumTangentClearance, skin(vertex).sub(cheek).dot(normal));
    samples++;
  }
  const report = { actionId: 36, clipSha256: sha(file), masterSha256: sha(master), fps: 60,
    basis: 'Shipping clip decoded directly; measured cheek/hand skin vertices and signed clearance of every wrist-weighted vertex from the cheek tangent plane. No adaptation helper reapplied.',
    samples, handVertexCount: handVertices.length, maximumGap, minimumGap, minimumTangentClearance, maximumLocalStep, maximumWorldStep, jointAngles };
  fs.mkdirSync('.artifacts/doreumi-contact-audit', { recursive: true });
  fs.writeFileSync('.artifacts/doreumi-contact-audit/scratch-36.json', JSON.stringify(report, null, 2) + '\n');
  context.diagnostic(JSON.stringify(report));
  assert.ok(samples >= 280);
  assert.ok(maximumGap < .0214, 'the hand must reach the cheek within 1% of the unchanged body height');
  assert.ok(minimumGap > .008);
  assert.ok(minimumTangentClearance >= -.002, 'the mitten must remain outside the cheek tangent plane');
  assert.ok(jointAngles.wristR < 105);
  assert.ok(maximumLocalStep < 3.5, 'the scratch entry/release must not change elbow or wrist quaternion branch');
  assert.ok(maximumWorldStep < 6, 'the composed hand movement must remain continuous at 60 Hz');
});
