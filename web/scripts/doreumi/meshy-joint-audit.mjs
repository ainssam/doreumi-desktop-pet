#!/usr/bin/env node
/** Report source-relative discontinuity candidates; never grants visual approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { AnimationClip } from 'three';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { SOURCE_MAP } from './meshy-validate-source.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const degrees = (a, b) => a.angleTo(b) * 180 / Math.PI;
export function measureJointStep(before, after) {
  return { targetLocalDegrees: degrees(before.local, after.local), targetWorldDegrees: degrees(before.world, after.world),
    sourceLocalDegrees: before.sourceLocal && after.sourceLocal ? degrees(before.sourceLocal, after.sourceLocal) : null,
    sourceWorldDegrees: before.sourceWorld && after.sourceWorld ? degrees(before.sourceWorld, after.sourceWorld) : null,
    jointDistance: before.position.distanceTo(after.position) };
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temporary, file);
}
async function main() {
  const args = new Map(process.argv.slice(2).map(argument => { const i = argument.indexOf('='); return [argument.slice(2, i < 0 ? undefined : i), i < 0 ? true : argument.slice(i + 1)]; }));
  const ids = args.has('actions') ? new Set(String(args.get('actions')).split(',').map(Number)) : null;
  const output = path.resolve(ROOT, String(args.get('checkpoint') ?? '.artifacts/doreumi-contact-audit/joints-report.json'));
  const stop = args.has('stop-file') ? path.resolve(String(args.get('stop-file'))) : null;
  const manifestBytes = fs.readFileSync(path.resolve(ROOT, String(args.get('manifest') ?? 'public/doreumi/motions/meshy-source-manifest.json')));
  const manifest = JSON.parse(manifestBytes), ledger = read(path.join(ROOT, '.artifacts/doreumi-meshy/ledger.json'));
  const contract = read(path.join(ROOT, 'public/doreumi/rig-contract.json')), names = contract.bones.map(bone => bone.name);
  const entries = manifest.motions.filter(entry => entry.retarget === 'converted' && (!ids || ids.has(entry.actionId)));
  if (ids) {
    const absent = [...ids].filter(id => !entries.some(entry => entry.actionId === id));
    if (absent.length) throw new Error(`Requested motions are unavailable: ${absent.join(',')}`);
  }
  const modelFile = path.resolve(ROOT, String(args.get('model-file') ?? 'public/doreumi/doreumi-master.glb'));
  const report = { version: 1, complete: false, modelFile, modelSha256: sha(fs.readFileSync(modelFile)),
    manifestSha256: sha(manifestBytes), fps: 60, method: 'Decode every local quaternion, compose actual world quaternion at 60 Hz, compare original source at identical times. Root and zero-length spacer joints retain target-only measurements when no direct source joint exists.',
    interpretation: 'Candidates require source/pose inspection. Large authored motion is not automatically a retarget defect. No automatic pass threshold or visual approval.',
    requestedIds: entries.map(entry => entry.actionId), completedIds: [], clips: [] };
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let cached;
  atomic(output, report);
  for (const entry of entries) {
    const sourceActionId = entry.derivation?.baseSourceActionId ?? entry.actionId;
    const batch = ledger.batches.find(batch => batch.actionIds.includes(sourceActionId) && batch.file);
    if (!batch) throw new Error(`Missing source for ${entry.actionId}`);
    if (cached?.id !== batch.id) {
      const bytes = fs.readFileSync(path.join(ROOT, '.artifacts/doreumi-meshy', batch.file));
      cached = { id: batch.id, sha256: sha(bytes), document: await io.readBinary(bytes) };
    }
    if (entry.sourceSha256 !== cached.sha256) throw new Error(`Source hash changed for ${entry.actionId}`);
    const source = sourceGraph(cached.document), animation = cached.document.getRoot().listAnimations()[batch.actionIds.indexOf(sourceActionId)];
    const channels = animation.listChannels().map(channel => samplerFor(channel, source));
    const bytes = fs.readFileSync(path.join(ROOT, 'public', entry.url)), clip = AnimationClip.parse(JSON.parse(bytes));
    if (entry.convertedSha256 !== sha(bytes)) throw new Error(`Clip hash changed for ${entry.actionId}`);
    const target = targetGraph(contract), tracks = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], interpolant: track.createInterpolant() }));
    const samples = [], transitionSamples = [];
    const sourceTimeScale = entry.retargetEvidence.sourceTimeScale ?? 1;
    if (!Number.isFinite(sourceTimeScale) || sourceTimeScale <= 0 || sourceTimeScale > 16) throw new Error('Invalid source playback clock');
    let previous;
    // Include authored entry and exit. Their source pose is clamped to the
    // endpoint and tagged, so transitions are not misreported as source motion.
    for (let index = 0; index <= Math.ceil(clip.duration * 60); index++) {
      const time = Math.min(clip.duration, index / 60), raw = (time - entry.retargetEvidence.entryDuration) * sourceTimeScale;
      const sourceTime = Math.max(0, Math.min(entry.retargetEvidence.sourceDuration, raw));
      const transition = raw < 0 || raw > entry.retargetEvidence.sourceDuration;
      for (const channel of channels) channel.node[{ rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.path]].fromArray(sampleChannel(channel, sourceTime));
      source.ordered.forEach(updateNode);
      for (const track of tracks) track.node[track.property].fromArray(track.interpolant.evaluate(time));
      target.ordered.forEach(updateNode);
      const current = { time, sourceTime, transition, bones: Object.fromEntries(names.map(name => {
        const node = target.byName.get(name), original = source.byName.get(SOURCE_MAP[name]);
        return [name, { local: node.quaternion.clone(), world: node.worldQuaternion.clone(), position: node.worldPosition.clone(),
          sourceLocal: original?.quaternion.clone(), sourceWorld: original?.worldQuaternion.clone() }];
      })) };
      if (previous) for (const bone of names) {
        const row = { bone, from: previous.time, time, sourceTime, ...measureJointStep(previous.bones[bone], current.bones[bone]) };
        (transition || previous.transition ? transitionSamples : samples).push(row);
      }
      previous = current;
    }
    const maximum = (values, key) => Object.fromEntries(names.map(name => [name, values.filter(row => row.bone === name).sort((a, b) => b[key] - a[key])[0] ?? null]));
    const introduced = key => samples.filter(row => row[`source${key}Degrees`] !== null).toSorted((a, b) =>
      (b[`target${key}Degrees`] - b[`source${key}Degrees`]) - (a[`target${key}Degrees`] - a[`source${key}Degrees`])).slice(0, 20);
    const row = { actionId: entry.actionId, sourceActionId, sourceName: entry.sourceName, clipSha256: sha(bytes), sourceSha256: cached.sha256, sourceTimeScale,
      localMaxima: maximum(samples, 'targetLocalDegrees'), worldMaxima: maximum(samples, 'targetWorldDegrees'),
      transitionLocalMaxima: maximum(transitionSamples, 'targetLocalDegrees'), transitionWorldMaxima: maximum(transitionSamples, 'targetWorldDegrees'),
      largestIntroducedLocal: introduced('Local'), largestIntroducedWorld: introduced('World'),
      ...(args.has('samples') ? { samples, transitionSamples } : {}) };
    report.clips.push(row); report.completedIds.push(entry.actionId); atomic(output, report);
    console.log(JSON.stringify({ actionId: entry.actionId, clipSha256: row.clipSha256, largestIntroducedLocal: row.largestIntroducedLocal[0], largestIntroducedWorld: row.largestIntroducedWorld[0] }));
    if (stop && fs.existsSync(stop)) { report.stoppedAtBoundary = entry.actionId; atomic(output, report); process.exitCode = 2; return; }
  }
  report.complete = true; atomic(output, report);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
