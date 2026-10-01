#!/usr/bin/env node
// Run with: node --import ./tests/register-alias.mjs scripts/doreumi/meshy-rope-timing.mjs
// Verify the actual rope crosses below each actual foot while both feet are up.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { createDoreumiContextProps } from '../../src/lib/doreumi/motion-context-props.ts';

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = JSON.parse(fs.readFileSync('public/doreumi/motions/meshy-source-manifest.json', 'utf8'));
const item = manifest.motions.find(motion => motion.actionId === 46);
const clip = THREE.AnimationClip.parse(JSON.parse(fs.readFileSync(`public${item.url}`, 'utf8')));
const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), holder = new THREE.Group(); holder.add(asset.scene);
const mixer = new THREE.AnimationMixer(asset.scene), action = mixer.clipAction(clip).play();
action.setLoop(THREE.LoopOnce, 0); action.clampWhenFinished = true;
const props = createDoreumiContextProps({ model: asset.scene, parent: holder });
props.setMotion({ sourceActionId: 46, props: ['jump-rope'], entryDuration: item.retargetEvidence.entryDuration, exitDuration: item.retargetEvidence.exitDuration });
let rope;
props.root.traverse(object => { if (object.isMesh && object.geometry.getAttribute('position').count === 294) rope = object; });
if (!rope) throw new Error('The shipping rope was not found');
const mesh = asset.skinned[0].object, vertices = { L: [], R: [] };
for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) for (let component = 0; component < 4; component++) {
  const name = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(vertex, component)].name;
  if (/^foot[LR]$/.test(name) && mesh.geometry.attributes.skinWeight.getComponent(vertex, component) > .6) vertices[name.at(-1)].push(vertex);
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function hull(points) {
  const sorted = points.map(point => [point.x, point.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), lower = [], upper = [];
  for (const point of sorted) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop(); lower.push(point); }
  for (const point of sorted.toReversed()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const contains = (polygon, point) => polygon.every((a, index) => cross(a, polygon[(index + 1) % polygon.length], [point.x, point.z]) >= -1e-8);
const rows = [], crossings = { L: [], R: [] };
for (let frame = 0; frame <= Math.floor(clip.duration * 60); frame++) {
  const time = frame / 60; mixer.setTime(time); holder.updateMatrixWorld(true); mesh.skeleton.update(); props.update({ time, duration: clip.duration });
  if (!props.inspect().visible) continue;
  const feet = Object.fromEntries(['L', 'R'].map(side => [side, vertices[side].map(vertex => mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))]));
  const soles = Object.fromEntries(['L', 'R'].map(side => [side, Math.min(...feet[side].map(point => point.y))]));
  const polygons = Object.fromEntries(['L', 'R'].map(side => [side, hull(feet[side])])), centers = [];
  for (let index = 0; index < 49; index++) {
    const center = new THREE.Vector3();
    for (let side = 0; side < 6; side++) center.add(new THREE.Vector3().fromBufferAttribute(rope.geometry.attributes.position, index * 6 + side));
    centers.push(center.multiplyScalar(1 / 6).applyMatrix4(rope.matrixWorld));
  }
  const row = { time, soles, underFoot: {} };
  for (const side of ['L', 'R']) {
    const clearances = [];
    for (let index = 2; index < 46; index++) for (let part = 0; part < 4; part++) {
      const point = centers[index].clone().lerp(centers[index + 1], part / 4);
      if (point.y < .2 && contains(polygons[side], point)) clearances.push(soles[side] - point.y - .011);
    }
    if (clearances.length) {
      row.underFoot[side] = { ropeSamples: clearances.length, minimumClearance: Math.min(...clearances) };
      crossings[side].push({ time, clearance: row.underFoot[side].minimumClearance, otherSole: soles[side === 'L' ? 'R' : 'L'] });
    }
  }
  rows.push(row);
}
const groups = Object.fromEntries(['L', 'R'].map(side => {
  const list = [];
  for (const crossing of crossings[side]) {
    if (!list.length || crossing.time - list.at(-1).at(-1).time > .1) list.push([]);
    list.at(-1).push(crossing);
  }
  return [side, list.map(group => ({ start: group[0].time, end: group.at(-1).time, samples: group.length, minimumClearance: Math.min(...group.map(row => row.clearance)), minimumOtherSole: Math.min(...group.map(row => row.otherSole)) }))];
}));
const report = { actionId: 46, clipSha256: item.convertedSha256, masterSha256: sha('public/doreumi/doreumi-master.glb'), propsSha256: sha('src/lib/doreumi/motion-portable-props.ts'), fps: 60,
  basis: 'Actual rope centerline sampled four times per segment; lower-arc XZ containment within each decoded foot skin convex hull. Clearance subtracts actual minimum sole Y and the 0.011 tube radius. Both feet must be airborne during each lower crossing.',
  groups, minimumClearance: Math.min(...Object.values(crossings).flat().map(row => row.clearance)), minimumOtherSole: Math.min(...Object.values(crossings).flat().map(row => row.otherSole)), rows };
report.pass = Object.values(groups).every(groups => groups.length === 8) && report.minimumClearance > .002 && report.minimumOtherSole > .025;
fs.writeFileSync('.artifacts/doreumi-contact-audit/rope-46-timing.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined })); props.dispose(); if (!report.pass) process.exitCode = 1;
