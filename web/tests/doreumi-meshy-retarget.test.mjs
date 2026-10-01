import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, AnimationMixer, Euler, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { decimateTrack, localFromWorld, resolveVirtualRootBound, restDeltaQuaternion, sampleChannel, serializeClip } from '../scripts/doreumi/meshy-retarget.mjs';
import { motionSemantics } from '../scripts/doreumi/meshy-adaptation.mjs';
import { solveHand } from '../scripts/doreumi/meshy-adaptation.mjs';
import { createSourceSupport } from '../scripts/doreumi/meshy-master-support.mjs';
import { Document } from '@gltf-transform/core';
import { compactTravel, integrateStance } from '../scripts/doreumi/meshy-travel.mjs';

const nearQuaternion = (actual, expected, tolerance = 1e-6) => assert.ok(actual.angleTo(expected) < tolerance);

test('offline virtual travel has an explicit finite bound without changing the default', () => {
  assert.equal(resolveVirtualRootBound(), 2);
  for (const value of [1, 2, 3, 11, 12]) assert.equal(resolveVirtualRootBound(value), value);
  for (const value of [0, -1, 12.000001, 13, Infinity, NaN, '12', null]) assert.throws(() => resolveVirtualRootBound(value), /virtualRootBound/);
});

test('rest-space conversion preserves a different target bind and maps the same world-space action', () => {
  const sourceRest = new Quaternion().setFromEuler(new Euler(.3, -.5, .9));
  const targetRest = new Quaternion().setFromEuler(new Euler(-.2, .6, -.4));
  nearQuaternion(restDeltaQuaternion(sourceRest, sourceRest, targetRest), targetRest);
  const gesture = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .65);
  const sourcePose = gesture.clone().multiply(sourceRest);
  nearQuaternion(restDeltaQuaternion(sourcePose, sourceRest, targetRest), gesture.clone().multiply(targetRest));
  const parentWorld = new Quaternion().setFromEuler(new Euler(.7, .1, -.2));
  const desired = gesture.clone().multiply(targetRest);
  nearQuaternion(parentWorld.clone().multiply(localFromWorld(desired, parentWorld)), desired);
});

test('quaternion sampling uses the shortest rotation and handles constant channels', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .8);
  const channel = { times: [0, 1], values: [...q.toArray(), ...q.toArray().map(v => -v)], size: 4, path: 'rotation', interpolation: 'LINEAR', cursor: 0 };
  nearQuaternion(new Quaternion().fromArray(sampleChannel(channel, .5)), q);
  assert.deepEqual(sampleChannel({ times: [0], values: [1, 2, 3], size: 3, path: 'translation', interpolation: 'LINEAR', cursor: 0 }, 4), [1, 2, 3]);
});

test('cubic sampling uses glTF in/value/out tangent order and normalizes rotations', () => {
  const values = [0, 0, 2, 2, 2, 0];
  const channel = { times: [0, 1], values, size: 1, path: 'translation', interpolation: 'CUBICSPLINE', cursor: 0 };
  assert.deepEqual(sampleChannel(channel, .5), [1]);
  assert.deepEqual(sampleChannel(channel, 0), [0]);
  assert.deepEqual(sampleChannel(channel, 1), [2]);
});

test('key reduction preserves a brief gesture peak inside the error budget', () => {
  const times = [0, .25, .5, .75, 1];
  const values = [0, .1, .7, .1, 0].flatMap(angle => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle).toArray());
  const reduced = decimateTrack(times, values, 4, .004, true);
  assert.ok(reduced.times.includes(.5));
  const linear = decimateTrack(times, times.flatMap(value => [0, value, 0]), 3, .0008);
  assert.deepEqual(linear.times, [0, 1]);
  assert.deepEqual(linear.values, [0, 0, 0, 0, 1, 0]);
});

test('parsed imports retain distinct reproducible UUIDs and separate mixer actions', () => {
  const root = new Group(); root.name = 'body';
  const make = (name, angle) => new AnimationClip(name, 1, [new QuaternionKeyframeTrack('body.quaternion', [0, 1],
    [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray()])]);
  const one = serializeClip(make('meshy:0', .2)), two = serializeClip(make('meshy:22', .7));
  assert.deepEqual(serializeClip(make('meshy:0', .2)), one);
  assert.notEqual(one.uuid, two.uuid);
  const mixer = new AnimationMixer(root);
  const a = mixer.clipAction(AnimationClip.parse(one)), b = mixer.clipAction(AnimationClip.parse(two));
  assert.notEqual(a, b);
  a.play(); mixer.update(.5); assert.ok(root.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .1)) < .0001);
  mixer.stopAllAction(); b.reset().play(); mixer.update(.5);
  assert.ok(root.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .35)) < .0001);
});

test('in-place walking still carries host travel intent and required props', () => {
  const result = motionSemantics({ sourceName: 'Carry_Water_Bucket_Walk_inplace', sourceCategory: 'WalkAndRun', sourceSubCategory: 'Walking' }, [[0, 1, 0], [0, 1, 0]], 2, .37);
  assert.equal(result.kind, 'locomotion'); assert.equal(result.inPlaceSource, true);
  assert.ok(result.suggestedStageSpeed > 0); assert.deepEqual(result.targetRootDisplacementXZ, [0, 0]);
  assert.deepEqual(result.requiresProps, ['bucket']);
  for (const name of ['Indoor_Play', 'Indoor_Swing', 'Boxing_Warmup', 'Lie_Down_Hands_Spread']) {
    assert.deepEqual(motionSemantics({ sourceName: name, sourceCategory: 'DailyActions', sourceSubCategory: 'Acting' }, [[0, 0, 0]], 1, .37).requiresProps, []);
  }
});

test('hand IK reaches a nearby goal without changing either short limb length', () => {
  const nodes = [['torso', null, [0, 0, 0]], ['armL', 'torso', [0, 0, 0]], ['elbowL', 'armL', [.2, 0, 0]], ['wristL', 'elbowL', [.15, 0, 0]]];
  const byName = new Map(nodes.map(([name, , position]) => [name, { name, position: new Vector3(...position), quaternion: new Quaternion(), worldPosition: new Vector3(), worldQuaternion: new Quaternion() }]));
  for (const [name, parent] of nodes) byName.get(name).parent = byName.get(parent);
  const update = () => { for (const [name] of nodes) { const n = byName.get(name); n.worldPosition.copy(n.position); n.worldQuaternion.copy(n.quaternion); if (n.parent) { n.worldPosition.applyQuaternion(n.parent.worldQuaternion).add(n.parent.worldPosition); n.worldQuaternion.premultiply(n.parent.worldQuaternion); } } };
  update(); const goal = new Vector3(.15, .2, .12);
  solveHand({ byName }, 'L', goal, 1, update);
  assert.ok(byName.get('wristL').worldPosition.distanceTo(goal) < 1e-6);
  assert.equal(byName.get('elbowL').position.length(), .2); assert.equal(byName.get('wristL').position.length(), .15);
  solveHand({ byName }, 'L', new Vector3(4, 0, 0), 1, update);
  assert.ok(byName.get('wristL').worldPosition.length() <= .35);
});

test('affine skin support retains full bounds after removing interior vertices', () => {
  const doc = new Document(), buffer = doc.createBuffer(), bone = doc.createNode('bone'), meshNode = doc.createNode('mesh');
  const points = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z]))).concat([[0, 0, 0], [.2, 0, 0], [0, .3, 0], [0, 0, .4]]);
  const attr = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', attr('VEC3', new Float32Array(points.flat())))
    .setAttribute('JOINTS_0', attr('VEC4', new Uint16Array(points.length * 4)))
    .setAttribute('WEIGHTS_0', attr('VEC4', new Float32Array(points.flatMap(() => [1, 0, 0, 0]))));
  const skin = doc.createSkin().addJoint(bone).setInverseBindMatrices(attr('MAT4', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])));
  meshNode.setMesh(doc.createMesh().addPrimitive(primitive)).setSkin(skin);
  const rotation = new Quaternion().setFromEuler(new Euler(.4, -.3, .2)), translation = new Vector3(1, 2, 3);
  const pose = { worldPosition: translation, worldQuaternion: rotation, worldScale: new Vector3(1, 1, 1) };
  const support = createSourceSupport(doc), bounds = support.measure({ byName: new Map([['bone', pose], ['mesh', pose]]) }, true);
  const actual = points.map(p => new Vector3(...p).applyQuaternion(rotation).add(translation));
  assert.ok(Math.abs(bounds.minY - Math.min(...actual.map(p => p.y))) < 1e-6);
  assert.ok(Math.abs(bounds.maxY - Math.max(...actual.map(p => p.y))) < 1e-6);
  assert.equal(support.supportVertices, 8);
});

test('stage travel locks the supporting target foot instead of imposing a sliding speed cap', () => {
  const samples = [0, 1, 2].map(i => ({ time: i / 30, L: [0, .002, -i * .15], R: [.2, .2, i * .1] }));
  const travel = integrateStance(samples);
  assert.deepEqual(travel.positions, [[0, 0], [0, .15], [0, .3]]);
  assert.equal(travel.maxSupportSlide, 0); assert.ok(travel.maxStageSpeed > 4.4);
  for (let i = 0; i < samples.length; i++) assert.ok(Math.abs(samples[i].L[2] + travel.positions[i][1]) < 1e-8);
});

test('rounding travel timestamps removes duplicate times with their matching position', () => {
  assert.deepEqual(compactTravel([0, 1 / 30, .033333334, .5], [[0, 0], [.1, .2], [.11, .22], [.5, 1]]),
    { times: [0, .033333, .5], positionsXZ: [[0, 0], [.11, .22], [.5, 1]] });
});
