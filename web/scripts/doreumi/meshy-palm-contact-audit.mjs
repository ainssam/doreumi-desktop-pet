#!/usr/bin/env node
/** Actual material-point support audit of decoded shipping acrobatics. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { AnimationClip, Vector3 } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';
import { createSourceSupport } from './meshy-master-support.mjs';

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ids = (process.argv.find(arg => arg.startsWith('--ids='))?.slice(6) ?? '406,451').split(',').map(Number);
const manifest = json(process.argv.find(arg => arg.startsWith('--manifest='))?.slice(11) ?? 'public/doreumi/motions/meshy-source-manifest.json'), ledger = json('.artifacts/doreumi-meshy/ledger.json');
const contract = json('public/doreumi/rig-contract.json'), master = 'public/doreumi/doreumi-master.glb';
const asset = await loadDoreumiAsset(master), targetSampler = createPlanarFootSampler(asset.document, { L: ['wristL'], R: ['wristR'] }, { morphWeight: 1 });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), reports = [];
for (const id of ids) {
  if (![406, 451].includes(id)) throw new Error('No measured source support interval for this action');
  const item = manifest.motions.find(item => item.actionId === id), e = item.retargetEvidence;
  const batch = ledger.batches.find(batch => batch.status === 'downloaded' && batch.actionIds.includes(id));
  const document = await io.read(`.artifacts/doreumi-meshy/${batch.file}`), source = sourceGraph(document), sourceFloor = createSourceSupport(document).measure(source);
  const animation = document.getRoot().listAnimations()[batch.actionIds.indexOf(id)], channels = animation.listChannels().map(channel => samplerFor(channel, source));
  const sourceSampler = createPlanarFootSampler(document, { L: ['LeftHand'], R: ['RightHand'] }, { morphWeight: 0 });
  const clipFile = `public/${item.url}`, clip = AnimationClip.parse(json(clipFile)), target = targetGraph(contract);
  const tracks = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const interval = id === 406 ? e.acrobatics?.palmPlanarSupport?.sourceInterval ?? [0, 26 / 60] : [1.15, 161 / 60];
  let targetVertex, sourceVertex, originTarget, originSource, before;
  const samples = [];
  for (let frame = 0; frame <= Math.round((interval[1] - interval[0]) * 60); frame++) {
    const time = interval[0] + frame / 60;
    for (const channel of channels) channel.node[channel.path === 'translation' ? 'position' : channel.path === 'rotation' ? 'quaternion' : 'scale'].fromArray(sampleChannel(channel, time));
    source.ordered.forEach(updateNode);
    for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(e.entryDuration + time));
    target.ordered.forEach(updateNode);
    const sourceHands = sourceSampler.sample(source), targetHands = targetSampler.sample(target);
    if (targetVertex === undefined) {
      targetVertex = targetHands.R.reduce((best, p, i) => p[1] < targetHands.R[best][1] ? i : best, 0);
      sourceVertex = sourceHands.R.reduce((best, p, i) => p[1] < sourceHands.R[best][1] ? i : best, 0);
      originTarget = new Vector3(...targetHands.R[targetVertex]); originSource = new Vector3(...sourceHands.R[sourceVertex]);
    }
    const targetPoint = new Vector3(...targetHands.R[targetVertex]), sourcePoint = new Vector3(...sourceHands.R[sourceVertex]);
    const targetDelta = before ? targetPoint.clone().sub(before.target) : new Vector3(), sourceDelta = before ? sourcePoint.clone().sub(before.source) : new Vector3();
    const desired = sourceDelta.clone().multiplyScalar(e.legRatio), residual = targetDelta.clone().sub(desired);
    samples.push({ sourceTime: time, targetPoint: targetPoint.toArray(), sourcePoint: sourcePoint.toArray(),
      targetPalmFloor: Math.min(...targetHands.R.map(point => point[1])), sourcePalmFloor: Math.min(...sourceHands.R.map(point => point[1])),
      targetDeltaXZ: Math.hypot(targetDelta.x, targetDelta.z), sourceDeltaXZ: Math.hypot(sourceDelta.x, sourceDelta.z),
      scaledResidualXZ: Math.hypot(residual.x, residual.z),
      targetDisplacementXZ: Math.hypot(targetPoint.x - originTarget.x, targetPoint.z - originTarget.z),
      sourceDisplacementXZ: Math.hypot(sourcePoint.x - originSource.x, sourcePoint.z - originSource.z) });
    before = { source: sourcePoint, target: targetPoint };
  }
  reports.push({ actionId: id, clipSha256: sha(clipFile), sourceSha256: sha(`.artifacts/doreumi-meshy/${batch.file}`), masterSha256: sha(master), fps: 60, sourceInterval: interval, sourceFloor,
    targetVertex: targetSampler.vertexIds.R[targetVertex], sourceVertex: sourceSampler.vertexIds.R[sourceVertex],
    ...(id === 406 ? { originalSourceContactEnd: e.acrobatics?.sourcePalmSupport?.contactEnd ?? null,
      supportRelease: e.acrobatics?.palmPlanarSupport?.supportRelease ?? null } : {}),
    basis: id === 451 ? 'Explicit one-palm-and-hip adaptation; one fixed actual palm material point across the entire full-weight hold. Original handstand contact parity is not claimed.'
      : 'Original early right-palm support window, one fixed source and one fixed target material point; source motion is scaled only for comparison.',
    maximumDeltaXZ: Math.max(...samples.map(sample => sample.targetDeltaXZ)), maximumTotalXZ: Math.max(...samples.map(sample => sample.targetDisplacementXZ)),
    maximumSourceDeltaXZ: Math.max(...samples.map(sample => sample.sourceDeltaXZ)), maximumScaledResidualXZ: Math.max(...samples.map(sample => sample.scaledResidualXZ)),
    maximumPalmHeight: Math.max(...samples.map(sample => sample.targetPalmFloor)), samples });
}
const output = process.argv.find(arg => arg.startsWith('--checkpoint='))?.slice(13) ?? '.artifacts/doreumi-contact-audit/palm-contact.json';
fs.mkdirSync('.artifacts/doreumi-contact-audit', { recursive: true });
fs.writeFileSync(output, JSON.stringify({ reports }, null, 2) + '\n');
console.log(JSON.stringify({ output, reports: reports.map(({ samples, ...report }) => report) }));
