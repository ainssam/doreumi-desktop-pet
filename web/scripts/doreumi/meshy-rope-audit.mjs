#!/usr/bin/env node
// Run with: node --import ./tests/register-alias.mjs scripts/doreumi/meshy-rope-audit.mjs
// The actual product prop geometry is tested against the decoded master skin.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
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
if (!rope) throw new Error('The shipping rope tube was not found');
const mesh = asset.skinned[0].object, indices = mesh.geometry.index;
const points = Array.from({ length: mesh.geometry.attributes.position.count }, () => new THREE.Vector3());
const direction = new THREE.Vector3(.7123, .19283, .6748).normalize(), near = new THREE.Vector3();
const times = [...new Set([...Array.from({ length: Math.floor(clip.duration * 12) + 1 }, (_, index) => index / 12), clip.duration * .375, clip.duration * .875])].sort((a, b) => a - b);
const results = [];
for (let frame = 0; frame < times.length; frame++) {
  const time = times[frame]; mixer.setTime(time); holder.updateMatrixWorld(true); mesh.skeleton.update();
  props.update({ time, duration: clip.duration }); if (!props.inspect().visible) continue;
  for (let vertex = 0; vertex < points.length; vertex++) mesh.getVertexPosition(vertex, points[vertex]).applyMatrix4(mesh.matrixWorld);
  const tree = new Octree();
  for (let index = 0; index < indices.count; index += 3) tree.addTriangle(new THREE.Triangle(points[indices.getX(index)], points[indices.getX(index + 1)], points[indices.getX(index + 2)]));
  tree.build();
  const position = rope.geometry.getAttribute('position'), centers = [];
  for (let index = 0; index < 49; index++) {
    const center = new THREE.Vector3();
    for (let side = 0; side < 6; side++) center.add(new THREE.Vector3().fromBufferAttribute(position, index * 6 + side));
    centers.push(center.multiplyScalar(1 / 6).applyMatrix4(rope.matrixWorld));
  }
  let collisions = 0, inside = 0, minDistance = Infinity, worst;
  // Held handle endpoints are excluded; every free-rope segment is sampled.
  for (let index = 2; index < 46; index++) for (let part = 0; part < 4; part++) {
    const center = centers[index].clone().lerp(centers[index + 1], part / 4), triangles = [];
    tree.getSphereTriangles(new THREE.Sphere(center, .012), triangles);
    let distance = Infinity;
    for (const triangle of triangles) distance = Math.min(distance, triangle.closestPointToPoint(center, near).distanceTo(center));
    minDistance = Math.min(minDistance, distance);
    if (distance < .011) { collisions++; worst = { index, part, center: center.toArray(), distance }; }
    const ray = new THREE.Ray(center, direction), rayTriangles = [], hits = [];
    tree.getRayTriangles(ray, rayTriangles);
    for (const triangle of rayTriangles) if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, near)) hits.push(near.distanceTo(center));
    hits.sort((a, b) => a - b);
    const unique = hits.filter((distance, index) => !index || distance - hits[index - 1] > 1e-5);
    if (unique.length % 2 === 1) inside++;
  }
  results.push({ time, collisions, inside, minDistance: Number.isFinite(minDistance) ? minDistance : null, worst });
  if (frame % 24 === 0) console.log(JSON.stringify({ frame, total: times.length, time, collisions, inside }));
}
const report = { actionId: 46, clipSha256: item.convertedSha256, masterSha256: sha('public/doreumi/doreumi-master.glb'),
  propsSha256: sha('src/lib/doreumi/motion-portable-props.ts'),
  method: 'Full decoded master triangles; rope centerline at four samples per segment excluding held endpoints; triangle closest-point radius 0.011 plus double-sided ray parity for inside points.',
  samples: results.length, totalSurfaceIntersections: results.reduce((count, row) => count + row.collisions, 0), totalInsidePoints: results.reduce((count, row) => count + row.inside, 0), results };
fs.mkdirSync('.artifacts/doreumi-contact-audit', { recursive: true });
fs.writeFileSync('.artifacts/doreumi-contact-audit/rope-46.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ samples: report.samples, totalSurfaceIntersections: report.totalSurfaceIntersections, totalInsidePoints: report.totalInsidePoints }));
props.dispose();
if (report.totalSurfaceIntersections || report.totalInsidePoints) process.exitCode = 1;
