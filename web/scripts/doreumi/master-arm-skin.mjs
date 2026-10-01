/** Anatomical weights for the unchanged, short-limbed Doreumi mesh. Only skin
 * arrays change. Positional seams share one field; poses are never an input. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';

export const DOREUMI_ARM_SKIN_VERSION = 9;
export const DOREUMI_ARM_SKIN_PARENT_SHA256 = 'ff950b38e254c5a92c4d198bc333cf9b5763883f5f824de06b8c688019f0afa1';
export const DOREUMI_ARM_SKIN_PARAMETERS = {
  proximalBoneDistanceMask: { lower: [.18, .25], upper: [.20, .28], verticalBlend: [-.42, -.35] },
  lowerField: [.30, .66], upperField: [.26, .69], verticalBlend: [-.51, -.43],
  elbowAxisBlendHalfWidth: .07, wristAxisBlendHalfWidth: .06, preserveTrunkRatio: true,
};
const sha = value => createHash('sha256').update(value).digest('hex');
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Unchanged neutral bind transform and measured master joint positions.
const bonePoint = ([x, y, z]) => new Vector3(Math.abs(x) * 1.0700000524520874, y * 1.0700000524520874 - .06999990463256833, z * 1.0700000524520874);
const shoulder = new Vector3(.4, -.245, 0), arm = new Vector3(.57, -.245, 0);
const elbow = new Vector3(.713, -.423, .029), wrist = new Vector3(.8, -.52, .06);
const upperAxis = new Vector3(.143, -.178, .029).normalize();
const forearmAxis = new Vector3(.087, -.097, .031).normalize();
function pointSegmentDistance(point, a, b) {
  const direction = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(direction) / direction.lengthSq()));
  return point.distanceTo(a.clone().addScaledVector(direction, t));
}

export function applyDoreumiAnatomicalArmWeights(mesh) {
  const geometry = mesh.geometry, positions = geometry.getAttribute('position');
  const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  assert.equal(sha(positions.array), '5c2d85ca808a64b2a09dad94321aa54575e65b29a1571cc41056bde0d2e7c359', 'Anatomical skin requires the unchanged original surface');
  assert.equal(sha(indices.array), '914bf05747e8f90c0c842867cc5ac0c5505858c7595789cc38e9f7e63c6546d1', 'Anatomical skin requires the canonical parent skin');
  assert.equal(sha(weights.array), '514f18503c91ad133369fc197ad6e968b9a1e4d3a0a5ef8d0e429231049922da', 'Anatomical skin must be applied once to the canonical parent');
  const bones = mesh.skeleton.bones, boneCount = bones.length;
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    for (const name of ['shoulder', 'arm', 'elbow', 'wrist']) assert(bones.some(bone => bone.name === name + side), 'Anatomical skin requires the measured master chain');
    for (const [name, expected] of [['arm', [.17 * sign, 0, 0]], ['elbow', [.143 * sign, -.178, .029]], ['wrist', [.087 * sign, -.097, .031]]]) {
      assert(bones.find(bone => bone.name === name + side).position.distanceTo(new Vector3(...expected)) < 1e-6, 'Anatomical skin requires unchanged short-limb proportions');
    }
  }
  const originalIndices = new Uint16Array(indices.array), originalWeights = new Float32Array(weights.array);
  const groups = [], byPosition = new Map();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const key = [0, 1, 2].map(component => Math.round(positions.getComponent(vertex, component) * 1e5)).join(',');
    let group = byPosition.get(key);
    if (!group) {
      group = { id: groups.length, vertices: [], position: [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)], weights: new Float64Array(boneCount) };
      groups.push(group); byPosition.set(key, group);
      for (let component = 0; component < 4; component++) group.weights[indices.getComponent(vertex, component)] += weights.getComponent(vertex, component);
    }
    group.vertices.push(vertex);
  }
  for (const group of groups) {
    const [x, y] = group.position, point = bonePoint(group.position);
    const distance = Math.min(pointSegmentDistance(point, shoulder, arm), pointSegmentDistance(point, arm, elbow));
    const verticalBlend = smooth(-.42, -.35, y);
    const proximal = smooth(.32, .43, Math.abs(x)) * (1 - smooth(.68, .80, Math.abs(x)))
      * (1 - smooth(.18 + .02 * verticalBlend, .25 + .03 * verticalBlend, distance)) * (1 - smooth(-.08, .1, y));
    const distal = smooth(.60, .68, Math.abs(x)) * smooth(-.67, -.53, y) * (1 - smooth(-.12, 0, y));
    group.mask = Math.max(proximal, distal);
  }
  const active = groups.filter(group => group.mask > 0);
  const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
  function proximalField(a, b) {
    const field = groups.map(group => group.weights.slice());
    for (const group of active) {
      const x = group.position[0], side = x > 0 ? 'L' : 'R', base = group.weights;
      const next = new Float64Array(boneCount);
      const elbowIndex = boneIndex.get(`elbow${side}`), wristIndex = boneIndex.get(`wrist${side}`);
      const mass = 1 - base[elbowIndex] - base[wristIndex];
      next[elbowIndex] = base[elbowIndex]; next[wristIndex] = base[wristIndex];
      const collar = smooth(a, b - .07, Math.abs(x)), upper = smooth(a + .10, b, Math.abs(x));
      const trunk = ['head', 'torso', 'body'].map(name => boneIndex.get(name));
      const trunkSum = trunk.reduce((sum, index) => sum + base[index], 0);
      if (trunkSum > 1e-8) for (const index of trunk) next[index] = mass * (1 - collar) * base[index] / trunkSum;
      else next[boneIndex.get('torso')] = mass * (1 - collar);
      next[boneIndex.get(`shoulder${side}`)] = mass * collar * (1 - upper);
      next[boneIndex.get(`arm${side}`)] = mass * collar * upper;
      for (let joint = 0; joint < boneCount; joint++) field[group.id][joint] = base[joint] * (1 - group.mask) + next[joint] * group.mask;
    }
    return field;
  }
  function distalField(field) {
    const next = field.map(weights => weights.slice());
    for (const group of active) {
      const rawX = group.position[0], x = Math.abs(rawX), side = rawX > 0 ? 'L' : 'R';
      const blend = smooth(.58, .68, x); if (!blend) continue;
      const point = bonePoint(group.position);
      const lower = smooth(-.07, .07, point.clone().sub(elbow).dot(upperAxis));
      const hand = smooth(-.06, .06, point.clone().sub(wrist).dot(forearmAxis));
      const joints = ['arm', 'elbow', 'wrist'].map(name => boneIndex.get(name + side));
      const mass = joints.reduce((sum, index) => sum + field[group.id][index], 0);
      const target = [mass * (1 - lower), mass * lower * (1 - hand), mass * lower * hand];
      for (let component = 0; component < 3; component++) next[group.id][joints[component]] = field[group.id][joints[component]] * (1 - blend) + target[component] * blend;
    }
    return next;
  }
  const field = distalField(proximalField(.30, .66)), upperField = distalField(proximalField(.26, .69));
  for (const group of active) {
    const blend = smooth(-.51, -.43, group.position[1]);
    for (let joint = 0; joint < boneCount; joint++) field[group.id][joint] = field[group.id][joint] * (1 - blend) + upperField[group.id][joint] * blend;
    const top = Array.from(field[group.id], (weight, index) => [index, weight]).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((sum, [, weight]) => sum + weight, 0);
    for (const vertex of group.vertices) for (let component = 0; component < 4; component++) {
      indices.array[vertex * 4 + component] = top[component]?.[0] ?? 0;
      weights.array[vertex * 4 + component] = (top[component]?.[1] ?? 0) / total;
    }
  }
  let changedVertices = 0;
  for (let vertex = 0; vertex < positions.count; vertex++) if ([0, 1, 2, 3].some(component => indices.getComponent(vertex, component) !== originalIndices[vertex * 4 + component]
    || weights.getComponent(vertex, component) !== originalWeights[vertex * 4 + component])) changedVertices++;
  return { version: DOREUMI_ARM_SKIN_VERSION, changedVertices, positionalGroups: groups.length, parameters: DOREUMI_ARM_SKIN_PARAMETERS };
}
