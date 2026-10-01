/** No browser, server, or network. Validates shipped assets and the actual production mixer.
 * node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import sharp from 'sharp';
import { DoreumiMotion, prepareDoreumiClips } from '../../src/lib/doreumi/motion.ts';
import { DOREUMI_ACTIONS, DOREUMI_EXPRESSIONS, LOOP_ACTIONS, doreumiFrame, resolveDoreumiAction, resolveDoreumiExpression } from '../../src/lib/doreumi/motion-catalog.ts';

const sha = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(await readFile('public/doreumi/manifest.json', 'utf8'));
const glb = await readFile('public/doreumi/doreumi.glb');
assert.equal(sha(glb), manifest.model.sha256);
assert.equal(manifest.geometryExact, true);
assert.equal(manifest.actions.length, 26);
assert.equal(manifest.expressions.length, 34);
assert.deepEqual(manifest.actions.map(a => a.id), DOREUMI_ACTIONS.map(a => a[0]));
assert.deepEqual(manifest.expressions.map(e => e.id), DOREUMI_EXPRESSIONS.map(e => e[0]));
for (const expression of manifest.expressions) {
  const bytes = await readFile(`public/doreumi/expressions/${expression.id}.webp`);
  assert.equal(sha(bytes), expression.sha256);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 768); assert.equal(info.height, 768);
  let ink = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 16) ink++;
  assert.ok(ink > 300 && ink < 120000, `${expression.id}: unexpectedly empty or solid face`);
}
for (const prop of manifest.props) assert.equal(sha(await readFile(`public/doreumi/props/${prop.id}.glb`)), prop.sha256);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.readBinary(glb);
const nodes = document.getRoot().listNodes();
const joints = new Set(document.getRoot().listSkins().flatMap(skin => skin.listJoints()));
const objects = new Map(nodes.map(node => [node, joints.has(node) ? new THREE.Bone() : new THREE.Group()]));
const skinned = [];
for (const node of nodes) {
  let object = objects.get(node);
  const primitive = node.getMesh()?.listPrimitives()[0];
  if (primitive) {
    const geometry = new THREE.BufferGeometry();
    const map = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' };
    for (const [semantic, attribute] of Object.entries(map)) {
      const accessor = primitive.getAttribute(semantic);
      if (accessor) geometry.setAttribute(attribute, new THREE.BufferAttribute(accessor.getArray(), accessor.getElementSize(), accessor.getNormalized()));
    }
    geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray(), 1));
    for (const target of primitive.listTargets()) for (const semantic of ['POSITION', 'NORMAL']) {
      const accessor = target.getAttribute(semantic); if (!accessor) continue;
      (geometry.morphAttributes[semantic.toLowerCase()] ??= []).push(new THREE.BufferAttribute(accessor.getArray(), 3));
    }
    geometry.morphTargetsRelative = true;
    object = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    object.morphTargetInfluences[0] = 1;
    objects.set(node, object); skinned.push({ node, object });
  }
  object.name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
  object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale());
}
const scene = new THREE.Group();
for (const node of nodes) for (const child of node.listChildren()) objects.get(node).add(objects.get(child));
for (const node of document.getRoot().listScenes()[0].listChildren()) scene.add(objects.get(node));
scene.updateMatrixWorld(true);
for (const { node, object } of skinned) {
  const skin = node.getSkin(), matrices = skin.getInverseBindMatrices().getArray();
  const bones = skin.listJoints().map(joint => objects.get(joint));
  object.bind(new THREE.Skeleton(bones, bones.map((_, i) => new THREE.Matrix4().fromArray(matrices, i * 16))), new THREE.Matrix4());
}
const clips = document.getRoot().listAnimations().map(animation => new THREE.AnimationClip(animation.getName(), -1, animation.listChannels().map(channel => {
  const sampler = channel.getSampler(), target = channel.getTargetNode();
  const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[channel.getTargetPath()];
  assert.ok(property, 'Unexpected animated property');
  const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
  return new Track(`${objects.get(target).name}.${property}`, sampler.getInput().getArray(), sampler.getOutput().getArray());
})));
const sourceCopies = clips.map(clip => clip.tracks.map(t => Array.from(t.values)));
const prepared = prepareDoreumiClips(clips);
assert.equal(prepared.length, 26);
assert.deepEqual(clips.map(clip => clip.tracks.map(t => Array.from(t.values))), sourceCopies, 'Preparation mutated creator source tracks');
for (const clip of prepared) {
  for (const track of clip.tracks) {
    assert.ok(Array.from(track.values).every(Number.isFinite), `${clip.name}: nonfinite track`);
    if (track.name === 'DoreumiRig.position') for (let i = 0; i < track.values.length; i += 3) { assert.equal(track.values[i], 0); assert.equal(track.values[i + 2], 0); }
    if (LOOP_ACTIONS.has(clip.name)) {
      const size = track.getValueSize(), first = Array.from(track.values.slice(0, size)), last = Array.from(track.values.slice(-size));
      assert.ok(first.every((v, i) => Math.abs(v - last[i]) < 1e-5), `${clip.name}: loop endpoint ${track.name}`);
    }
  }
}
const bakeGrounding = process.argv.includes('--bake-grounding');
const motion = new DoreumiMotion(scene, clips, { grounding: !bakeGrounding });
function bounds() {
  scene.updateMatrixWorld(true); skinned.forEach(({ object }) => { object.skeleton.update(); object.computeBoundingBox(); });
  return new THREE.Box3().setFromObject(scene);
}
assert.equal(motion.rig.bones, 20); assert.equal(motion.rig.elbows, 2); assert.equal(motion.rig.knees, 2); assert.ok(motion.rig.kneeVertices > 1000); assert.equal(motion.rig.wrists, 2); assert.ok(motion.rig.influencedVertices > 5000); assert.ok(motion.rig.maxRestError < 1e-5, 'Articulation must preserve the bind mesh');
const initial = bounds(), floor = initial.min.y;
if (bakeGrounding) {
  const offsets = {}, summary = [];
  const surfaceContact = new Set(['Sit', 'Lie', 'Code', 'Read', 'Roll', 'NewYearBow', 'Think', 'Stretch', 'Cheer', 'Showcase', 'Snowman', 'Landing']);
  for (const clip of motion.clips) {
    const count = Math.round(clip.duration * 30), raw = [];
    for (let i = 0; i <= count; i++) {
      motion.seek(clip.name, clip.duration * i / count);
      const correction = floor - bounds().min.y;
      raw.push(surfaceContact.has(clip.name) ? correction : Math.max(0, correction));
    }
    // A short support envelope avoids sharp downward corrections next to ground contact.
    const smooth = raw.map((value, i) => Math.max(value, (raw[Math.max(0, i - 1)] + 2 * value + raw[Math.min(count, i + 1)]) / 4));
    if (LOOP_ACTIONS.has(clip.name)) smooth[0] = smooth[count] = Math.max(smooth[0], smooth[count]);
    if (Math.max(...smooth.map(Math.abs)) > .0005) offsets[clip.name] = smooth.map(value => Math.round(value * 1e6) / 1e6);
    summary.push({ action: clip.name, maxFloorCorrection: Math.max(...smooth) });
  }
  await writeFile('src/lib/doreumi/motion-grounding.ts', '// Generated by scripts/doreumi/motion-verify.mjs --bake-grounding.\n// Surface-sampled vertical correction; creator geometry and source clips stay untouched.\nexport const MOTION_GROUNDING: Record<string, number[]> = ' + JSON.stringify(offsets) + ';\n');
  console.log(JSON.stringify(summary, null, 2)); motion.dispose(); process.exit(0);
}
const samples = [], framingFailures = [];
for (const clip of prepared) for (let i = 0; i <= 20; i++) {
  motion.seek(clip.name, clip.duration * i / 20);
  const box = bounds(), values = [...box.min.toArray(), ...box.max.toArray()];
  assert.ok(values.every(Number.isFinite), `${clip.name}/${i}: nonfinite skinned vertex`);
  const frame = doreumiFrame(clip.name);
  if (!(box.min.x > -frame.halfWidth * .99 && box.max.x < frame.halfWidth * .99 && box.min.y - floor > -.01 && box.max.y - floor < frame.centerY + frame.halfHeight * .99)) framingFailures.push({ action: clip.name, sample: i, min: box.min.toArray(), max: box.max.toArray(), floor });
  samples.push({ action: clip.name, time: clip.duration * i / 20, min: box.min.toArray(), max: box.max.toArray() });
}
assert.deepEqual(framingFailures, [], 'Skinned poses must fit the avatar and stay above the floor');
const transitions = [];
for (const name of ['Sit', 'Lie', 'Code', 'Read']) {
  motion.seek(name, 5.9); motion.setAction('Run');
  assert.equal(motion.inspect().recovering, true);
  let maxStep = 0, previous = objects.get(nodes.find(n => n.getName() === 'DoreumiRig')).position.clone();
  for (let i = 0; i < 100; i++) {
    motion.update(1 / 60);
    const current = objects.get(nodes.find(n => n.getName() === 'DoreumiRig')).position;
    maxStep = Math.max(maxStep, previous.distanceTo(current)); previous.copy(current);
  }
  assert.equal(motion.inspect().action, 'Run'); assert.equal(motion.inspect().recovering, false);
  assert.ok(maxStep < .17, `${name}: root jumped during recovery`);
  transitions.push({ from: name, to: 'Run', maxRootStep: maxStep });
}
for (let i = 0; i < 100; i++) { motion.setAction(['Wave', 'Run', 'Walk', 'Think', 'Idle'][i % 5]); motion.update(.025); assert.ok(motion.inspect().activeActions <= 5, 'Unbounded transition accumulation'); }
for (let i = 0; i < 100; i++) motion.update(1 / 60);
assert.equal(motion.inspect().activeActions, 1);
for (const name of ['Sit', 'Lie', 'Code', 'Read']) {
  motion.seek(name, 5.9); motion.setAction('Run');
  for (let i = 0; i < 16; i++) motion.update(1 / 12);
  assert.equal(motion.inspect().action, 'Run', `${name}: 12fps recovery lost elapsed time`);
  assert.equal(motion.inspect().recovering, false);
}
assert.equal(resolveDoreumiAction('peek'), 'PeekRight'); assert.equal(resolveDoreumiAction('greet'), 'Wave'); assert.equal(resolveDoreumiExpression('happy'), 'smile');
for (const alias of ['run-left', 'run-right']) assert.equal(resolveDoreumiAction(alias), 'Run');
motion.seek('Sit', 4); motion.setAction('Dragged'); assert.equal(motion.inspect().action, 'Dragged'); assert.equal(motion.inspect().recovering, false);
motion.setAction('Falling'); assert.equal(motion.inspect().action, 'Falling');
motion.setAction('Landing'); for (let i = 0; i < 60; i++) motion.update(1 / 60); assert.equal(motion.inspect().action, 'Idle');
for (const { object } of skinned) {
  const weights = object.geometry.getAttribute('skinWeight');
  for (let i = 0; i < weights.count; i++) assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-6);
}
motion.dispose();
const report = { pass: true, source: manifest.source, actions: prepared.length, expressions: manifest.expressions.length, skinnedSamples: samples.length, loops: [...LOOP_ACTIONS], transitions, exactSourceTracksPreserved: true, rig: motion.rig, samples };
await mkdir('.collab-backend-react/doreumi-motion', { recursive: true });
await writeFile('.collab-backend-react/doreumi-motion/offline-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
