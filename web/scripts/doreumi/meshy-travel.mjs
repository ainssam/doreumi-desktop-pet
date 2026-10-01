#!/usr/bin/env node
/** Metadata-only stage travel from the final, unmodified short-leg target clips. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationClip, Vector3 } from 'three';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { motionSemantics } from './meshy-adaptation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function compactTravel(times, positions) {
  const compactTimes = [], compactPositions = [];
  times.forEach((rawTime, index) => {
    const time = +rawTime.toFixed(6), position = positions[index].map(value => +value.toFixed(6));
    if (time === compactTimes.at(-1)) compactPositions[compactPositions.length - 1] = position;
    else {
      if (time < (compactTimes.at(-1) ?? -Infinity)) throw new Error('Travel sample time moved backwards.');
      compactTimes.push(time); compactPositions.push(position);
    }
  });
  return { times: compactTimes, positionsXZ: compactPositions };
}

export function integrateStance(samples, direction = [0, 1], suggestedSpeed = .32) {
  const firstSide = samples[0].L[1] <= samples[0].R[1] ? 'L' : 'R';
  let stance = samples[0][firstSide][1] <= .12 ? firstSide : null;
  const positions = [[0, 0]], contacts = [stance ?? 'airborne'];
  let velocity = [direction[0] * suggestedSpeed, direction[1] * suggestedSpeed];
  let maxSupportSlide = 0, maxStageSpeed = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1], current = samples[index], dt = current.time - previous.time;
    const lowest = current.L[1] <= current.R[1] ? 'L' : 'R';
    let nextStance = stance;
    if (current[lowest][1] > .12) nextStance = null;
    else if (!stance || current[stance][1] > current[lowest][1] + .035) nextStance = lowest;
    let delta = [0, 0];
    if (nextStance && nextStance === stance) {
      delta = [previous[nextStance][0] - current[nextStance][0], previous[nextStance][2] - current[nextStance][2]];
      // Preserve the stance exactly. A host speed limit must slow animation time
      // and travel together, rather than clipping displacement and sliding feet.
      velocity = delta.map(value => value / dt);
      maxSupportSlide = Math.max(maxSupportSlide, Math.hypot(previous[nextStance][0] - current[nextStance][0] - delta[0], previous[nextStance][2] - current[nextStance][2] - delta[1]));
    } else if (!nextStance) delta = velocity.map(value => value * dt);
    maxStageSpeed = Math.max(maxStageSpeed, Math.hypot(...delta) / dt);
    positions.push([positions.at(-1)[0] + delta[0], positions.at(-1)[1] + delta[1]]);
    contacts.push(nextStance ?? 'airborne'); stance = nextStance;
  }
  return { positions, contacts, maxSupportSlide, maxStageSpeed };
}

export function bakeTravel(clip, evidence, contract) {
  const target = targetGraph(contract), samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const entry = evidence.entryDuration, sourceDuration = evidence.sourceDuration, count = Math.ceil(sourceDuration * 30);
  const footDepth = contract.runtimeRootTranslation[1] + new Vector3().setFromMatrixPosition({ elements: contract.bones.find(bone => bone.name === 'footL').restWorldMatrix }).y;
  const samples = Array.from({ length: count + 1 }, (_, index) => {
    const time = entry + Math.min(index / 30, sourceDuration);
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(time));
    target.ordered.forEach(updateNode);
    const feet = Object.fromEntries(['L', 'R'].map(side => {
      const foot = target.byName.get(`foot${side}`);
      return [side, new Vector3(0, -footDepth, 0).applyQuaternion(foot.worldQuaternion).add(foot.worldPosition).toArray()];
    }));
    return { time, ...feet };
  });
  const integrated = integrateStance(samples, evidence.semantics.travelDirection, evidence.semantics.suggestedStageSpeed);
  const displacement = integrated.positions.at(-1), distance = Math.hypot(...displacement);
  const compact = compactTravel([0, ...samples.map(sample => sample.time), clip.duration], [[0, 0], ...integrated.positions, integrated.positions.at(-1)]);
  return { version: 1, source: 'target-stance', ...compact,
    direction: distance > .001 ? displacement.map(value => value / distance) : evidence.semantics.travelDirection,
    maxSampledSupportSlide: integrated.maxSupportSlide, maxStageSpeed: integrated.maxStageSpeed, contactProbe: 'target-foot-sole',
    contactSamples: { left: integrated.contacts.filter(side => side === 'L').length, right: integrated.contacts.filter(side => side === 'R').length,
      airborne: integrated.contacts.filter(side => side === 'airborne').length },
    entryExitTravel: 'stationary', airborneTravel: 'last-support-velocity' };
}

async function main() {
  const file = path.join(ROOT, 'public/doreumi/motions/meshy-source-manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/doreumi/rig-contract.json'), 'utf8'));
  let locomotion = 0;
  for (const item of manifest.motions) {
    const evidence = item.retargetEvidence;
    if (item.retarget !== 'converted') throw new Error('All target clips must be converted before metadata finalization.');
    const displacement = evidence.semantics.sourceRootDisplacementXZ;
    const semantics = motionSemantics(item, [[0, 0, 0], [displacement[0], 0, displacement[1]]], evidence.sourceDuration, evidence.legRatio);
    Object.assign(evidence.semantics, { requiresProps: semantics.requiresProps, contextAudit: semantics.contextAudit, kind: semantics.kind, suggestedStageSpeed: semantics.suggestedStageSpeed });
    if ([43, 635].includes(item.actionId)) evidence.semanticCorrection = {
      reason: 'Handbag walk is cataloged under Acting but requires a bag and stance-derived stage travel.',
      supersedesPropFreeVisualEvidence: true, clipChanged: false,
    };
    if (evidence.semantics.kind === 'locomotion') {
      const clip = AnimationClip.parse(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', item.url), 'utf8')));
      evidence.semantics.travel = bakeTravel(clip, evidence, contract); locomotion++;
    }
  }
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(`${file}.tmp-${process.pid}`, JSON.stringify(manifest, null, 2) + '\n'); fs.renameSync(`${file}.tmp-${process.pid}`, file);
  console.log(JSON.stringify({ event: 'metadata_finalized', clips: manifest.motions.length, targetStanceCurves: locomotion, clipFilesChanged: 0 }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
