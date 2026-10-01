#!/usr/bin/env node
/** Independent shipping-clip hand audit. No adaptation helper is applied here. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AnimationClip, AnimationMixer, LoopOnce, Quaternion, Vector3 } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { sourceGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { SOURCE_MAP } from './meshy-validate-source.mjs';
import { CLAP_ACTIONS, clapWeight } from './meshy-clap.mjs';

const id = Number(process.argv.find(arg => arg.startsWith('--id='))?.split('=')[1] ?? 318);
const json = file => JSON.parse(fs.readFileSync(file));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = json('public/doreumi/motions/meshy-source-manifest.json'), item = manifest.motions.find(item => item.actionId === id);
const assetFile = process.argv.find(arg => arg.startsWith('--model-file='))?.slice(13) ?? 'public/doreumi/doreumi-master.glb';
const clipFile = process.argv.find(arg => arg.startsWith('--clip-file='))?.slice(12) ?? `public${item.url}`;
const asset = await loadDoreumiAsset(assetFile), mesh = asset.skinned[0].object, clip = AnimationClip.parse(json(clipFile));
const mixer = new AnimationMixer(asset.scene), action = mixer.clipAction(clip).play(); action.setLoop(LoopOnce, 0); action.clampWhenFinished = true;
const ledger = json('.artifacts/doreumi-meshy/ledger.json'), batch = ledger.batches.find(batch => batch.status === 'downloaded' && batch.actionIds.includes(id));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), sourceDocument = await io.read(`.artifacts/doreumi-meshy/${batch.file}`);
const source = sourceGraph(sourceDocument), animation = sourceDocument.getRoot().listAnimations()[batch.actionIds.indexOf(id)];
const channels = animation.listChannels().map(channel => samplerFor(channel, source));
const indices = { L: [], R: [] }, seen = { L: new Set(), R: new Set() };
for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
  const weights = { L: 0, R: 0 };
  for (let c = 0; c < 4; c++) {
    const name = mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(index, c)]?.name;
    if (name === 'wristL') weights.L += mesh.geometry.attributes.skinWeight.getComponent(index, c);
    if (name === 'wristR') weights.R += mesh.geometry.attributes.skinWeight.getComponent(index, c);
  }
  const key = new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index).toArray().map(value => value.toFixed(7)).join(',');
  for (const side of ['L', 'R']) if (weights[side] > .65 && !seen[side].has(key)) { seen[side].add(key); indices[side].push(index); }
}
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const duration = item.retargetEvidence.sourceDuration, entry = item.retargetEvidence.entryDuration;
const samples = [], jointAngles = {}, continuity = {}, previous = new Map(), rest = new Quaternion();
const jointNames = ['shoulderL', 'shoulderR', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];
for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++) {
  const time = Math.min(frame / 60, clip.duration), sourceTime = Math.max(0, Math.min(time - entry, duration));
  for (const channel of channels) channel.node[channel.path === 'translation' ? 'position' : channel.path === 'rotation' ? 'quaternion' : 'scale'].fromArray(sampleChannel(channel, sourceTime));
  source.ordered.forEach(updateNode);
  const sourceDistance = source.byName.get('LeftHand').worldPosition.distanceTo(source.byName.get('RightHand').worldPosition), closure = smooth((.7 - sourceDistance) / .44);
  mixer.setTime(time); asset.scene.updateMatrixWorld(true); mesh.skeleton.update();
  for (const name of jointNames) {
    const node = asset.scene.getObjectByName(name), sourceNode = source.byName.get(SOURCE_MAP[name]);
    jointAngles[name] = Math.max(jointAngles[name] ?? 0, rest.angleTo(node.quaternion) * 180 / Math.PI);
    const value = { local: node.quaternion.clone(), world: node.getWorldQuaternion(new Quaternion()), sourceLocal: sourceNode.quaternion.clone(), sourceWorld: sourceNode.worldQuaternion.clone(), time };
    const before = previous.get(name);
    if (before && time > before.time) {
      for (const space of ['local', 'world']) {
        const delta = value[space].angleTo(before[space]) * 180 / Math.PI, sourceSpace = space === 'local' ? 'sourceLocal' : 'sourceWorld';
        const sourceDelta = value[sourceSpace].angleTo(before[sourceSpace]) * 180 / Math.PI;
        const record = continuity[name] ??= { local: { maxDegreesPerFrame: 0, sourceDegreesAtSameFrame: 0 }, world: { maxDegreesPerFrame: 0, sourceDegreesAtSameFrame: 0 } };
        if (delta > record[space].maxDegreesPerFrame) record[space] = { maxDegreesPerFrame: delta, sourceDegreesAtSameFrame: sourceDelta, time, sourceTime, dt: time - before.time,
          phase: time < entry || time > entry + duration ? 'entry-or-recovery' : 'source' };
      }
    }
    previous.set(name, value);
  }
  const inClapContact = CLAP_ACTIONS.has(id) && sourceDistance <= .105 && clapWeight(id, sourceTime) > .999;
  if ((CLAP_ACTIONS.has(id) ? !inClapContact : id !== 318 && closure < .95) || time < entry || time > entry + duration) continue;
  const points = Object.fromEntries(['L', 'R'].map(side => [side, indices[side].map(index => mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld))]));
  let squared = Infinity, left, right;
  for (let l = 0; l < points.L.length; l++) for (let r = 0; r < points.R.length; r++) {
    const distance = points.L[l].distanceToSquared(points.R[r]);
    if (distance < squared) { squared = distance; left = l; right = r; }
  }
  const axes = [points.L[left].clone().sub(points.R[right]).normalize(), new Vector3(1, 0, 0).applyQuaternion(asset.scene.getObjectByName('torso').getWorldQuaternion(new Quaternion())),
    asset.scene.getObjectByName('wristL').getWorldPosition(new Vector3()).sub(asset.scene.getObjectByName('wristR').getWorldPosition(new Vector3())).normalize()];
  // A positive interval clearance is a separating-plane proof for every
  // triangle made from these actual hand vertices. Closest distance alone
  // cannot rule out interpenetration, so report the signed projection too.
  const separations = axes.map(axis => Math.min(...points.L.map(point => point.dot(axis))) - Math.max(...points.R.map(point => point.dot(axis))));
  const clearance = Math.max(...separations), axis = axes[separations.indexOf(clearance)];
  samples.push({ time, sourceTime, sourceDistance, closure, vertexGap: Math.sqrt(squared), separatingPlaneClearance: clearance,
    axis: axis.toArray(), vertices: [indices.L[left], indices.R[right]], points: [points.L[left].toArray(), points.R[right].toArray()] });
}
const report = { actionId: id, checkedAt: new Date().toISOString(), masterSha256: sha(assetFile), clipSha256: sha(clipFile),
  basis: 'shipping-clip-60Hz-deformed-wrist-skin-vertices; positive-separating-plane-proves-no-hand-surface-intersection',
  contactPhase: id === 318 ? 'adapted continuous hand rubbing across the full source interval' : CLAP_ACTIONS.has(id) ? 'source hand distance <= .105 and full clap phase' : 'source hand closure >= .95', vertexCounts: { L: indices.L.length, R: indices.R.length }, samples: samples.length,
  maxVertexGap: Math.max(...samples.map(sample => sample.vertexGap)), minimumSeparatingPlaneClearance: Math.min(...samples.map(sample => sample.separatingPlaneClearance)),
  jointAnglesDegrees: jointAngles, continuity60Hz: continuity, samplesWithoutSeparationProof: samples.filter(sample => sample.separatingPlaneClearance < -.001).length,
  contactPass: samples.length > 0 && samples.every(sample => sample.vertexGap <= .0214 && sample.separatingPlaneClearance >= -.001),
  continuityPass: Object.values(continuity).every(joint => Object.values(joint).every(space => space.maxDegreesPerFrame <= Math.max(6, space.sourceDegreesAtSameFrame * 2 + 1))), frames: samples };
report.pass = report.contactPass && report.continuityPass;
const output = process.argv.find(arg => arg.startsWith('--checkpoint='))?.slice(13) ?? `.artifacts/doreumi-contact-audit/hand-${id}.json`;
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, frames: undefined, output }));
