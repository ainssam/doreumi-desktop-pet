/** Exact skin support envelope, reduced only within groups with identical weights.
 * For identical weights, skinning is affine, so a convex hull retains every possible
 * floor extremum. Interior vertices can be discarded without losing body contact. */
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';

function spatial(points) {
  if (points.length < 12) return false;
  const origin = points[0], a = points.reduce((best, p) => p.distanceToSquared(origin) > best.distanceToSquared(origin) ? p : best, origin);
  const axis = a.clone().sub(origin); if (axis.lengthSq() < 1e-14) return false;
  let cross = new Vector3(), area = 0;
  for (const point of points) { const candidate = point.clone().sub(origin).cross(axis); if (candidate.lengthSq() > area) { area = candidate.lengthSq(); cross = candidate; } }
  if (area < 1e-14) return false; cross.normalize();
  return points.some(point => Math.abs(point.clone().sub(origin).dot(cross)) > 1e-8);
}

export async function createMasterSupport(file, contract) {
  const asset = await loadDoreumiAsset(file), idle = asset.clips.find(clip => clip.name === 'Idle');
  if (!idle) throw new Error('Master Idle is required for safe motion entry and recovery.');
  return { ...createSkinSupport(asset, contract.bones.map(bone => bone.name), idle), document: asset.document };
}

export function createSourceSupport(document) {
  const skinned = [];
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin(); if (!skin || !node.getMesh()) continue;
    for (const primitive of node.getMesh().listPrimitives()) {
      const geometry = new BufferGeometry();
      for (const [semantic, name] of [['POSITION', 'position'], ['JOINTS_0', 'skinIndex'], ['WEIGHTS_0', 'skinWeight']]) {
        const accessor = primitive.getAttribute(semantic);
        geometry.setAttribute(name, new BufferAttribute(accessor.getArray(), accessor.getElementSize(), accessor.getNormalized()));
      }
      skinned.push({ object: { geometry, bindMatrix: new Matrix4(), morphTargetInfluences: [],
        skeleton: { bones: skin.listJoints().map(joint => ({ name: joint.getName() })),
          boneInverses: skin.listJoints().map((_, index) => new Matrix4().fromArray(skin.getInverseBindMatrices().getArray(), index * 16)) } } });
    }
  }
  return createSkinSupport({ skinned }, document.getRoot().listNodes().map(node => node.getName()));
}

function createSkinSupport(asset, names, idle) {
  const nameIndices = new Map(names.map((name, index) => [name, index]));
  const retained = []; let originalVertices = 0, uniqueVertices = 0;
  for (const { object } of asset.skinned) {
    const geometry = object.geometry, position = geometry.getAttribute('position');
    const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const groups = new Map(); originalVertices += position.count;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const p = new Vector3().fromBufferAttribute(position, vertex);
      for (let m = 0; m < (geometry.morphAttributes.position?.length ?? 0); m++) {
        const influence = object.morphTargetInfluences?.[m] ?? 0;
        if (influence) p.addScaledVector(new Vector3().fromBufferAttribute(geometry.morphAttributes.position[m], vertex), influence);
      }
      p.applyMatrix4(object.bindMatrix);
      const influence = Array.from({ length: 4 }, (_, c) => [indices.getComponent(vertex, c), weights.getComponent(vertex, c)])
        .filter(([, weight]) => weight > 0).sort((a, b) => a[0] - b[0]);
      const key = JSON.stringify(influence);
      if (!groups.has(key)) groups.set(key, { influence, points: new Map() });
      groups.get(key).points.set(p.toArray().join(','), p);
    }
    for (const { influence, points: unique } of groups.values()) {
      let points = [...unique.values()]; uniqueVertices += points.length;
      if (spatial(points)) {
        const hull = new ConvexHull().setFromPoints(points), vertices = new Set();
        for (const face of hull.faces) { let edge = face.edge; do { vertices.add(edge.head().point); edge = edge.next; } while (edge !== face.edge); }
        points = [...vertices];
      }
      for (const point of points) {
        const entries = influence.map(([joint, weight]) => {
          const index = nameIndices.get(object.skeleton.bones[joint].name);
          if (index === undefined) throw new Error('Support vertex refers to a bone absent from the master contract.');
          const p = point.clone().applyMatrix4(object.skeleton.boneInverses[joint]);
          return { index, weighted: [p.x * weight, p.y * weight, p.z * weight, weight] };
        });
        retained.push(entries);
      }
    }
  }
  const offsets = new Int32Array(retained.length * 4).fill(-1), coordinates = new Float64Array(retained.length * 16);
  retained.forEach((entries, vertex) => entries.forEach((entry, component) => { offsets[vertex * 4 + component] = entry.index * 12; coordinates.set(entry.weighted, vertex * 16 + component * 4); }));
  const rows = new Float64Array(names.length * 12), matrix = new Matrix4();
  const idleRotations = new Map(names.map(name => {
    const track = idle?.tracks.find(track => track.name === `${name}.quaternion`);
    return [name, track ? new Quaternion().fromArray(track.values) : new Quaternion()];
  }));
  return { originalVertices, uniqueVertices, supportVertices: retained.length, idleRotations,
    measure(target, bounds = false, diagnostic = false) {
      for (let index = 0; index < names.length; index++) {
        const node = target.byName.get(names[index]);
        matrix.compose(node.worldPosition, node.worldQuaternion, node.worldScale);
        const e = matrix.elements;
        for (let axis = 0; axis < 3; axis++) { const offset = index * 12 + axis * 4; rows[offset] = e[axis]; rows[offset + 1] = e[axis + 4]; rows[offset + 2] = e[axis + 8]; rows[offset + 3] = e[axis + 12]; }
      }
      let minimum = Infinity, maximum = -Infinity, radiusSquared = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minimumIndex = -1, minimumPoint;
      for (let vertex = 0; vertex < retained.length; vertex++) {
        let x = 0, y = 0, z = 0;
        for (let c = 0; c < 4; c++) {
          const row = offsets[vertex * 4 + c]; if (row < 0) continue;
          const p = vertex * 16 + c * 4;
          y += rows[row + 4] * coordinates[p] + rows[row + 5] * coordinates[p + 1] + rows[row + 6] * coordinates[p + 2] + rows[row + 7] * coordinates[p + 3];
          if (bounds) {
            x += rows[row] * coordinates[p] + rows[row + 1] * coordinates[p + 1] + rows[row + 2] * coordinates[p + 2] + rows[row + 3] * coordinates[p + 3];
            z += rows[row + 8] * coordinates[p] + rows[row + 9] * coordinates[p + 1] + rows[row + 10] * coordinates[p + 2] + rows[row + 11] * coordinates[p + 3];
          }
        }
        if (y < minimum) { minimum = y; minimumIndex = vertex; if (diagnostic) minimumPoint = [x, y, z]; }
        if (bounds) { maximum = Math.max(maximum, y); radiusSquared = Math.max(radiusSquared, x * x + z * z); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      }
      return bounds ? { minY: minimum, maxY: maximum, minX, maxX, minZ, maxZ, radius: Math.sqrt(radiusSquared),
        ...(diagnostic ? { minimumVertex: { supportIndex: minimumIndex, position: minimumPoint, influences: retained[minimumIndex].map(entry => ({ bone: names[entry.index], weight: entry.weighted[3] })) } } : {}) } : minimum;
    },
  };
}
