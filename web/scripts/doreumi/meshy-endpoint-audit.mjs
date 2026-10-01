#!/usr/bin/env node
/** Read-only boundary audit of every acquired source and its shipping retarget. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { AnimationClip, Vector3 } from 'three';
import { sourceGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { createSourceSupport } from './meshy-master-support.mjs';
import { createFloorTransitionLibrary, describeFloorEndpoints } from './meshy-transition.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';

const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = json('public/doreumi/motions/meshy-source-manifest.json'), ledger = json('.artifacts/doreumi-meshy/ledger.json');
const contract = json('public/doreumi/rig-contract.json'), master = 'public/doreumi/doreumi-master.glb';
const library = await createFloorTransitionLibrary(master, contract);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), reports = [];
const up = new Vector3(0, 1, 0), forward = new Vector3(0, 0, 1);
const selected = process.argv.find(arg => arg.startsWith('--ids='))?.slice(6).split(',').map(Number);
for (const batch of ledger.batches.filter(batch => batch.status === 'downloaded')) {
  const motions = manifest.motions.filter(item => (selected ? selected.includes(item.actionId) : true)
    && batch.actionIds.includes(item.derivation?.baseSourceActionId ?? item.actionId));
  if (!motions.length) continue;
  const document = await io.read(`.artifacts/doreumi-meshy/${batch.file}`), source = sourceGraph(document);
  const support = createSourceSupport(document), restFloor = support.measure(source);
  const hands = createPlanarFootSampler(document, { L: ['LeftHand'], R: ['RightHand'] }, { morphWeight: 0 });
  const feet = createPlanarFootSampler(document, { L: ['LeftFoot', 'LeftToeBase'], R: ['RightFoot', 'RightToeBase'] }, { morphWeight: 0 });
  for (const item of motions) {
    const sourceId = item.derivation?.baseSourceActionId ?? item.actionId;
    const animation = document.getRoot().listAnimations()[batch.actionIds.indexOf(sourceId)], graph = sourceGraph(document);
    const channels = animation.listChannels().map(channel => samplerFor(channel, graph));
    const duration = Math.max(...channels.map(channel => channel.times.at(-1)));
    const sample = time => {
      for (const channel of channels) channel.node[channel.path === 'translation' ? 'position' : channel.path === 'rotation' ? 'quaternion' : 'scale'].fromArray(sampleChannel(channel, time));
      graph.ordered.forEach(updateNode);
      const hip = graph.byName.get('Hips'), b = support.measure(graph, true), h = hands.sample(graph), f = feet.sample(graph);
      return { time, hip: hip.worldPosition.toArray(), hipTilt: up.angleTo(up.clone().applyQuaternion(hip.worldQuaternion)) * 180 / Math.PI,
        faceY: forward.clone().applyQuaternion(hip.worldQuaternion).y, floor: b.minY, height: b.maxY - b.minY,
        palms: ['L', 'R'].map(side => Math.min(...h[side].map(point => point[1]))),
        soles: ['L', 'R'].map(side => Math.min(...f[side].map(point => point[1]))) };
    };
    const clipFile = `public${item.url}`, clip = AnimationClip.parse(json(clipFile));
    reports.push({ actionId: item.actionId, sourceName: item.sourceName, clipSha256: sha(clipFile), sourceSha256: item.sourceSha256,
      source: { restFloor, duration, entry: sample(0), exit: sample(duration) }, target: describeFloorEndpoints(clip, item.retargetEvidence, item, library),
      adapted: Boolean(item.retargetEvidence.floorTransitions || item.retargetEvidence.acrobatics),
      bounds: item.retargetEvidence.bounds, framing: item.retargetEvidence.framing,
      requiresProps: item.retargetEvidence.semantics.requiresProps });
  }
  console.log(JSON.stringify({ batch: batch.id, audited: reports.length }));
}
const output = '.artifacts/doreumi-transition-audit/endpoints.json';
fs.mkdirSync('.artifacts/doreumi-transition-audit', { recursive: true });
fs.writeFileSync(output, JSON.stringify({ masterSha256: sha(master), basis: 'Original donor skin and hip at source endpoints; decoded shipping source boundaries classified by the exact transition classifier.', count: reports.length, motions: reports }, null, 2) + '\n');
console.log(JSON.stringify({ output, count: reports.length, nonStanding: reports.filter(item => item.target.entry.kind !== 'standing' || item.target.exit.kind !== 'standing').map(item => ({ id: item.actionId, entry: item.target.entry.kind, exit: item.target.exit.kind, adapted: item.adapted })) }));
