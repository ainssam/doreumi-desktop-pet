#!/usr/bin/env node
/** Offline actual-skin contact audit. Numeric evidence is not visual approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationClip, Box3, Vector3 } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';
import { createSourceSupport } from './meshy-master-support.mjs';
import { parseDoreumiTravel, sampleDoreumiTravel } from '../../src/lib/doreumi/motion-travel.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
function atomic(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, file);
}
function poseSource(graph, channels, time) {
  for (const channel of channels) channel.node[{ translation: 'position', rotation: 'quaternion', scale: 'scale' }[channel.path]].fromArray(sampleChannel(channel, time));
  graph.ordered.forEach(updateNode);
}
function materialPair(before, after, floor, tolerance) {
  let count = 0, minimum = Infinity, maximum = 0;
  for (let index = 0; index < before.length; index++) {
    const a = before[index], b = after[index];
    if (Math.abs(a[1] - floor) > tolerance || Math.abs(b[1] - floor) > tolerance) continue;
    const drift = Math.hypot(b[0] - a[0], b[2] - a[2]);
    minimum = Math.min(minimum, drift); maximum = Math.max(maximum, drift); count++;
  }
  return { count, minimum, maximum };
}
export function auditContactSamples({ times, sourceFeet, targetFeet, sourceFloor, sourceHeight, targetHeight,
  targetFloor = .002, targetTolerance = .04, maximumSourceDriftByHeight = .002, maximumTargetDriftByHeight = .01, targetTimeScale = 1 }) {
  if (!Number.isFinite(targetTimeScale) || targetTimeScale <= 0 || targetTimeScale > 16) throw new Error('Invalid target contact clock');
  const sourceTolerance = targetTolerance * sourceHeight / targetHeight;
  const failures = [];
  let sourcePlantedPairs = 0, missingTargetContactPairs = 0, excessiveDriftPairs = 0, pivotCompatiblePairs = 0, sourceMovingContactPairs = 0, maxDriftByHeight = 0;
  for (let index = 1; index < times.length; index++) for (const side of ['L', 'R']) {
    const source = materialPair(sourceFeet[index - 1][side], sourceFeet[index][side], sourceFloor, sourceTolerance);
    if (source.count < 3) continue;
    if (source.minimum / sourceHeight > maximumSourceDriftByHeight) { sourceMovingContactPairs++; continue; }
    sourcePlantedPairs++;
    const target = materialPair(targetFeet[index - 1][side], targetFeet[index][side], targetFloor, targetTolerance);
    // Source samples remain at 30 Hz to retain their original support phases.
    // A retimed clip is sampled more often in real playback seconds: compare
    // its displacement as equivalent 30 Hz speed, not the smaller raw interval.
    const missing = target.count < 3, driftByHeight = missing ? null : target.minimum / targetHeight * targetTimeScale;
    if (missing) missingTargetContactPairs++;
    else {
      maxDriftByHeight = Math.max(maxDriftByHeight, driftByHeight);
      if (driftByHeight > maximumTargetDriftByHeight) excessiveDriftPairs++;
      // A stationary point with movement elsewhere is compatible with a pivot
      // or heel/toe roll. Do not classify the whole patch's maximum as sliding.
      if (driftByHeight < .002 && target.maximum / targetHeight * targetTimeScale > maximumTargetDriftByHeight) pivotCompatiblePairs++;
    }
    if (missing || driftByHeight > maximumTargetDriftByHeight) failures.push({ side, from: times[index - 1], time: times[index],
      missing, driftByHeight, sourceDriftByHeight: source.minimum / sourceHeight,
      previousMinY: Math.min(...targetFeet[index - 1][side].map(point => point[1])), minY: Math.min(...targetFeet[index][side].map(point => point[1])) });
  }
  return { sourcePlantedPairs, missingTargetContactPairs, excessiveDriftPairs, sourceMovingContactPairs, pivotCompatiblePairs, maxDriftByHeight, failures };
}

async function main() {
  const args = new Map(process.argv.slice(2).map(argument => { const index = argument.indexOf('='); return [argument.slice(2, index < 0 ? undefined : index), index < 0 ? true : argument.slice(index + 1)]; }));
  const requested = args.has('actions') ? new Set(String(args.get('actions')).split(',').map(Number)) : null;
  const excluded = new Set(String(args.get('exclude') ?? '').split(',').filter(Boolean).map(Number));
  const output = path.resolve(ROOT, String(args.get('checkpoint') ?? '.artifacts/doreumi-contact-audit/stationary-report.json'));
  const stop = args.has('stop-file') ? path.resolve(String(args.get('stop-file'))) : null;
  const manifestFile = path.resolve(ROOT, String(args.get('manifest') ?? 'public/doreumi/motions/meshy-source-manifest.json'));
  const manifestBytes = fs.readFileSync(manifestFile), manifest = JSON.parse(manifestBytes), ledger = read(path.join(ROOT, '.artifacts/doreumi-meshy/ledger.json'));
  const contract = read(path.join(ROOT, 'public/doreumi/rig-contract.json'));
  const modelFile = path.resolve(ROOT, String(args.get('model-file') ?? 'public/doreumi/doreumi-master.glb'));
  const clipDirectory = args.has('clip-dir') ? path.resolve(ROOT, String(args.get('clip-dir'))) : null;
  const modelBytes = fs.readFileSync(modelFile);
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const master = await io.readBinary(modelBytes), targetSampler = createPlanarFootSampler(master, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const measuredMaster = await loadDoreumiAsset(modelFile);
  const targetHeight = new Box3().setFromObject(measuredMaster.scene).getSize(new Vector3()).y;
  if (!(targetHeight > 0)) throw new Error('Invalid target height');
  const neutralDocument = await io.read(path.join(ROOT, '.artifacts/doreumi-meshy/raw/batch-000.glb'));
  const neutral = sourceGraph(neutralDocument), neutralAnimation = neutralDocument.getRoot().listAnimations()[0];
  poseSource(neutral, neutralAnimation.listChannels().map(channel => samplerFor(channel, neutral)), 0);
  const neutralBounds = createSourceSupport(neutralDocument).measure(neutral, true), sourceHeight = neutralBounds.maxY - neutralBounds.minY;
  const entries = manifest.motions.filter(entry => entry.retarget === 'converted' && !excluded.has(entry.actionId) && (requested ? requested.has(entry.actionId)
    : entry.retargetEvidence?.semantics?.kind === 'stationary' && !entry.retargetEvidence?.semantics?.requiresProps?.length));
  if (requested) {
    const absent = [...requested].filter(id => !entries.some(entry => entry.actionId === id));
    if (absent.length) throw new Error(`Requested motions are unavailable: ${absent.join(',')}`);
  }
  const report = { version: 1, complete: false, modelFile, modelSha256: sha(modelBytes), manifestSha256: sha(manifestBytes),
    method: { fps: 30, actualSkin: 'glTF inverse-bind linear skinning; neutral target morph=1; physical vertex identity preserved',
      sourceHeight, targetHeight, sourceFloor: 'p10 foot surface minimum', sourceTolerance: .04 * sourceHeight / targetHeight,
      targetFloor: .002, targetTolerance: .04, sourceMaximumDriftByHeight: .002, targetMaximumDriftByHeight: .01,
      caveat: 'Numeric contact audit, not visual approval. Source moving patches are retained separately, not foot-locked.' },
    requestedIds: entries.map(entry => entry.actionId), completedIds: [], clips: [] };
  atomic(output, report);
  let cachedBatch;
  for (const entry of entries) {
    const sourceActionId = entry.derivation?.baseSourceActionId ?? entry.actionId;
    const batch = ledger.batches.find(batch => batch.actionIds.includes(sourceActionId) && batch.file);
    if (!batch) throw new Error(`Missing source batch for ${entry.actionId}`);
    if (cachedBatch?.id !== batch.id) {
      const bytes = fs.readFileSync(path.join(ROOT, '.artifacts/doreumi-meshy', batch.file)), document = await io.readBinary(bytes);
      cachedBatch = { id: batch.id, document, sha256: sha(bytes), sampler: createPlanarFootSampler(document, { L: ['LeftFoot', 'LeftToeBase'], R: ['RightFoot', 'RightToeBase'] }) };
    }
    if (entry.sourceSha256 !== cachedBatch.sha256) throw new Error(`Source hash changed for ${entry.actionId}`);
    const graph = sourceGraph(cachedBatch.document), animation = cachedBatch.document.getRoot().listAnimations()[batch.actionIds.indexOf(sourceActionId)];
    const channels = animation.listChannels().map(channel => samplerFor(channel, graph));
    const clipFile = clipDirectory ? path.join(clipDirectory, path.basename(entry.url)) : path.join(ROOT, 'public', entry.url);
    const clipBytes = fs.readFileSync(clipFile), clip = AnimationClip.parse(JSON.parse(clipBytes));
    if (entry.convertedSha256 !== sha(clipBytes)) throw new Error(`Clip hash changed for ${entry.actionId}`);
    const target = targetGraph(contract), tracks = clip.tracks.map(track => ({ track, interpolant: track.createInterpolant(),
      node: target.byName.get(track.name.slice(0, track.name.lastIndexOf('.'))), property: track.name.slice(track.name.lastIndexOf('.') + 1) }));
    const times = [], sourceFeet = [], targetFeet = [], duration = entry.retargetEvidence.sourceDuration;
    const sourceTimeScale = entry.retargetEvidence.sourceTimeScale ?? 1;
    if (!Number.isFinite(sourceTimeScale) || sourceTimeScale <= 0 || sourceTimeScale > 16) throw new Error('Invalid source playback clock');
    const travel = parseDoreumiTravel(entry.retargetEvidence.semantics?.travel, clip.duration);
    for (let index = 0; index <= Math.ceil(duration * 30); index++) {
      const time = Math.min(duration, index / 30);
      poseSource(graph, channels, time); sourceFeet.push(cachedBatch.sampler.sample(graph));
      for (const { node, property, interpolant } of tracks) { if (!node) throw new Error('Unknown target track'); node[property].fromArray(interpolant.evaluate(time / sourceTimeScale + entry.retargetEvidence.entryDuration)); }
      target.ordered.forEach(updateNode);
      const feet = targetSampler.sample(target);
      if (travel) {
        const delta = sampleDoreumiTravel(travel, time / sourceTimeScale + entry.retargetEvidence.entryDuration);
        for (const side of ['L', 'R']) for (const point of feet[side]) { point[0] += delta[0]; point[2] += delta[1]; }
      }
      targetFeet.push(feet); times.push(time);
    }
    const floor = travel?.contactEvidence?.sourceFloor ?? quantile(sourceFeet.map(frame => Math.min(...frame.L.map(point => point[1]), ...frame.R.map(point => point[1]))), .1);
    const result = auditContactSamples({ times, sourceFeet, targetFeet, sourceFloor: floor, sourceHeight, targetHeight, targetTimeScale: sourceTimeScale });
    const row = { actionId: entry.actionId, sourceActionId, derivation: entry.derivation?.type ?? null, sourceName: entry.sourceName, sourceSha256: cachedBatch.sha256, clipFile, clipSha256: sha(clipBytes),
      sourceTimeScale, sourceSamplingHz: 30, targetSamplingHz: 30 * sourceTimeScale, targetDriftBasis: 'equivalent-30Hz-displacement-by-height', sourceFloor: floor, ...result };
    report.clips.push(row); report.completedIds.push(entry.actionId); atomic(output, report);
    console.log(JSON.stringify({ ...row, failures: undefined }));
    if (stop && fs.existsSync(stop)) { report.stoppedAtBoundary = entry.actionId; atomic(output, report); process.exitCode = 2; return; }
  }
  report.complete = true; atomic(output, report);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
