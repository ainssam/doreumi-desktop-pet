import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { parseDoreumiEnvironment } from '../src/lib/doreumi/motion-environment-contract.ts';
import { createDoreumiEnvironmentProp } from '../src/lib/doreumi/motion-environment-props.ts';
import { createDoreumiContextProps } from '../src/lib/doreumi/motion-context-props.ts';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';

const measured = {
  version: 1, kind: 'low-ledge',
  geometry: { width: 2.25, frontZ: .68, depth: .22, wallTop: .75, top: .8, railZ: .545, railRadius: .024,
    rails: [[-.98, -.24], [.42, .98]], footstepTop: .154, footstepFrontZ: .3, footstepBackZ: .75 },
  targetHandVertices: { L: 78037, R: 850 }, targetFootVertices: { L: 65106, R: 13384 },
};

test('environment metadata requires the explicit adapted action and finite bounded geometry', () => {
  for (const id of [439, 440, 619, 620]) assert.ok(parseDoreumiEnvironment(measured, id));
  assert.equal(parseDoreumiEnvironment(measured, 438), null);
  assert.equal(parseDoreumiEnvironment(undefined, 619), null);
  assert.equal(parseDoreumiEnvironment({ ...measured, geometry: { ...measured.geometry, width: Infinity } }, 619), null);
  assert.equal(parseDoreumiEnvironment({ ...measured, geometry: { ...measured.geometry, rails: [[-.98, .4], [.2, .98]] } }, 619), null);
  assert.equal(parseDoreumiEnvironment({ ...measured, targetHandVertices: { L: 78799, R: 850 } }, 619), null);
  const parsed = parseDoreumiEnvironment(measured, 619);
  parsed.geometry.rails[0][0] = -.5;
  assert.equal(measured.geometry.rails[0][0], -.98, 'validated metadata must not alias mutable source objects');
});

test('the wall remains rigid on the stage while support points move and release', () => {
  const prop = createDoreumiEnvironmentProp(parseDoreumiEnvironment(measured, 619));
  const floor = 1.2;
  const hands = { L: new THREE.Vector3(.55, floor + .804, .545), R: new THREE.Vector3(-.55, floor + .804, .545) };
  const feet = { L: new THREE.Vector3(.24, floor + .158, .345), R: new THREE.Vector3(-.24, floor + .158, .345) };
  const state = prop.update({ floor, opacity: 1, hands, feet });
  const before = new THREE.Box3().setFromObject(prop.root);
  for (const contact of state.contacts) assert.ok(Math.abs(contact.distance - .004) < 1e-12);
  prop.update({ floor, opacity: .5, hands: { L: hands.L.clone().add(new THREE.Vector3(.2, .3, -.3)), R: hands.R }, feet });
  const after = new THREE.Box3().setFromObject(prop.root);
  assert.ok(before.min.equals(after.min) && before.max.equals(after.max), 'support does not follow a reaching hand');
  assert.deepEqual(prop.root.scale.toArray(), [1, 1, 1]);
  assert.ok(Math.abs(before.min.y - floor) < 1e-6);
  prop.update({ floor, opacity: 0, hands, feet });
  assert.equal(prop.root.visible, false);
  prop.dispose();
  assert.equal(prop.root.parent, null);
});

test('environment material probes resolve the master mesh after the actual Idle controller initializes', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const holder = new THREE.Group(); holder.add(asset.scene);
  const motion = new DoreumiMotion(asset.scene, asset.clips);
  const props = createDoreumiContextProps({ model: asset.scene, parent: holder });
  props.setMotion({ sourceActionId: 619, props: ['climbing-surface'], environmentSupport: measured });
  holder.position.y = -.0023397356271734893;
  holder.rotation.y = Math.PI / 4;
  holder.updateMatrixWorld(true);
  props.update({ time: 1, duration: 7.4 });
  const state = props.inspect();
  assert.equal(state.supported, true);
  assert.equal(state.visible, true, 'an empty nearest-socket grip list must not hide the measured environment');
  assert.ok(state.bounds && state.finite);
  assert.equal(state.contacts.length, 4);
  const mesh = asset.scene.getObjectByName('Doreumi');
  for (const contact of state.contacts) {
    const side = contact.target.includes('L-') ? 'L' : 'R';
    const vertices = contact.target.startsWith('palm') ? measured.targetHandVertices : measured.targetFootVertices;
    const actual = mesh.getVertexPosition(vertices[side], new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert.ok(actual.distanceTo(new THREE.Vector3(...contact.targetPoint)) < 1e-10);
  }
  props.dispose(); motion.dispose();
});
