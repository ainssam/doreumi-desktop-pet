import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnimationClip, Vector3 } from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { solveHand } from '../scripts/doreumi/meshy-adaptation.mjs';
import { adaptPropContact, propGripSkin, PROP_GRIP_SKIN } from '../scripts/doreumi/meshy-prop-contact.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [contract, manifest] = await Promise.all([json('public/doreumi/rig-contract.json'), json('public/doreumi/motions/meshy-source-manifest.json')]);
const ids = [327, 598, 551, 611], up = new Vector3(0, 1, 0);
const skinPoint = (mesh, index) => mesh.localToWorld(mesh.getVertexPosition(index, new Vector3()));
function syncSkin(asset, target) {
  for (const node of target.ordered) {
    const bone = asset.scene.getObjectByName(node.name);
    if (bone) { bone.position.copy(node.position); bone.quaternion.copy(node.quaternion); bone.scale.copy(node.scale); }
  }
  asset.scene.updateMatrixWorld(true); asset.skinned[0].object.skeleton.update();
}

test('prop anchors are the measured fixed skin points, including their elbow weights', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), target = targetGraph(contract); syncSkin(asset, target);
  for (const side of ['L', 'R']) assert.ok(propGripSkin(target, side).distanceTo(skinPoint(asset.skinned[0].object, PROP_GRIP_SKIN[side].vertex)) < 1e-6);
});

test('actual carry and swing poses keep compact skin grips and source foot rotation without changing limb lengths', async context => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), mesh = asset.skinned[0].object;
  const position = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const bodyProbes = [], seen = new Set();
  for (let index = 0; index < position.count; index++) {
    let weight = 0;
    for (let component = 0; component < 4; component++) if (['body', 'torso', 'head'].includes(mesh.skeleton.bones[indices.getComponent(index, component)]?.name)) weight += weights.getComponent(index, component);
    if (weight <= .55) continue;
    const key = [position.getX(index), position.getY(index), position.getZ(index)].map(value => Math.round(value / .07)).join(',');
    if (!seen.has(key)) { seen.add(key); bodyProbes.push(index); }
  }
  for (const id of ids) {
    const item = manifest.motions.find(item => item.actionId === id), evidence = item.retargetEvidence;
    const clip = AnimationClip.parse(await json(`public${item.url}`)), target = targetGraph(contract);
    const samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
    let maximumContactError = 0, maximumReachClamp = 0, maximumUpperTilt = 0, maximumFootRotationError = 0, maximumRearGap = 0, maximumWristAngle = 0, maximumElbowAngle = 0, maximumShoulderAngle = 0;
    for (let frame = 0; frame <= 30; frame++) {
      const sourceTime = evidence.sourceDuration * frame / 30;
      for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + sourceTime));
      target.ordered.forEach(updateNode);
      const feet = ['L', 'R'].map(side => target.byName.get(`foot${side}`).worldQuaternion.clone());
      const before = target.ordered.map(node => ({ name: node.name, position: node.position.toArray(), scale: node.scale.toArray() }));
      const result = adaptPropContact(target, item, sourceTime, evidence.sourceDuration, () => target.ordered.forEach(updateNode), solveHand);
      for (const value of before) {
        assert.deepEqual(target.byName.get(value.name).position.toArray(), value.position);
        assert.deepEqual(target.byName.get(value.name).scale.toArray(), value.scale);
      }
      syncSkin(asset, target); maximumReachClamp = Math.max(maximumReachClamp, result.maxReachClamp);
      for (const [index, side] of ['L', 'R'].entries()) {
        const actual = skinPoint(mesh, PROP_GRIP_SKIN[side].vertex), goal = new Vector3(...result.goals[side]);
        maximumContactError = Math.max(maximumContactError, actual.distanceTo(goal));
        maximumFootRotationError = Math.max(maximumFootRotationError, feet[index].angleTo(target.byName.get(`foot${side}`).worldQuaternion));
        for (const name of ['wrist', 'elbow', 'shoulder']) {
          const bone = target.byName.get(`${name}${side}`), angle = bone.quaternion.angleTo(bone.restLocalQuaternion) * 180 / Math.PI;
          if (name === 'wrist') maximumWristAngle = Math.max(maximumWristAngle, angle);
          else if (name === 'elbow') maximumElbowAngle = Math.max(maximumElbowAngle, angle);
          else maximumShoulderAngle = Math.max(maximumShoulderAngle, angle);
        }
      }
      for (const name of ['body', 'torso', 'head']) maximumUpperTilt = Math.max(maximumUpperTilt, up.angleTo(up.clone().applyQuaternion(target.byName.get(name).worldQuaternion)) * 180 / Math.PI);
      const left = new Vector3(...result.goals.L), right = new Vector3(...result.goals.R), isBell = id === 327 || id === 598;
      assert.ok(Math.abs(left.distanceTo(right) - (isBell ? .75 : 1.04)) < 1e-6);
      const center = left.add(right).multiplyScalar(.5), heading = new Vector3(0, 0, 1).applyQuaternion(target.byName.get('body').worldQuaternion).setY(0).normalize();
      const propY = center.y - (isBell ? .23 : .16), halfHeight = isBell ? .18 : .17;
      let extent = target.byName.get('body').worldPosition.dot(heading);
      for (const vertex of bodyProbes) {
        const point = skinPoint(mesh, vertex);
        if (point.y >= propY - halfHeight - .09 && point.y <= propY + halfHeight + .09) extent = Math.max(extent, point.dot(heading));
      }
      maximumRearGap = Math.max(maximumRearGap, extent + .08 + .025 - center.dot(heading));
    }
    context.diagnostic(JSON.stringify({ id, maximumContactError, maximumReachClamp, maximumUpperTilt, maximumFootRotationError, maximumRearGap, maximumWristAngle, maximumElbowAngle, maximumShoulderAngle }));
    assert.ok(maximumContactError < .005, `skin grip error for ${id}`);
    assert.ok(maximumReachClamp < .002, `unreachable grip for ${id}`);
    assert.ok(maximumUpperTilt <= 25.00001, `body/head still leans too far for ${id}`);
    assert.ok(maximumFootRotationError < 1e-6, `source foot rotation changed for ${id}`);
    assert.ok(maximumRearGap < .35, `prop still needs a long rear grip for ${id}`);
    assert.ok(maximumWristAngle <= 105, `wrist counter-twist for ${id}`);
    assert.ok(maximumElbowAngle <= 165, `elbow rotation exceeded the master range for ${id}`);
    assert.ok(maximumShoulderAngle <= 105, `collar rotation exceeded the master range for ${id}`);
  }
});

test('prop contact adaptation leaves unrelated source IDs unchanged', () => {
  const target = targetGraph(contract), before = target.ordered.map(node => node.quaternion.toArray());
  assert.deepEqual(adaptPropContact(target, { actionId: 328 }, 1, 5, () => assert.fail('unrelated pose changed'), solveHand), { active: false, maxReachClamp: 0 });
  assert.deepEqual(target.ordered.map(node => node.quaternion.toArray()), before);
});

test('final shipping clips retain compact skin grips after key reduction without reapplying the adapter', async context => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), mesh = asset.skinned[0].object;
  for (const id of ids) {
    const item = manifest.motions.find(item => item.actionId === id), evidence = item.retargetEvidence, isBell = id === 327 || id === 598;
    assert.equal(evidence.semantics.contactAdaptation, isBell ? 'short-arm-two-hand-kettlebell-skin-contact' : 'short-arm-tray-skin-contact');
    const clip = AnimationClip.parse(await json(`public${item.url}`)), target = targetGraph(contract);
    const samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
    let maximumSkinGoalError = 0, maximumSpanError = 0, maximumUpperTilt = 0, maximumWristAngle = 0;
    for (let frame = 0; frame <= 120; frame++) {
      for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + evidence.sourceDuration * frame / 120));
      target.ordered.forEach(updateNode); syncSkin(asset, target);
      const body = target.byName.get('body'), heading = new Vector3(0, 0, 1).applyQuaternion(body.worldQuaternion).setY(0).normalize(), right = up.clone().cross(heading);
      const hands = Object.fromEntries(['L', 'R'].map(side => [side, skinPoint(mesh, PROP_GRIP_SKIN[side].vertex)]));
      const center = hands.L.clone().add(hands.R).multiplyScalar(.5).sub(body.worldPosition);
      const height = isBell ? Math.max(.2, Math.min(.52, center.y)) : .36;
      const forward = isBell ? .43 + (height - .2) * .1 / .32 : .4;
      for (const side of ['L', 'R']) {
        const goal = body.worldPosition.clone().addScaledVector(right, (side === 'L' ? 1 : -1) * (isBell ? .375 : .52)).addScaledVector(up, height).addScaledVector(heading, forward);
        maximumSkinGoalError = Math.max(maximumSkinGoalError, hands[side].distanceTo(goal));
        const wrist = target.byName.get(`wrist${side}`);
        maximumWristAngle = Math.max(maximumWristAngle, wrist.quaternion.angleTo(wrist.restLocalQuaternion));
      }
      maximumSpanError = Math.max(maximumSpanError, Math.abs(hands.L.distanceTo(hands.R) - (isBell ? .75 : 1.04)));
      for (const name of ['body', 'torso', 'head']) maximumUpperTilt = Math.max(maximumUpperTilt, up.angleTo(up.clone().applyQuaternion(target.byName.get(name).worldQuaternion)) * 180 / Math.PI);
    }
    context.diagnostic(JSON.stringify({ id, shippingSamples: 121, maximumSkinGoalError, maximumSpanError, maximumUpperTilt, maximumWristAngle }));
    assert.ok(maximumSkinGoalError < .005, `final skin grip left its compact target for ${id}`);
    assert.ok(maximumSpanError < .005, `final grip width changed for ${id}`);
    // Quaternion interpolation can overshoot the baked 25-degree tilt by less
    // than a quarter degree; this still leaves the prop clear of the face.
    assert.ok(maximumUpperTilt < (isBell ? 25.25 : 15.25), `final upper-body tilt for ${id}`);
    assert.ok(maximumWristAngle < 1e-6, `final clip twists a neutral wrist for ${id}`);
  }
});
