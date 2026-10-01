#!/usr/bin/env node
/** Per-frame exact skin bounds for camera planning. Never modifies a clip. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { AnimationClip } from 'three';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { createMasterSupport } from './meshy-master-support.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ids = (process.argv.find(arg => arg.startsWith('--ids='))?.slice(6) ?? '501,508').split(',').map(Number);
const contract = read('public/doreumi/rig-contract.json'), manifest = read('public/doreumi/motions/meshy-source-manifest.json');
const master = 'public/doreumi/doreumi-master.glb', support = await createMasterSupport(master, contract);
const reports = [];
for (const id of ids) {
  const item = manifest.motions.find(item => item.actionId === id);
  if (!item?.url) throw new Error(`Missing converted motion ${id}`);
  const file = `public${item.url}`, clip = AnimationClip.parse(read(file)), graph = targetGraph(contract);
  const tracks = clip.tracks.map(track => ({ node: graph.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const frames = [];
  for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++) {
    const time = Math.min(clip.duration, frame / 60);
    for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(time));
    graph.ordered.forEach(updateNode);
    const bounds = support.measure(graph, true);
    const value = { time, ...bounds, centerY: (bounds.minY + bounds.maxY) / 2, root: graph.byName.get('DoreumiRig').position.toArray() };
    if (frames.length && time - frames.at(-1).time < 1e-6) frames[frames.length - 1] = value;
    else frames.push(value);
  }
  reports.push({ actionId: id, clipSha256: sha(file), masterSha256: sha(master), duration: clip.duration, fps: 60,
    sourceDuration: item.retargetEvidence.sourceDuration, entryDuration: item.retargetEvidence.entryDuration,
    basis: 'Decoded shipping clip, exact morph-aware skin envelope; camera data only, source root height and motion remain untouched.',
    cameraCandidate: { version: 1, halfHeight: Math.max(...frames.map(frame => Math.max((frame.maxY - frame.minY) / 2 + .16, frame.radius + .16))),
      times: frames.map(frame => frame.time), centerY: frames.map(frame => frame.centerY) }, frames });
}
const output = '.artifacts/doreumi-contact-audit/framing-candidates.json';
fs.mkdirSync('.artifacts/doreumi-contact-audit', { recursive: true });
fs.writeFileSync(output, JSON.stringify({ reports }, null, 2) + '\n');
console.log(JSON.stringify({ output, reports: reports.map(({ frames, cameraCandidate, ...report }) => ({ ...report,
  frames: frames.length, constantHalfHeight: cameraCandidate.halfHeight, centerYRange: [Math.min(...cameraCandidate.centerY), Math.max(...cameraCandidate.centerY)] })) }));
