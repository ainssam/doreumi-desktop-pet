#!/usr/bin/env node
/** Offline checks on the actual generated animation files. This is not visual approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AnimationClip, Quaternion } from 'three';
import { createMasterSupport } from './meshy-master-support.mjs';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { SOURCE_MAP } from './meshy-validate-source.mjs';
import { PLANAR_SUPPORT_ACTIONS } from './meshy-planar-support.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = read('public/doreumi/motions/meshy-source-manifest.json'), contract = read('public/doreumi/rig-contract.json');
const master = path.join(ROOT, 'public/doreumi/doreumi-master.glb'), masterSha256 = sha(fs.readFileSync(master));
const support = await createMasterSupport(master, contract), target = targetGraph(contract);
const uuids = new Set(), failures = [], records = [];
let bytes = 0, sampleCount = 0;
const expectedNames = new Set([...Object.keys(SOURCE_MAP).map(name => `${name}.quaternion`), 'DoreumiRig.position']);
for (const item of manifest.motions) {
  const errors = [], file = path.join(ROOT, 'public', item.url ?? 'missing');
  if (item.retarget !== 'converted' || !fs.existsSync(file)) { failures.push({ actionId: item.actionId, errors: ['Missing target derivative'] }); continue; }
  const raw = fs.readFileSync(file), json = JSON.parse(raw), clip = AnimationClip.parse(json); bytes += raw.length;
  if (sha(raw) !== item.convertedSha256) errors.push('Output hash changed');
  if (clip.name !== `meshy:${item.actionId}` || !clip.uuid || uuids.has(clip.uuid)) errors.push('Invalid name or duplicate UUID');
  uuids.add(clip.uuid);
  if (item.retargetEvidence.masterSha256 !== masterSha256) errors.push('Master hash changed');
  if (clip.tracks.length !== expectedNames.size) errors.push('Unexpected track count');
  for (const track of clip.tracks) {
    if (!expectedNames.has(track.name)) errors.push('Non-contract transform track');
    if (!Array.from(track.values).every(Number.isFinite) || !Array.from(track.times).every(Number.isFinite)) errors.push('Non-finite animation');
    if (Array.from(track.times).some((t, i) => i && t <= track.times[i - 1])) errors.push('Non-monotonic animation');
    if (Math.abs(track.times.at(-1) - clip.duration) > 2e-5 || track.times[0] !== 0) errors.push('Track does not cover full clip');
    if (track.name.endsWith('.position')) {
      const planar = item.retargetEvidence.planarSupport;
      if (planar) {
        if (!PLANAR_SUPPORT_ACTIONS.has(item.actionId) || planar.version !== 1 || !Number.isFinite(planar.maxOffset) || planar.maxOffset < 0 || planar.maxOffset > 2 || item.retargetEvidence.semantics.travel) errors.push('Invalid planar support contract');
        for (let i = 0; i < track.values.length; i += 3) if (Math.hypot(track.values[i], track.values[i + 2]) > planar.maxOffset + 1e-5) errors.push('Planar support exceeds declared bound');
        if (Math.hypot(track.values[0], track.values[2], track.values.at(-3), track.values.at(-1)) > 1e-6) errors.push('Planar entry/exit does not return to dock');
      } else if (Array.from(track.values).some((value, i) => i % 3 !== 1 && value !== 0)) errors.push('Horizontal root travel');
    } else {
      for (let i = 0; i < track.values.length; i += 4) if (Math.abs(new Quaternion().fromArray(track.values, i).length() - 1) > 2e-6) errors.push('Non-unit quaternion');
      const idle = support.idleRotations.get(track.name.split('.')[0]);
      if (idle.angleTo(new Quaternion().fromArray(track.values).normalize()) > 1e-5 || idle.angleTo(new Quaternion().fromArray(track.values, track.values.length - 4).normalize()) > 1e-5) errors.push('Entry/recovery differs from master Idle');
    }
  }
  const samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  // Include transitions plus evenly spaced interior samples. Geometry is measured
  // after decoding and interpolating the shipped JSON, not from the pre-bake arrays.
  const e = item.retargetEvidence;
  const times = new Set([0, e.entryDuration / 2, e.entryDuration, clip.duration - e.exitDuration, clip.duration - e.exitDuration / 2, clip.duration,
    ...Array.from({ length: 25 }, (_, i) => clip.duration * (i + .5) / 25)]);
  let minY = Infinity, maxY = -Infinity, radius = 0;
  for (const time of times) {
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(time));
    target.ordered.forEach(updateNode); const frame = support.measure(target, true);
    minY = Math.min(minY, frame.minY); maxY = Math.max(maxY, frame.maxY); radius = Math.max(radius, frame.radius); sampleCount++;
  }
  if (minY < -.0214) errors.push(`Skin penetrates ground: ${minY}`);
  const f = e.framing;
  if (Math.max(Math.abs(minY - f.centerY), Math.abs(maxY - f.centerY), radius) > f.halfHeight + .015) errors.push('Skin escapes declared framing');
  records.push({ actionId: item.actionId, duration: clip.duration, minY, maxY, radius, bytes: raw.length, pass: errors.length === 0 });
  if (errors.length) failures.push({ actionId: item.actionId, errors: [...new Set(errors)] });
  if (records.length % 50 === 0) console.log(JSON.stringify({ event: 'verification_progress', checked: records.length, failures: failures.length }));
}
const report = { pass: failures.length === 0 && records.length === 524, kind: 'offline-data-and-sampled-skin', checkedAt: new Date().toISOString(),
  masterSha256, clips: records.length, directlyDownloaded: manifest.counts.downloaded, locallyDerived: manifest.counts.locallyDerived, samples: sampleCount, totalBytes: bytes, failures, records };
const output = path.join(ROOT, '.artifacts/doreumi-meshy/evidence/final-conversion-report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ pass: report.pass, clips: records.length, samples: sampleCount, failures, totalBytes: bytes }));
if (!report.pass) process.exitCode = 1;
