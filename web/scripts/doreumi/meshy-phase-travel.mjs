import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { compactTravel } from './meshy-travel.mjs';

const distanceXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

function skinPair(before, after, floor, tolerance, retained, dt, preferStable) {
  const candidates = [];
  for (let vertex = 0; vertex < after.length; vertex++) {
    const a = before[vertex], b = after[vertex];
    if (!a || Math.abs(a[1] - floor) > tolerance || Math.abs(b[1] - floor) > tolerance) continue;
    candidates.push({ vertex, before: a, after: b, speed: distanceXZ(a, b) / dt, height: Math.max(a[1], b[1]) - floor });
  }
  if (!candidates.length) return null;
  candidates.sort(preferStable ? (a, b) => a.speed - b.speed || a.height - b.height : (a, b) => a.height - b.height || a.speed - b.speed);
  const old = candidates.find(candidate => candidate.vertex === retained);
  // A source toe can start rolling while another material point becomes the
  // actual contact. Retain a stable point, but never keep a moving toe merely
  // because it is a little lower than the newly planted foot.
  return old && (!preferStable || old.speed <= .15 || old.speed <= candidates[0].speed + .025) ? old : candidates[0];
}

function appendContact(phases, phase) {
  const previous = phases.findLast(candidate => candidate.side === phase.side);
  if (previous && previous.vertex === phase.vertex && previous.sourceVertex === phase.sourceVertex && Math.abs(previous.end - phase.start) < 1e-7) {
    previous.end = phase.end;
    previous.sourceMaxSpeed = Math.max(previous.sourceMaxSpeed, phase.sourceMaxSpeed);
    previous.sourceMaxHeight = Math.max(previous.sourceMaxHeight, phase.sourceMaxHeight);
    previous.targetMaxHeight = Math.max(previous.targetMaxHeight, phase.targetMaxHeight);
  } else phases.push(phase);
}

/** Source skin decides the support phase; the actual target material point
 * supplies its displacement. The target clip and every joint remain unchanged.
 * Deliberate source glides/pivots retain their measured displacement.
 */
export function integratePhaseAwareTravel({ times, sourceFeet, targetFeet, targetVertexIds, sourceVertexIds,
  sourceRoots, sourceFloor, legRatio, sourceTolerance = .04, targetFloor = .002, targetTolerance = .012,
  stationarySpeed = .15, onSample }) {
  if (times.length < 2 || sourceFeet.length !== times.length || targetFeet.length !== times.length
    || sourceRoots.length !== times.length || !(legRatio > 0 && Number.isFinite(legRatio))
    || times.some((time, index) => !Number.isFinite(time) || (index && time <= times[index - 1]))) throw new Error('Invalid source-phase travel samples');
  const floor = sourceFloor ?? quantile(sourceFeet.map(frame => Math.min(...frame.L.map(point => point[1]), ...frame.R.map(point => point[1]))), .1);
  const retained = { L: {}, R: {} }, positions = [[0, 0]], phases = [], supports = [];
  let supportSide, supportedPairs = 0, movingContactPairs = 0, sourcePlantedPairs = 0, missingTargetContactPairs = 0, airbornePairs = 0, maxStageSpeed = 0;
  for (let index = 1; index < times.length; index++) {
    const dt = times[index] - times[index - 1], options = [];
    for (const side of ['L', 'R']) {
      const source = skinPair(sourceFeet[index - 1][side], sourceFeet[index][side], floor, sourceTolerance, retained[side].source, dt, true);
      const target = skinPair(targetFeet[index - 1][side], targetFeet[index][side], targetFloor, targetTolerance, retained[side].target, dt, false);
      retained[side] = { source: source?.vertex, target: target?.vertex };
      if (source && source.speed <= stationarySpeed) {
        sourcePlantedPairs++;
        if (!target) missingTargetContactPairs++;
        else appendContact(phases, {
          start: times[index - 1], end: times[index], side, vertex: targetVertexIds[side][target.vertex],
          sourceVertex: sourceVertexIds?.[side]?.[source.vertex] ?? source.vertex,
          sourceMaxSpeed: source.speed, sourceMaxHeight: source.height, targetMaxHeight: target.height,
        });
      }
      if (source && target) options.push({ side, source, target });
    }
    let delta;
    if (options.length) {
      options.sort((a, b) => a.source.speed - b.source.speed || a.source.height - b.source.height);
      const old = options.find(option => option.side === supportSide);
      const support = old && old.source.speed <= options[0].source.speed + .025 ? old : options[0];
      supportSide = support.side; supportedPairs++;
      if (support.source.speed > stationarySpeed) movingContactPairs++;
      delta = [0, 2].map(axis => (support.source.after[axis] - support.source.before[axis]) * legRatio - (support.target.after[axis] - support.target.before[axis]));
    } else {
      supportSide = undefined; airbornePairs++;
      delta = [0, 2].map(axis => (sourceRoots[index][axis] - sourceRoots[index - 1][axis]) * legRatio);
    }
    maxStageSpeed = Math.max(maxStageSpeed, Math.hypot(...delta) / dt);
    positions.push(positions.at(-1).map((value, axis) => value + delta[axis]));
    supports.push(supportSide ?? 'airborne');
    onSample?.({ index, time: times[index], support: supportSide, options, delta, position: positions.at(-1) });
  }
  return { positions, phases, supports, evidence: { sourceFloor: floor, sourceTolerance, targetFloor, targetTolerance, stationarySpeed,
    supportedPairs, movingContactPairs, sourcePlantedPairs, missingTargetContactPairs, airbornePairs, maxStageSpeed } };
}

/** Source arrays are sampled at raw sourceTimes. targetSampler is the existing
 * createPlanarFootSampler(master, {L:['footL'], R:['footR']}, {morphWeight:1}).
 */
export function bakePhaseAwareTravel({ clip, evidence, contract, sourceTimes, sourceFeet, sourceRoots, sourceVertexIds,
  sourceFloor, targetSampler, targetMesh = 'Doreumi', targetVertexCount = 78799, preservePhaseTimePrecision = false }) {
  if (sourceTimes[0] !== 0 || Math.abs(sourceTimes.at(-1) - evidence.sourceDuration) > 1e-4) throw new Error('Source phase samples must include both clip endpoints');
  if (!targetSampler.vertexIds) throw new Error('Actual target vertex IDs are required for reproducible contact evidence');
  const target = targetGraph(contract), samplers = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const targetFeet = sourceTimes.map(time => {
    for (const sampler of samplers) sampler.node[sampler.property].fromArray(sampler.sample.evaluate(evidence.entryDuration + time));
    target.ordered.forEach(updateNode);
    return targetSampler.sample(target);
  });
  const integrated = integratePhaseAwareTravel({ times: sourceTimes, sourceFeet, targetFeet, sourceRoots, sourceFloor, legRatio: evidence.legRatio,
    targetVertexIds: targetSampler.vertexIds, sourceVertexIds });
  const displacement = integrated.positions.at(-1), distance = Math.hypot(...displacement), entry = evidence.entryDuration;
  const compact = compactTravel([0, ...sourceTimes.map(time => entry + time), clip.duration], [[0, 0], ...integrated.positions, integrated.positions.at(-1)]);
  const phases = integrated.phases.map(phase => ({ ...phase, ...serializeContactPhaseTimes(phase, entry, preservePhaseTimePrecision),
    sourceMaxSpeed: +phase.sourceMaxSpeed.toFixed(6), sourceMaxHeight: +phase.sourceMaxHeight.toFixed(6), targetMaxHeight: +phase.targetMaxHeight.toFixed(6) }));
  return { version: 1, source: 'target-stance', ...compact,
    direction: distance > .001 ? displacement.map(value => value / distance) : evidence.semantics.travelDirection,
    maxStageSpeed: integrated.evidence.maxStageSpeed, contactProbe: 'source-phase-master-skin', entryExitTravel: 'stationary', airborneTravel: 'source-root',
    contactEvidence: { version: 1, basis: 'source-and-target-skin', mesh: targetMesh, vertexCount: targetVertexCount, ...integrated.evidence, phases },
  };
}

/** Keep the tiny final donor interval when it exceeds its final 30 Hz grid key.
 * Existing reviewed plans retain their original serialized phase times. */
export function serializeContactPhaseTimes(phase, entry, preservePrecision = false) {
  return { start: preservePrecision ? phase.start + entry : +(phase.start + entry).toFixed(6),
    end: preservePrecision ? phase.end + entry : +(phase.end + entry).toFixed(6) };
}
