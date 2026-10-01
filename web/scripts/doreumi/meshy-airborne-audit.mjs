import { AnimationClip, Quaternion } from 'three';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';

const degrees = (a, b) => a.angleTo(b) * 180 / Math.PI;

/** Decode the generated candidate independently. Ground support is measured
 * only in the authored takeoff and landing phases. Airborne source frames are
 * never counted as successful foot or palm contacts. */
export function auditAirborneFall({ json, evidence, contract, support, originalJson, originalEvidence }) {
  const clip = AnimationClip.parse(json), graph = targetGraph(contract);
  const tracks = clip.tracks.map(track => ({ node: graph.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const feet = createPlanarFootSampler(support.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const flight = evidence.airborneFall, samples = [], phases = [
    { name: 'feet-supported-takeoff', from: 0, to: flight.takeoff },
    { name: 'feet-supported-landing', from: flight.impact, to: clip.duration },
  ].map(phase => ({ ...phase, samples: 0, minimumFootY: Infinity, maximumFootMinimumY: -Infinity, maximumMaterialPointDrift: 0, anchors: {} }));
  const times = [...new Set([...Array.from({ length: Math.ceil(clip.duration * 120) + 1 }, (_, i) => Math.min(clip.duration, i / 120)),
    flight.takeoff, flight.impact, evidence.entryDuration, evidence.entryDuration + (evidence.playbackSourceDuration ?? evidence.sourceDuration), clip.duration])].sort((a, b) => a - b);
  const bounds = { minY: Infinity, maxY: -Infinity, radius: 0 };
  let maximumRootBallisticError = 0, minimumCoreSkinY = Infinity, rootAtTakeoff;
  let maximumLocalStep = { degrees: 0 }, maximumWorldStep = { degrees: 0 }, previous;
  const sample = time => {
    for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(time));
    graph.ordered.forEach(updateNode);
  };
  sample(flight.takeoff); rootAtTakeoff = graph.byName.get('DoreumiRig').position.y;
  for (const time of times) {
    sample(time);
    const skin = support.measure(graph, true), points = feet.sample(graph), rootY = graph.byName.get('DoreumiRig').position.y;
    bounds.minY = Math.min(bounds.minY, skin.minY); bounds.maxY = Math.max(bounds.maxY, skin.maxY); bounds.radius = Math.max(bounds.radius, skin.radius);
    if (time >= flight.takeoff && time <= flight.impact) {
      const t = time - flight.takeoff;
      maximumRootBallisticError = Math.max(maximumRootBallisticError, Math.abs(rootY - (rootAtTakeoff + flight.launchVelocity * t - .5 * flight.gravityModelUnitsPerSecondSquared * t * t)));
    }
    if (time >= evidence.entryDuration && time <= evidence.entryDuration + (evidence.playbackSourceDuration ?? evidence.sourceDuration)) minimumCoreSkinY = Math.min(minimumCoreSkinY, skin.minY);
    for (const phase of phases.filter(phase => time >= phase.from && time <= phase.to)) {
      phase.samples++;
      for (const side of ['L', 'R']) {
        const minimum = Math.min(...points[side].map(point => point[1]));
        phase.minimumFootY = Math.min(phase.minimumFootY, minimum); phase.maximumFootMinimumY = Math.max(phase.maximumFootMinimumY, minimum);
        if (!phase.anchors[side]) {
          const index = points[side].findIndex(point => point[1] === minimum);
          phase.anchors[side] = { vertexId: feet.vertexIds[side][index], index, position: [...points[side][index]] };
        }
        const anchor = phase.anchors[side], point = points[side][anchor.index];
        phase.maximumMaterialPointDrift = Math.max(phase.maximumMaterialPointDrift, Math.hypot(point[0] - anchor.position[0], point[2] - anchor.position[2]));
      }
    }
    samples.push({ time, rootY, minY: skin.minY, maxY: skin.maxY, footMinima: Object.fromEntries(['L', 'R'].map(side => [side, Math.min(...points[side].map(point => point[1]))])) });
    const rotations = graph.ordered.map(node => ({ name: node.name, local: node.quaternion.clone(), world: node.worldQuaternion.clone() }));
    if (previous) for (let i = 0; i < rotations.length; i++) {
      const current = rotations[i], before = previous.rotations[i];
      const local = degrees(before.local, current.local), world = degrees(before.world, current.world);
      if (local > maximumLocalStep.degrees) maximumLocalStep = { bone: current.name, degrees: local, from: previous.time, time };
      if (world > maximumWorldStep.degrees) maximumWorldStep = { bone: current.name, degrees: world, from: previous.time, time };
    }
    previous = { time, rotations };
  }
  const original = AnimationClip.parse(originalJson), candidateTracks = new Map(clip.tracks.map(track => [track.name, track.createInterpolant()]));
  let maximumPreservedCoreQuaternionError = 0;
  for (const track of original.tracks.filter(track => track.name.endsWith('.quaternion'))) {
    const old = track.createInterpolant(), candidate = candidateTracks.get(track.name);
    for (let i = 0; i <= Math.ceil(evidence.sourceDuration * 120); i++) {
      const t = Math.min(evidence.sourceDuration, i / 120);
      maximumPreservedCoreQuaternionError = Math.max(maximumPreservedCoreQuaternionError, degrees(
        new Quaternion().fromArray(old.evaluate(originalEvidence.entryDuration + t / (originalEvidence.sourceTimeScale ?? 1))).normalize(),
        new Quaternion().fromArray(candidate.evaluate(evidence.entryDuration + t / (evidence.sourceTimeScale ?? 1))).normalize()));
    }
  }
  const rootTrack = clip.tracks.find(track => track.name === 'DoreumiRig.position'), rootSample = rootTrack.createInterpolant();
  const derivative = (time, direction) => direction * (rootSample.evaluate(time + direction / 120)[1] - rootSample.evaluate(time)[1]) * 120;
  const velocityContinuity = [flight.takeoff, flight.impact].map(time => ({ time, incoming: derivative(time, -1), outgoing: derivative(time, 1) }));
  return { version: 1, fps: 120, method: 'Serialized candidate; every joint local/world quaternion; exact deformed skin envelope; fixed material-point foot vertices per authored support phase.',
    bounds, minimumCoreSkinY, maximumRootBallisticError, maximumPreservedCoreQuaternionError, maximumLocalStep, maximumWorldStep,
    velocityContinuity, supportPhases: phases, airborneSupport: 'none', palmContactClaimed: false, samples };
}
