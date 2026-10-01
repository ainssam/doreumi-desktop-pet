import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';

export const AIRBORNE_FALL = Object.freeze({
  actionId: 502,
  sourceSha256: 'd4eeaeea8e16dc1ec703aeb13f42eaf7fd638923258ef4923efdd5efa847990b',
  masterSha256: 'ff950b38e254c5a92c4d198bc333cf9b5763883f5f824de06b8c688019f0afa1',
  sourceDuration: 4.5,
  playbackSourceDuration: .9,
  flightEntry: .25,
  flightExit: .25,
  gravity: 1.7,
});
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (10 + t * (-15 + 6 * t)); };
const mix = (a, b, t) => ({ root: a.root.clone().lerp(b.root, t), rotations: new Map([...a.rotations].map(([name, q]) => [name, q.clone().slerp(b.rotations.get(name), t)])) });

function sampler(clip, contract) {
  const tracks = clip.tracks.filter(track => track.name.endsWith('.quaternion') || track.name === 'DoreumiRig.position')
    .map(track => ({ name: track.name.split('.')[0], rotation: track.name.endsWith('.quaternion'), sample: track.createInterpolant() }));
  return time => {
    const pose = { root: new Vector3(), rotations: new Map(contract.bones.map(bone => [bone.name, new Quaternion().fromArray(bone.restLocalQuaternion)])) };
    for (const track of tracks) {
      const value = track.sample.evaluate(time);
      if (track.rotation) pose.rotations.get(track.name).fromArray(value).normalize(); else pose.root.fromArray(value);
    }
    return pose;
  };
}
function apply(graph, pose) {
  for (const node of graph.ordered) {
    node.quaternion.copy(pose.rotations.get(node.name));
    if (node.name === 'DoreumiRig') node.position.copy(pose.root);
    updateNode(node);
  }
}
function inverseRoot(sample, from, to, height, increasing) {
  for (let iteration = 0; iteration < 18; iteration++) {
    const middle = (from + to) / 2;
    if ((sample(middle).root.y < height) === increasing) from = middle; else to = middle;
  }
  const result = sample((from + to) / 2); result.root.y = height; return result;
}

/** The acquired source is an in-place freefall cycle, not a ballistic root
 * trajectory. Retain its full rotation sequence at an explicit faster clock
 * and author one short parabola before, during and after that source cycle.
 * Only the feet support takeoff/landing; there is no palm-contact claim. */
export function adaptAirborneFall(clip, evidence, metadata, library, serializeClip) {
  if (metadata?.actionId !== AIRBORNE_FALL.actionId) return { clip, evidence };
  if (metadata.sourceSha256 !== AIRBORNE_FALL.sourceSha256 || library.masterSha256 !== AIRBORNE_FALL.masterSha256
    || Math.abs(evidence.sourceDuration - AIRBORNE_FALL.sourceDuration) > 1e-6) throw Error('Airborne502 source/master changed; re-audit the flight context.');
  if (evidence.airborneFall?.version === 2) return { clip, evidence };
  const graph = targetGraph(library.contract), sample = sampler(clip, library.contract);
  const master = Object.fromEntries(['Idle', 'Jump', 'Landing'].map(name => [name, sampler(library.masterClips.find(item => item.name === name), library.contract)]));
  const idle = master.Idle(0), feet = createPlanarFootSampler(library.support.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  apply(graph, idle);
  const supportHeight = library.support.measure(graph);
  const grounded = pose => {
    apply(graph, pose);
    const points = feet.sample(graph);
    pose.root.y += supportHeight - Math.min(...points.L.map(p => p[1]), ...points.R.map(p => p[1]));
    return pose;
  };
  const groundedJump = time => grounded(master.Jump(time)), groundedLanding = time => grounded(master.Landing(time));
  // Release before the knee reaches its straight-leg singularity. The brief
  // supported extension remains readable without an instantaneous knee snap.
  const launchSample = .77, impactSample = .03;
  const launchPose = groundedJump(launchSample), crouch = groundedJump(.56), landingPose = groundedLanding(impactSample), compressed = groundedLanding(.12);
  const first = sample(evidence.entryDuration), last = sample(evidence.entryDuration + evidence.sourceDuration);
  const playbackSourceDuration = AIRBORNE_FALL.playbackSourceDuration, sourceTimeScale = evidence.sourceDuration / playbackSourceDuration;
  const flightDuration = AIRBORNE_FALL.flightEntry + playbackSourceDuration + AIRBORNE_FALL.flightExit;
  const launchVelocity = AIRBORNE_FALL.gravity * flightDuration / 2 + (landingPose.root.y - launchPose.root.y) / flightDuration;
  const impactVelocity = launchVelocity - AIRBORNE_FALL.gravity * flightDuration;
  const extensionDuration = 2 * (launchPose.root.y - crouch.root.y) / launchVelocity;
  const compressionDuration = 2 * (landingPose.root.y - compressed.root.y) / -impactVelocity;
  if (!(extensionDuration > .08 && extensionDuration < .25 && compressionDuration > .08 && compressionDuration < .25)) throw Error('Airborne502 launch/compression lost its short-leg support range.');
  const anticipationDuration = .56, takeoff = anticipationDuration + extensionDuration;
  const entryDuration = takeoff + AIRBORNE_FALL.flightEntry;
  const impact = takeoff + flightDuration, recoveryDuration = .65 - .12;
  const duration = impact + compressionDuration + recoveryDuration;
  const exitDuration = duration - entryDuration - playbackSourceDuration;
  const flightRoot = time => launchPose.root.y + launchVelocity * time - .5 * AIRBORNE_FALL.gravity * time * time;
  const armNames = [...idle.rotations.keys()].filter(name => /^(shoulder|arm|elbow|wrist)/.test(name));
  const prepareArms = (pose, time) => {
    for (const name of armNames) pose.rotations.set(name, idle.rotations.get(name).clone().slerp(launchPose.rotations.get(name), smooth(time / takeoff)));
    return pose;
  };
  const anticipation = time => prepareArms(grounded(mix(idle, master.Jump(time), smooth(time / .20))), time);
  const transition = time => {
    if (time <= anticipationDuration) return anticipation(time);
    if (time < takeoff) {
      const local = time - anticipationDuration;
      const height = crouch.root.y + .5 * launchVelocity / extensionDuration * local * local;
      return prepareArms(inverseRoot(groundedJump, .56, launchSample, height, true), time);
    }
    if (time <= impact) {
      const local = time - takeoff;
      const pose = local < AIRBORNE_FALL.flightEntry ? mix(launchPose, first, smooth(local / AIRBORNE_FALL.flightEntry))
        : local > AIRBORNE_FALL.flightEntry + playbackSourceDuration ? mix(last, landingPose, smooth((local - AIRBORNE_FALL.flightEntry - playbackSourceDuration) / AIRBORNE_FALL.flightExit))
          : sample(evidence.entryDuration + (local - AIRBORNE_FALL.flightEntry) * sourceTimeScale);
      pose.root.set(0, flightRoot(local), 0); return pose;
    }
    if (time < impact + compressionDuration) {
      const local = time - impact;
      const height = landingPose.root.y + impactVelocity * local - .5 * impactVelocity / compressionDuration * local * local;
      return inverseRoot(groundedLanding, impactSample, .12, height, false);
    }
    const local = time - impact - compressionDuration;
    // The exact Idle endpoint also removes the master Landing's tiny residual
    // arm difference, without changing the measured leg recovery trajectory.
    return grounded(mix(master.Landing(Math.min(.65, .12 + local)), idle, smooth(local / recoveryDuration)));
  };
  const entryTimes = Array.from({ length: Math.ceil(entryDuration * 120) }, (_, i) => i / 120);
  const exitTimes = Array.from({ length: Math.ceil(exitDuration * 120) + 1 }, (_, i) => Math.min(duration, entryDuration + playbackSourceDuration + i / 120));
  const transitionTimes = [...entryTimes, entryDuration, entryDuration + playbackSourceDuration, ...exitTimes, duration];
  const frames = new Map(transitionTimes.map(time => [time, transition(time)]));
  const tracks = [];
  for (const old of clip.tracks.filter(track => track.name.endsWith('.quaternion'))) {
    const name = old.name.split('.')[0], interpolant = old.createInterpolant(), times = [], values = [];
    const append = (time, value) => { if (times.length && time - times.at(-1) < 1e-7) values.splice(values.length - 4, 4, ...value); else { times.push(time); values.push(...value); } };
    for (const time of entryTimes) append(time, frames.get(time).rotations.get(name).toArray());
    append(entryDuration, [...interpolant.evaluate(evidence.entryDuration)]);
    for (const time of old.times) if (time > evidence.entryDuration && time < evidence.entryDuration + evidence.sourceDuration) {
      append(entryDuration + (time - evidence.entryDuration) / sourceTimeScale, [...interpolant.evaluate(time)]);
    }
    append(entryDuration + playbackSourceDuration, [...interpolant.evaluate(evidence.entryDuration + evidence.sourceDuration)]);
    for (const time of exitTimes) append(time, frames.get(time).rotations.get(name).toArray());
    append(duration, idle.rotations.get(name).toArray());
    tracks.push(new QuaternionKeyframeTrack(old.name, times, values));
  }
  const times = [...new Set([...transitionTimes, ...Array.from({ length: Math.ceil(duration * 120) + 1 }, (_, i) => Math.min(duration, i / 120)), anticipationDuration, takeoff, impact, impact + compressionDuration])].sort((a, b) => a - b);
  const roots = times.flatMap(time => transition(time).root.toArray());
  tracks.push(new VectorKeyframeTrack('DoreumiRig.position', times, roots));
  const result = new AnimationClip(clip.name, duration, tracks), json = serializeClip(result);
  const measured = sampler(AnimationClip.parse(json), library.contract), bounds = { minY: Infinity, maxY: -Infinity, radius: 0 };
  for (let index = 0; index <= Math.ceil(duration * 120); index++) {
    apply(graph, measured(Math.min(duration, index / 120)));
    const current = library.support.measure(graph, true);
    bounds.minY = Math.min(bounds.minY, current.minY); bounds.maxY = Math.max(bounds.maxY, current.maxY); bounds.radius = Math.max(bounds.radius, current.radius);
  }
  const framing = { halfHeight: Math.max((bounds.maxY - bounds.minY) / 2 + .16, bounds.radius + .16), centerY: (bounds.minY + bounds.maxY) / 2 };
  const next = { ...evidence, duration, entryDuration, exitDuration, playbackSourceDuration, sourceTimeScale,
    samples: json.tracks.find(track => track.name === 'DoreumiRig.position').times.length, tracks: json.tracks.length,
    samplingPolicy: '120Hz authored root and transition poses; full source quaternion-key sequence with explicit 5x playback clock',
    retainedKeys: json.tracks.reduce((total, track) => total + track.times.length, 0), framing, bounds,
    airbornePolicy: 'source-confirmed-airborne-with-explicit-authored-ballistic-root',
    rootPolicy: 'Authored 1.4-second ballistic flight; full 4.5-second in-place source rotation sequence retimed to .9 seconds. Feet-supported takeoff and compressed landing; fixed-ground camera and no horizontal travel.',
    transitions: 'master-foot-supported-crouch-launch; airborne-prone-entry; source-freefall-cycle; airborne-feet-down-recovery; foot-impact-compression',
    semantics: { ...evidence.semantics, targetRootDisplacementXZ: [0, 0], contactAdaptation: 'retimed-source-airborne-cycle-with-authored-ballistic-root' },
    airborneFall: { version: 2, verifiedSourceSha256: metadata.sourceSha256, verifiedMasterSha256: library.masterSha256,
      sourceRotationsPreserved: true, sourceTimeRetimed: true, sourceTimeScale, playbackSourceDuration, sourceRootIsBallistic: false, sourceCoreDuration: evidence.sourceDuration,
      cameraPolicy: 'fixed-ground',
      authoredRoot: true, gravityModelUnitsPerSecondSquared: AIRBORNE_FALL.gravity, flightDuration, launchVelocity, impactVelocity, apexTime: takeoff + launchVelocity / AIRBORNE_FALL.gravity,
      apexRootY: flightRoot(launchVelocity / AIRBORNE_FALL.gravity), takeoff, impact, anticipationDuration, extensionDuration, compressionDuration,
      entrySupport: 'two-feet', landingSupport: 'two-feet', airborneSupport: 'none', palmContactClaimed: false } };
  delete next.floorTransitions;
  return { clip: AnimationClip.parse(json), evidence: next };
}
