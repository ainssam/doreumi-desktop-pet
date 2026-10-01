#!/usr/bin/env node
/** Offline, geometry-free Meshy to Doreumi conversion. No API access or visual approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, Matrix4, Quaternion, Vector3 } from 'three';
import { SOURCE_MAP, validateSource } from './meshy-validate-source.mjs';
import { createMasterSupport, createSourceSupport } from './meshy-master-support.mjs';
import { adaptContact, motionSemantics, solveHand } from './meshy-adaptation.mjs';
import { adaptHeart } from './meshy-heart.mjs';
import { adaptPropContact } from './meshy-prop-contact.mjs';
import { adaptHandRub } from './meshy-hand-rub.mjs';
import { adaptCup } from './meshy-cup.mjs';
import { FLOOR_TRANSITION_ACTIONS, floorAirbornePolicy, adaptFloorAirborne, createFloorTransitionLibrary, adaptFloorTransitions } from './meshy-transition.mjs';
import { adaptStomp } from './meshy-stomp.mjs';
import { FLOOR_ACROBATIC_ACTIONS, adaptFloorAcrobatics, sourcePalmSupport } from './meshy-floor-acrobatics.mjs';
import { loadAcrobaticsContract, validateAcrobaticsOutput } from './meshy-acrobatics-contract.mjs';
import { adaptAirborneFall } from './meshy-airborne-fall.mjs';
import { limitRestQuaternion } from './meshy-quaternion-limit.mjs';
import { adaptClap } from './meshy-clap.mjs';
import { loadReviewedContactPlan } from './meshy-reviewed-contact.mjs';
import { splitReviewedStageSupport } from './meshy-stage-support.mjs';
import { sourceTailSampleTime, sourceTailEvidence } from './meshy-source-tail.mjs';
import { buildTrackedCamera } from './meshy-camera.mjs';
import { PLANAR_SUPPORT_ACTIONS, createPlanarFootSampler, solveStationaryPlanarSupport, envelopePlanarSupport, createStationaryFootContactAdapter, retargetSourceLegPose } from './meshy-planar-support.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.artifacts/doreumi-meshy');
const PUBLIC = path.join(ROOT, 'public/doreumi/motions');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const VERSION = 3;
const FPS = 30;
const RAD = Math.PI / 180;
// Limits are relative to Doreumi's own bind, preserving its short limbs and head.
export const DOREUMI_JOINT_LIMITS = Object.freeze({ torso: 65, head: 80, shoulderL: 105, shoulderR: 105, armL: 175, armR: 175,
  elbowL: 165, elbowR: 165, wristL: 105, wristR: 105, thighL: 150, thighR: 150,
  kneeL: 155, kneeR: 155, footL: 100, footR: 100 });
const LIMITS = DOREUMI_JOINT_LIMITS;
// Roll out measured branch corrections independently of previously reviewed
// clips. The full raw-source limit audit determines additional affected IDs.
const TEMPORAL_LIMIT_ACTIONS = new Set([500]);

function atomicJson(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
  fs.renameSync(temp, file);
}

function orderGraph(nodes) {
  const ordered = [], visited = new Set(), visiting = new Set();
  const visit = node => {
    if (visited.has(node)) return;
    if (visiting.has(node)) throw new Error('Skeleton cycle.');
    visiting.add(node); if (node.parent) visit(node.parent);
    visiting.delete(node); visited.add(node); ordered.push(node);
  };
  nodes.forEach(visit); return ordered;
}

function poseNode(name, position, quaternion, scale) {
  return { name, position: new Vector3().fromArray(position), quaternion: new Quaternion().fromArray(quaternion),
    scale: new Vector3().fromArray(scale), worldPosition: new Vector3(), worldQuaternion: new Quaternion(), worldScale: new Vector3() };
}

export function updateNode(node) {
  if (!node.parent) {
    node.worldPosition.copy(node.position); node.worldQuaternion.copy(node.quaternion); node.worldScale.copy(node.scale);
  } else {
    node.worldPosition.copy(node.position).multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);
    node.worldQuaternion.multiplyQuaternions(node.parent.worldQuaternion, node.quaternion).normalize();
    node.worldScale.copy(node.parent.worldScale).multiply(node.scale);
  }
}

export function restDeltaQuaternion(sourceWorld, sourceRest, targetRest, alignment = new Quaternion()) {
  return alignment.clone().multiply(sourceWorld).multiply(sourceRest.clone().invert())
    .multiply(alignment.clone().invert()).multiply(targetRest).normalize();
}

export function localFromWorld(world, parentWorld) {
  return (parentWorld ? parentWorld.clone().invert() : new Quaternion()).multiply(world).normalize();
}

export function sourceGraph(document) {
  const nodes = document.getRoot().listNodes();
  const byNode = new Map(nodes.map(node => [node, poseNode(node.getName(), node.getTranslation(), node.getRotation(), node.getScale())]));
  for (const [node, pose] of byNode) pose.parent = byNode.get(node.getParentNode());
  const ordered = orderGraph([...byNode.values()]); ordered.forEach(updateNode);
  for (const pose of ordered) { pose.restWorldQuaternion = pose.worldQuaternion.clone(); pose.restWorldPosition = pose.worldPosition.clone(); }
  return { ordered, byNode, byName: new Map(ordered.map(node => [node.name, node])) };
}

export function targetGraph(contract) {
  if (contract.up !== '+Y' || contract.forward !== '+Z') throw new Error('Unsupported master coordinate system.');
  const byName = new Map(contract.bones.map(bone => [bone.name, poseNode(bone.name, bone.restLocalPosition, bone.restLocalQuaternion, bone.restLocalScale)]));
  for (const bone of contract.bones) {
    const pose = byName.get(bone.name); pose.parent = byName.get(bone.parent);
    pose.restLocalQuaternion = pose.quaternion.clone();
    pose.restWorldQuaternion = new Quaternion();
    new Matrix4().fromArray(bone.restWorldMatrix).decompose(new Vector3(), pose.restWorldQuaternion, new Vector3());
  }
  for (const name of ['DoreumiRig', ...Object.keys(SOURCE_MAP)]) if (!byName.has(name)) throw new Error(`Missing target bone ${name}.`);
  const ordered = orderGraph([...byName.values()]); ordered.forEach(updateNode);
  return { ordered, byName };
}

export function samplerFor(channel, graph) {
  const sampler = channel.getSampler(), size = sampler.getOutput().getElementSize();
  return { node: graph.byNode.get(channel.getTargetNode()), path: channel.getTargetPath(),
    times: sampler.getInput().getArray(), values: sampler.getOutput().getArray(),
    interpolation: sampler.getInterpolation(), size, cursor: 0 };
}

export function sampleChannel(channel, time) {
  const { times, values, size, interpolation } = channel;
  while (channel.cursor + 1 < times.length && times[channel.cursor + 1] <= time) channel.cursor++;
  while (channel.cursor > 0 && times[channel.cursor] > time) channel.cursor--;
  const a = channel.cursor, b = Math.min(a + 1, times.length - 1);
  const span = times[b] - times[a];
  const t = span > 0 ? Math.max(0, Math.min(1, (time - times[a]) / span)) : 0;
  const result = new Array(size);
  if (interpolation === 'CUBICSPLINE') {
    const t2 = t * t, t3 = t2 * t;
    for (let i = 0; i < size; i++) result[i] = (2 * t3 - 3 * t2 + 1) * values[a * size * 3 + size + i]
      + (t3 - 2 * t2 + t) * span * values[a * size * 3 + size * 2 + i]
      + (-2 * t3 + 3 * t2) * values[b * size * 3 + size + i]
      + (t3 - t2) * span * values[b * size * 3 + i];
  } else if (interpolation === 'STEP' || a === b) {
    for (let i = 0; i < size; i++) result[i] = values[a * size + i];
  } else if (channel.path === 'rotation') {
    return new Quaternion().fromArray(values, a * size).slerp(new Quaternion().fromArray(values, b * size), t).normalize().toArray();
  } else for (let i = 0; i < size; i++) result[i] = values[a * size + i] * (1 - t) + values[b * size + i] * t;
  return channel.path === 'rotation' ? new Quaternion().fromArray(result).normalize().toArray() : result;
}

export function decimateTrack(times, values, size, tolerance, quaternion = false) {
  const keep = new Set([0, times.length - 1]), stack = [[0, times.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop(); let worst = tolerance, split = -1;
    const q0 = quaternion ? new Quaternion().fromArray(values, first * size) : null;
    const q1 = quaternion ? new Quaternion().fromArray(values, last * size) : null;
    for (let index = first + 1; index < last; index++) {
      const t = (times[index] - times[first]) / (times[last] - times[first]);
      const error = quaternion ? q0.clone().slerp(q1, t).angleTo(new Quaternion().fromArray(values, index * size))
        : Math.hypot(...Array.from({ length: size }, (_, c) => values[index * size + c] - (values[first * size + c] * (1 - t) + values[last * size + c] * t)));
      if (error > worst) { worst = error; split = index; }
    }
    if (split >= 0) { keep.add(split); stack.push([first, split], [split, last]); }
  }
  const indices = [...keep].sort((a, b) => a - b);
  return { times: indices.map(index => times[index]), values: indices.flatMap(index => values.slice(index * size, index * size + size)) };
}

export function serializeClip(clip) {
  const json = AnimationClip.toJSON(clip); delete json.uuid;
  for (const track of json.tracks) {
    const size = track.values.length / track.times.length, times = [], values = [];
    for (let index = 0; index < track.times.length; index++) {
      const time = +track.times[index].toFixed(6), sample = track.values.slice(index * size, (index + 1) * size).map(value => +value.toFixed(7));
      // A shifted source boundary can coincide with an exit key after JSON
      // rounding or Float32 decoding. Keep its last pose and strict time order.
      if (times.length && Math.fround(time) === Math.fround(times.at(-1))) values.splice(values.length - size, size, ...sample);
      else { times.push(time); values.push(...sample); }
    }
    track.times = times; track.values = values;
  }
  // AnimationClip.parse assigns json.uuid verbatim; absent UUIDs alias the mixer cache.
  const uuid = sha(JSON.stringify(json)).slice(0, 32);
  json.uuid = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
  return json;
}

// Candidate-only virtual travel may be split into host movement before publication.
// Runtime clips still require their separately validated 2-unit support bound.
export function resolveVirtualRootBound(value = 2) {
  if (!Number.isFinite(value) || value <= 0 || value > 12) throw new Error('Offline virtualRootBound must be finite, positive, and at most 12 units.');
  return value;
}

export function retargetAnimation(document, animation, actionId, contract, support, sourceSupport, metadata, planarSamplers) {
  if (!support || !sourceSupport) throw new Error('Source and target skin support envelopes are required.');
  const virtualRootBound = resolveVirtualRootBound(planarSamplers?.virtualRootBound);
  const source = sourceGraph(document), target = targetGraph(contract);
  const sourceRestFloor = sourceSupport.measure(source), sourceFootMinima = [];
  const actionMetadata = metadata ?? { actionId, sourceName: animation.getName(), sourceCategory: '', sourceSubCategory: '' };
  const needsFootAirborne = floorAirbornePolicy(actionMetadata) === 'bilateral-foot-lift';
  const channels = animation.listChannels().map(channel => samplerFor(channel, source));
  const sourceDuration = Math.max(...channels.map(channel => channel.times.at(-1)));
  const count = Math.ceil(sourceDuration * FPS) + 1;
  const sourceTimes = Array.from({ length: count }, (_, index) => Math.min(index / FPS, sourceDuration));
  const sourceRotations = new Map(Object.keys(SOURCE_MAP).map(name => [name, []]));
  const previous = new Map(), limitLogs = new Map(), rootValues = [], limitsApplied = {}, sourceSupports = [], trajectory = [];
  const planar = PLANAR_SUPPORT_ACTIONS.has(actionId), sourceFeet = [], targetFeet = [], sourceLegFrames = [];
  if (planar && !planarSamplers) throw new Error('Source and master skin samplers are required for stationary planar support.');
  let contactFrames = 0, maxContactReachClamp = 0;
  const targetFootRest = Math.min(target.byName.get('footL').worldPosition.y, target.byName.get('footR').worldPosition.y);
  const sourceHip = source.byName.get('Hips'), sourceFoot = source.byName.get('LeftFoot');
  const targetLegLength = target.byName.get('body').worldPosition.y - targetFootRest;
  const legRatio = targetLegLength / (sourceHip.restWorldPosition.y - sourceFoot.restWorldPosition.y);
  if (!(legRatio > 0 && legRatio < 2)) throw new Error('Invalid body scale contract.');
  for (const time of sourceTimes) {
    const sampledSourceTime = sourceTailSampleTime(actionMetadata, time, sourceDuration);
    for (const channel of channels) {
      const value = sampleChannel(channel, sampledSourceTime);
      channel.node[channel.path === 'translation' ? 'position' : channel.path === 'rotation' ? 'quaternion' : 'scale'].fromArray(value);
    }
    source.ordered.forEach(updateNode);
    for (const node of target.ordered) {
      const sourceName = SOURCE_MAP[node.name];
      if (sourceName) {
        const from = source.byName.get(sourceName);
        const world = restDeltaQuaternion(from.worldQuaternion, from.restWorldQuaternion, node.restWorldQuaternion);
        node.quaternion.copy(localFromWorld(world, node.parent?.worldQuaternion));
        const limit = LIMITS[node.name], angle = node.restLocalQuaternion.angleTo(node.quaternion);
        if (limit && TEMPORAL_LIMIT_ACTIONS.has(actionId)) {
          const limited = limitRestQuaternion(node.restLocalQuaternion, node.quaternion, limit * RAD, limitLogs.get(node.name));
          limitLogs.set(node.name, limited.log); node.quaternion.copy(limited.quaternion);
          if (limited.limited) limitsApplied[node.name] = (limitsApplied[node.name] ?? 0) + 1;
        } else if (limit && angle > limit * RAD) {
          node.quaternion.copy(node.restLocalQuaternion.clone().slerp(node.quaternion, limit * RAD / angle));
          limitsApplied[node.name] = (limitsApplied[node.name] ?? 0) + 1;
        }
      }
      updateNode(node);
    }
    const contact = adaptContact(target, source, animation.getName(), () => target.ordered.forEach(updateNode), { sourceTime: time, ...(actionId === 318 ? { forceHandWeight: 1 } : {}) });
    const heart = adaptHeart(target, metadata ?? { actionId, sourceName: animation.getName() }, time, sourceDuration, () => target.ordered.forEach(updateNode), solveHand);
    const propContact = adaptPropContact(target, metadata ?? { actionId, sourceName: animation.getName() }, time, sourceDuration, () => target.ordered.forEach(updateNode), solveHand);
    const handRub = adaptHandRub(target, source, metadata ?? { actionId }, () => target.ordered.forEach(updateNode), solveHand, planarSamplers?.handSampler);
    const clap = adaptClap(target, source, actionMetadata, time, () => target.ordered.forEach(updateNode), solveHand, planarSamplers?.handSampler);
    const cup = adaptCup(target, metadata ?? { actionId }, time, () => target.ordered.forEach(updateNode), solveHand);
    const stomp = adaptStomp(target, actionMetadata, time, sourceDuration, () => target.ordered.forEach(updateNode), planarSamplers?.targetSampler);
    planarSamplers?.adaptPhoneContact?.(target, source, () => target.ordered.forEach(updateNode), { actionId, time, sourceDuration });
    if (planar) planarSamplers?.adaptSourceLegs?.(target, source, legRatio, () => target.ordered.forEach(updateNode), { actionId, time });
    if (contact.active || heart.active || propContact.active || handRub.active || clap.active || cup.active || stomp.active) contactFrames++;
    maxContactReachClamp = Math.max(maxContactReachClamp, contact.maxReachClamp, heart.maxReachClamp, propContact.maxReachClamp, handRub.maxReachClamp, clap.maxReachClamp, cup.maxReachClamp, stomp.maxReachClamp);
    for (const name of sourceRotations.keys()) {
      const node = target.byName.get(name), last = previous.get(name);
      if (last && node.quaternion.dot(last) < 0) node.quaternion.set(-node.quaternion.x, -node.quaternion.y, -node.quaternion.z, -node.quaternion.w);
      previous.set(name, node.quaternion.clone()); sourceRotations.get(name).push(...node.quaternion.toArray());
    }
    sourceSupports.push(sourceSupport.measure(source));
    trajectory.push(source.byName.get('Hips').worldPosition.toArray());
    if (planar || needsFootAirborne) {
      const feet = planarSamplers.sourceSampler.sample(source);
      if (planar) {
        sourceFeet.push(feet);
        sourceLegFrames.push(Object.fromEntries(['L', 'R'].map(side => {
          const prefix = side === 'L' ? 'Left' : 'Right';
          return [side, { hip: source.byName.get(`${prefix}UpLeg`).worldPosition.toArray(), knee: source.byName.get(`${prefix}Leg`).worldPosition.toArray(), foot: source.byName.get(`${prefix}Foot`).worldPosition.toArray() }];
        })));
      }
      if (needsFootAirborne) sourceFootMinima.push(['L', 'R'].map(side => Math.min(...feet[side].map(point => point[1]))));
    }
  }
  // Both envelopes include torso, head and hands, so lying/crawling are grounded too.
  const sortedSupports = [...sourceSupports].sort((a, b) => a - b);
  const sourceContact = sortedSupports[Math.floor(sortedSupports.length * 0.1)];
  const airborneAdjustment = adaptFloorAirborne(actionMetadata,
    sourceSupports.map(height => Math.max(0, height - sourceContact - 0.008) * legRatio), sourceFootMinima, legRatio,
    { heights: sourceSupports, restFloor: sourceRestFloor });
  const sourceAirborne = airborneAdjustment.values;
  const rotationDistance = last => Math.max(...[...sourceRotations].map(([name, values]) =>
    support.idleRotations.get(name).angleTo(new Quaternion().fromArray(values, last ? values.length - 4 : 0))));
  const entryFrames = Math.ceil(Math.max(.7, rotationDistance(false) / 2.5) * FPS);
  const exitFrames = Math.ceil(Math.max(.85, rotationDistance(true) / 2.2) * FPS);
  const entryDuration = entryFrames / FPS, exitDuration = exitFrames / FPS;
  const duration = entryDuration + sourceDuration + exitDuration;
  const times = [...Array.from({ length: entryFrames }, (_, i) => i / FPS),
    ...sourceTimes.map(time => time + entryDuration),
    ...Array.from({ length: exitFrames }, (_, i) => entryDuration + sourceDuration + (i + 1) / FPS)];
  const ease = value => value * value * (3 - 2 * value);
  const rotations = new Map([...sourceRotations].map(([name, values]) => {
    const idle = support.idleRotations.get(name), first = new Quaternion().fromArray(values), last = new Quaternion().fromArray(values, values.length - 4);
    const output = [...Array.from({ length: entryFrames }, (_, i) => idle.clone().slerp(first, ease(i / entryFrames)).toArray()).flat(),
      ...values, ...Array.from({ length: exitFrames }, (_, i) => last.clone().slerp(idle, ease((i + 1) / exitFrames)).toArray()).flat()];
    // Keep all quaternion components on one hemisphere before key reduction.
    for (let i = 4; i < output.length; i += 4) if (new Quaternion().fromArray(output, i - 4).dot(new Quaternion().fromArray(output, i)) < 0) for (let c = 0; c < 4; c++) output[i + c] *= -1;
    return [name, output];
  }));
  const airborne = [...Array.from({ length: entryFrames }, (_, i) => sourceAirborne[0] * ease(i / entryFrames)), ...sourceAirborne,
    ...Array.from({ length: exitFrames }, (_, i) => sourceAirborne.at(-1) * (1 - ease((i + 1) / exitFrames)))];
  const bounds = { minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, radius: 0 };
  for (let index = 0; index < times.length; index++) {
    for (const node of target.ordered) { if (rotations.has(node.name)) node.quaternion.fromArray(rotations.get(node.name), index * 4); updateNode(node); }
    const seatWeight = actionId === 343 ? Math.min(1, ease(Math.min(1, times[index] / entryDuration)), ease(Math.min(1, (duration - times[index]) / exitDuration))) : 0;
    const frame = support.measure(target, true), y = -frame.minY + airborne[index] + .002 + seatWeight * .16;
    rootValues.push(0, y, 0);
    if (planar) targetFeet.push(planarSamplers.targetSampler.sample(target, y));
    bounds.minY = Math.min(bounds.minY, frame.minY + y); bounds.maxY = Math.max(bounds.maxY, frame.maxY + y);
    for (const key of ['minX', 'minZ']) bounds[key] = Math.min(bounds[key], frame[key]);
    for (const key of ['maxX', 'maxZ', 'radius']) bounds[key] = Math.max(bounds[key], frame[key]);
  }
  let planarSupport;
  if (planar) {
    const solved = solveStationaryPlanarSupport({ times: sourceTimes, sourceFeet,
      targetFeet: targetFeet.slice(entryFrames, entryFrames + sourceTimes.length), sourceRoots: trajectory,
      legRatio, sourceFloor: sourceContact, targetFloor: .002, targetTolerance: .04, maxOffset: virtualRootBound });
    const positions = envelopePlanarSupport(solved.positionsXZ, entryFrames, exitFrames);
    if (positions.length !== times.length) throw new Error('Planar support lost entry/source/exit alignment.');
    planarSupport = solved.evidence;
    for (let index = 0; index < times.length; index++) {
      rootValues[index * 3] = positions[index][0]; rootValues[index * 3 + 2] = positions[index][1];
    }
    const applyFrame = index => {
      target.byName.get('DoreumiRig').position.fromArray(rootValues, index * 3);
      for (const node of target.ordered) { if (rotations.has(node.name)) node.quaternion.fromArray(rotations.get(node.name), index * 4); updateNode(node); }
    };
    // A single planar root correction cannot satisfy two planted feet on short legs.
    // Preserve every bind translation and scale while matching source support.
    if (PLANAR_SUPPORT_ACTIONS.has(actionId)) {
      const plannedTargetFeet = targetFeet.slice(entryFrames, entryFrames + sourceTimes.length).map((feet, sourceIndex) => {
        const offset = positions[entryFrames + sourceIndex];
        return Object.fromEntries(['L', 'R'].map(side => [side, feet[side].map(point => [point[0] + offset[0], point[1], point[2] + offset[1]])]));
      });
      const adapter = createStationaryFootContactAdapter({ sourceFeet, sourceTimes, sourceLegFrames, sourceFloor: sourceContact,
        legRatio, plannedTargetFeet, virtualRootBound, preserveSourceTwist: planarSamplers.preserveSourceTwist,
        preparationDuration: planarSamplers.preparationDuration,
        targetSampler: planarSamplers.targetSampler, targetLegSampler: planarSamplers.targetLegSampler, targetFloor: .002,
        onFrame: planarSamplers.onFrame, plannedRootPath: planarSamplers.plannedRootPath,
        plannedContactFrames: planarSamplers.plannedContactFrames, plannedPoleAngles: planarSamplers.plannedPoleAngles,
        probePoleIntervals: planarSamplers.probePoleIntervals });
      let maxPostContactFloorLift = 0, worstFloorLift;
      const initialFloorLifts = [];
      for (let sourceIndex = 0; sourceIndex < sourceTimes.length; sourceIndex++) {
        const index = entryFrames + sourceIndex;
        applyFrame(index); adapter.apply(target, sourceIndex, () => target.ordered.forEach(updateNode));
        const floorMeasurement = support.measure(target, true, true), lift = Math.max(0, .002 - floorMeasurement.minY);
        const floorDiagnostic = { sourceIndex, time: sourceTimes[sourceIndex], lift, ...floorMeasurement.minimumVertex };
        planarSamplers.onFrame?.({ phase: 'floor-skin', ...floorDiagnostic });
        if (sourceIndex < 5) initialFloorLifts.push(floorDiagnostic);
        if (lift > maxPostContactFloorLift) worstFloorLift = floorDiagnostic;
        if (lift) { target.byName.get('DoreumiRig').position.y += lift; target.ordered.forEach(updateNode); }
        adapter.synchronizeGrounding(target);
        maxPostContactFloorLift = Math.max(maxPostContactFloorLift, lift);
        target.byName.get('DoreumiRig').position.toArray(rootValues, index * 3);
        for (const [name, values] of rotations) target.byName.get(name).quaternion.toArray(values, index * 4);
      }
      planarSupport.footContact = { ...adapter.evidence, maxPostContactFloorLift, worstFloorLift, initialFloorLifts };
      // Rebuild both envelopes from the adapted source endpoints. Reusing the old
      // endpoint pose would visibly snap a planted leg at entry or recovery.
      const lastSource = entryFrames + sourceTimes.length - 1;
      for (const [name, values] of rotations) {
        const idle = support.idleRotations.get(name), first = new Quaternion().fromArray(values, entryFrames * 4), last = new Quaternion().fromArray(values, lastSource * 4);
        for (let index = 0; index < entryFrames; index++) idle.clone().slerp(first, ease(index / entryFrames)).toArray(values, index * 4);
        for (let index = 0; index < exitFrames; index++) last.clone().slerp(idle, ease((index + 1) / exitFrames)).toArray(values, (lastSource + index + 1) * 4);
        for (let index = 4; index < values.length; index += 4) if (new Quaternion().fromArray(values, index - 4).dot(new Quaternion().fromArray(values, index)) < 0) for (let c = 0; c < 4; c++) values[index + c] *= -1;
      }
      const initialRoot = new Vector3().fromArray(rootValues), finalRoot = new Vector3().fromArray(rootValues, rootValues.length - 3);
      const firstRoot = new Vector3().fromArray(rootValues, entryFrames * 3), lastRoot = new Vector3().fromArray(rootValues, lastSource * 3);
      for (let index = 0; index < entryFrames; index++) initialRoot.clone().lerp(firstRoot, ease(index / entryFrames)).toArray(rootValues, index * 3);
      for (let index = 0; index < exitFrames; index++) lastRoot.clone().lerp(finalRoot, ease((index + 1) / exitFrames)).toArray(rootValues, (lastSource + index + 1) * 3);
    }
    Object.assign(bounds, { minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, radius: 0 });
    for (let index = 0; index < times.length; index++) {
      applyFrame(index);
      const frame = support.measure(target, true);
      const lift = Math.max(0, .002 - frame.minY);
      if (lift) { rootValues[index * 3 + 1] += lift; frame.minY += lift; frame.maxY += lift; }
      for (const key of ['minX', 'minY', 'minZ']) bounds[key] = Math.min(bounds[key], frame[key]);
      for (const key of ['maxX', 'maxY', 'maxZ', 'radius']) bounds[key] = Math.max(bounds[key], frame[key]);
    }
    planarSupport.maxOffset = Math.max(...times.map((_, index) => Math.hypot(rootValues[index * 3], rootValues[index * 3 + 2])));
    if (planarSupport.maxOffset > virtualRootBound) throw new Error(`Adapted planar support exceeds the ${virtualRootBound}-unit bound: ${planarSupport.maxOffset}`);
  }
  const tracks = [];
  for (const [name, values] of rotations) {
    const reduced = decimateTrack(times, values, 4, 0.004, true);
    tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, reduced.times, reduced.values));
  }
  const reducedRoot = decimateTrack(times, rootValues, 3, 0.0008);
  tracks.push(new VectorKeyframeTrack('DoreumiRig.position', reducedRoot.times, reducedRoot.values));
  const clip = new AnimationClip(`meshy:${actionId}`, duration, tracks);
  const json = serializeClip(clip);
  const framing = [501, 508].includes(actionId) ? buildTrackedCamera(json, target, support, updateNode)
    : { halfHeight: Math.max((bounds.maxY - bounds.minY) / 2 + .16, bounds.radius + .16), centerY: (bounds.minY + bounds.maxY) / 2 };
  return { json, evidence: { converterVersion: VERSION, sourceActionId: actionId, targetRigSignature: contract.rigSignature,
    duration, sourceDuration, entryDuration, exitDuration, samples: times.length, tracks: tracks.length, retainedKeys: json.tracks.reduce((sum, track) => sum + track.times.length, 0),
    limitsApplied, legRatio, rootPolicy: planar ? 'source-contact-aware-bounded-planar-support; full-master-skin-floor-and-source-airborne-height'
      : 'full-master-skin-support-with-full-source-skin-airborne-height; no horizontal root travel',
    transitions: 'master-Idle-to-motion-to-master-Idle; smooth quaternion interpolation with per-frame skin grounding',
    bounds, framing,
    targetSupportVertices: support.supportVertices, sourceSupportVertices: sourceSupport.supportVertices,
    ...(FLOOR_TRANSITION_ACTIONS.has(actionId) ? { airbornePolicy: airborneAdjustment.policy,
      ...(airborneAdjustment.sourceFootFloors ? { sourceFootFloors: airborneAdjustment.sourceFootFloors } : {}),
      ...(airborneAdjustment.sourceRestFloor !== undefined ? { sourceRestFloor: airborneAdjustment.sourceRestFloor } : {}) } : {}),
    semantics: motionSemantics(metadata ?? { sourceName: animation.getName(), sourceCategory: '', sourceSubCategory: '' }, trajectory, sourceDuration, legRatio),
    contactFrames, maxContactReachClamp, ...(planarSupport ? { planarSupport } : {}),
    ...(sourceTailEvidence(actionMetadata, sourceDuration) ? { sourceTailRepair: sourceTailEvidence(actionMetadata, sourceDuration) } : {}),
    targetRestTranslationsPreserved: true, targetScalesPreserved: true, donorGeometryIncluded: false, visualReview: 'pending' } };
}

async function main() {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => { const [name, value] = arg.replace(/^--/, '').split('='); return [name, value ?? true]; }));
  const wanted = options.ids ? new Set(String(options.ids).split(',').map(Number)) : null;
  if (wanted && [...wanted].some(id => !Number.isSafeInteger(id) || id < 0)) throw new Error('Invalid --ids selection.');
  const ledger = readJson(path.join(CACHE, 'ledger.json'));
  const contract = readJson(path.join(ROOT, 'public/doreumi/rig-contract.json'));
  const masterFile = path.join(ROOT, 'public/doreumi/doreumi-master.glb'), masterSha256 = sha(fs.readFileSync(masterFile));
  const support = await createMasterSupport(masterFile, contract);
  const floorLibrary = !wanted || [...wanted].some(id => FLOOR_TRANSITION_ACTIONS.has(id) || FLOOR_ACROBATIC_ACTIONS.has(id))
    ? await createFloorTransitionLibrary(masterFile, contract, support) : null;
  const targetSampler = createPlanarFootSampler(support.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const targetLegSampler = createPlanarFootSampler(support.document, { L: ['kneeL', 'shinL'], R: ['kneeR', 'shinR'] }, { morphWeight: 1 });
  const handSampler = createPlanarFootSampler(support.document, { L: ['wristL'], R: ['wristR'] }, { morphWeight: 1 });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const references = new Map([[ledger.rig.id, await io.read(path.join(CACHE, ledger.rig.file))]]);
  if (ledger.recoveryRig?.status === 'downloaded') references.set(ledger.recoveryRig.id, await io.read(path.join(CACHE, ledger.recoveryRig.file)));
  const catalog = new Map(readJson(path.join(ROOT, 'scripts/doreumi/meshy-library.json')).motions.map(item => [item.actionId, item]));
  const derived = (ledger.derivations ?? []).map(derivation => {
    const source = ledger.batches.find(batch => batch.status === 'downloaded' && batch.actionIds.includes(derivation.baseSourceActionId));
    if (!source) throw new Error('In-place derivation lost its actual acquired source.');
    return { ...source, id: `derived-${derivation.actionId}`, actionIds: [derivation.actionId], sourceIndices: [source.actionIds.indexOf(derivation.baseSourceActionId)],
      validationActionIds: source.actionIds, derivation };
  });
  const batches = [...ledger.batches.filter(batch => batch.status === 'downloaded'), ...derived]
    .filter(batch => (!options.batch || batch.id === options.batch) && (!wanted || batch.actionIds.some(id => wanted.has(id))));
  if (wanted && [...wanted].some(id => !batches.some(batch => batch.actionIds.includes(id)))) throw new Error('Requested action is not acquired or derived.');
  const manifestFile = path.join(PUBLIC, 'meshy-source-manifest.json');
  const existing = readJson(manifestFile), converted = new Map();
  let skipped = 0;
  for (const batch of batches) {
    const selectedIds = batch.actionIds.filter(id => !wanted || wanted.has(id));
    const file = path.join(CACHE, batch.file), sourceSha256 = sha(fs.readFileSync(file));
    if (sourceSha256 !== batch.structure.sha256) throw new Error('Source checksum changed.');
    const previous = new Map(existing.motions.map(item => [item.actionId, item]));
    if (!options.force && selectedIds.every(id => {
      const item = previous.get(id), output = path.join(PUBLIC, `meshy-${id}.json`);
      return item?.retarget === 'converted' && item.sourceSha256 === sourceSha256 && item.targetRigSignature === contract.rigSignature
        && item.retargetEvidence?.converterVersion === VERSION && item.retargetEvidence?.masterSha256 === masterSha256
        && fs.existsSync(output) && sha(fs.readFileSync(output)) === item.convertedSha256;
    })) { skipped += selectedIds.length; continue; }
    const document = await io.read(file);
    validateSource(document, references.get(batch.rigId ?? ledger.rig.id), batch.validationActionIds ?? batch.actionIds);
    const sourceSupport = createSourceSupport(document);
    const sourceSampler = selectedIds.some(id => PLANAR_SUPPORT_ACTIONS.has(id) || id === 325)
      ? createPlanarFootSampler(document, { L: ['LeftFoot', 'LeftToeBase'], R: ['RightFoot', 'RightToeBase'] }, { morphWeight: 0 }) : undefined;
    for (let index = 0; index < batch.actionIds.length; index++) {
      const actionId = batch.actionIds[index], output = path.join(PUBLIC, `meshy-${actionId}.json`);
      if (wanted && !wanted.has(actionId)) continue;
      const actionMetadata = { ...catalog.get(actionId), sourceSha256 };
      const contactPlan = loadReviewedContactPlan({ actionId, sourceSha256, masterSha256 });
      const acrobaticsContract = loadAcrobaticsContract({ actionId, sourceSha256, masterSha256 });
      const adaptSourceLegs = contactPlan?.geometricLegs ? (target, source, _ratio, update) => retargetSourceLegPose(target,
        Object.fromEntries(['L', 'R'].map(side => {
          const prefix = side === 'L' ? 'Left' : 'Right';
          return [side, Object.fromEntries([['hip', 'UpLeg'], ['knee', 'Leg'], ['foot', 'Foot']]
            .map(([key, suffix]) => [key, source.byName.get(prefix + suffix).worldPosition.toArray()]))];
        })), update) : undefined;
      let { json, evidence } = retargetAnimation(document, document.getRoot().listAnimations()[batch.sourceIndices?.[index] ?? index], actionId, contract, support, sourceSupport, actionMetadata,
        { sourceSampler, targetSampler, targetLegSampler, handSampler, ...contactPlan, adaptSourceLegs });
      if (contactPlan?.stageSplit) {
        if (sha(JSON.stringify(json) + '\n') !== contactPlan.virtualClipSha256) throw new Error(`Reviewed motion ${actionId} no longer reproduces its virtual support clip; output was not written.`);
        ({ json, evidence } = splitReviewedStageSupport({ json, evidence, document,
          animation: document.getRoot().listAnimations()[batch.sourceIndices?.[index] ?? index], contract, support, sourceSampler, targetSampler, metadata: actionMetadata }));
        if (sha(JSON.stringify({ frame: evidence.framing, travel: evidence.semantics.travel })) !== contactPlan.stageMetadataSha256)
          throw new Error(`Reviewed motion ${actionId} no longer reproduces its exact stage travel and framing; output was not written.`);
      }
      if (floorLibrary && FLOOR_TRANSITION_ACTIONS.has(actionId)) {
        const adapted = adaptFloorTransitions(AnimationClip.parse(json), evidence, catalog.get(actionId), floorLibrary);
        json = serializeClip(adapted.clip); evidence = adapted.evidence;
      }
      if (floorLibrary && actionId === 502) {
        const adapted = adaptAirborneFall(AnimationClip.parse(json), evidence, actionMetadata, { ...floorLibrary, masterSha256 }, serializeClip);
        json = serializeClip(adapted.clip); evidence = adapted.evidence;
      }
      if (floorLibrary && FLOOR_ACROBATIC_ACTIONS.has(actionId)) {
        const library = actionId === 406 ? { ...floorLibrary, sourcePalmSupport: sourcePalmSupport(document, document.getRoot().listAnimations()[batch.sourceIndices?.[index] ?? index]) } : floorLibrary;
        const adapted = adaptFloorAcrobatics(AnimationClip.parse(json), evidence, catalog.get(actionId), library);
        json = serializeClip(adapted.clip); evidence = adapted.evidence;
      }
      evidence.masterSha256 = masterSha256;
      if (batch.derivation) {
        evidence.requestedActionId = actionId; evidence.sourceActionId = batch.derivation.baseSourceActionId;
        evidence.derivation = { type: 'local_inplace', baseSourceActionId: batch.derivation.baseSourceActionId, operation: 'remove_horizontal_root_motion' };
      }
      if (contactPlan) {
        if (Math.abs(contactPlan.sourceDuration - evidence.sourceDuration) > 1e-7
          || sha(JSON.stringify(json) + '\n') !== contactPlan.convertedSha256) throw new Error(`Reviewed motion ${actionId} no longer reproduces its exact clip bytes; output was not written.`);
        evidence.reviewedContactPlan = { version: 1, planSha256: contactPlan.planSha256, reproducedClipSha256: contactPlan.convertedSha256 };
      }
      if (acrobaticsContract) evidence.reviewedAcrobaticsContract = validateAcrobaticsOutput(acrobaticsContract, json, evidence);
      atomicJson(output, json);
      converted.set(actionId, { retarget: 'converted', url: `/doreumi/motions/meshy-${actionId}.json`, duration: json.duration,
        targetRigSignature: contract.rigSignature, sourceSha256, convertedSha256: sha(fs.readFileSync(output)), retargetEvidence: evidence });
    }
    // Re-read before each short atomic merge so an active downloader retains its latest progress.
    const latest = readJson(manifestFile);
    for (const item of latest.motions) if (converted.has(item.actionId)) Object.assign(item, converted.get(item.actionId));
    latest.counts.retargeted = latest.motions.filter(item => item.retarget === 'converted').length;
    latest.updatedAt = new Date().toISOString(); atomicJson(manifestFile, latest, true);
    console.log(JSON.stringify({ event: 'retargeted', batch: batch.id, actions: selectedIds.length, convertedThisRun: converted.size, total: latest.counts.retargeted }));
  }
  console.log(JSON.stringify({ event: 'conversion_complete', converted: converted.size, skipped, visualReview: 'pending' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
