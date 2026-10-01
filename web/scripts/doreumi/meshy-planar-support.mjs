import { Matrix4, Quaternion, Vector3 } from 'three';

export const PLANAR_SUPPORT_ACTIONS = new Set([22, 23, 24, 27, 40, 63, 67, 578, 591, 592, 596, 599]);

/** Exact root constraint for a Cartesian blend of an authored ankle (root+A)
 * and a fixed world goal G. The caller must enforce rootRadiusBound after
 * solving; only spheres containing that entire domain may be omitted. */
export function blendedContactRootConstraint(contact, { rootRadiusBound = 12, reachScale = .98 } = {}) {
  const { weight, ankleGoal, hipOffset, authoredAnkleOffset, reach } = contact;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!Number.isFinite(weight) || weight < 0 || weight > 1 || !Number.isFinite(reach) || reach <= 0
    || ![ankleGoal, hipOffset, authoredAnkleOffset].every(vector)
    || !Number.isFinite(rootRadiusBound) || rootRadiusBound <= 0 || !(reachScale > 0 && reachScale <= 1)) throw new Error('Invalid blended contact reach constraint');
  const radius = reach * (1 - (1 - reachScale) * weight);
  const offset = hipOffset.map((value, axis) => value - (1 - weight) * authoredAnkleOffset[axis] - weight * ankleGoal[axis]);
  if (Math.hypot(...offset) + weight * rootRadiusBound <= radius) return null;
  if (!weight) throw new Error('Authored leg exceeds reach independently of the root');
  if (weight < 1e-8) throw new Error('Tiny contact weight has no numerically stable bounded root constraint');
  return { ...contact, hipOffset: hipOffset.map((value, axis) => (value - (1 - weight) * authoredAnkleOffset[axis]) / weight),
    reach: radius / (weight * reachScale) };
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

/** Retain actual skin vertices, including toe joints, with stable vertex order.
 * Uses the same bind-space linear skinning as meshy-master-support.mjs. */
export function createPlanarFootSampler(document, groups, { morphWeight = 0 } = {}) {
  const retained = { L: [], R: [] }, vertexIds = { L: [], R: [] }, point = new Vector3(), inverse = new Matrix4();
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const bones = skin.listJoints(), inverseMatrices = skin.getInverseBindMatrices().getArray();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), indices = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
      if (!position || !indices || !weights) continue;
      const p = position.getArray(), j = indices.getArray(), w = weights.getArray();
      const morph = primitive.listTargets()[0]?.getAttribute('POSITION')?.getArray();
      const unique = { L: new Set(), R: new Set() };
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        const influences = Array.from({ length: 4 }, (_, component) => ({ joint: j[vertex * 4 + component], weight: w[vertex * 4 + component] })).filter(item => item.weight > 0);
        const side = ['L', 'R'].find(side => influences.reduce((sum, item) => sum + (groups[side].includes(bones[item.joint].getName()) ? item.weight : 0), 0) > .5);
        if (!side) continue;
        point.fromArray(p, vertex * 3);
        if (morph && morphWeight) point.addScaledVector(new Vector3().fromArray(morph, vertex * 3), morphWeight);
        const key = JSON.stringify([point.toArray(), influences]);
        if (unique[side].has(key)) continue;
        unique[side].add(key);
        vertexIds[side].push(vertex);
        retained[side].push(influences.map(item => ({ name: bones[item.joint].getName(), weight: item.weight,
          local: point.clone().applyMatrix4(inverse.fromArray(inverseMatrices, item.joint * 16)) })));
      }
    }
  }
  if (!retained.L.length || !retained.R.length) throw new Error('Planar support requires both actual skinned feet');
  const matrix = new Matrix4(), transformed = new Vector3();
  return { vertexIds, counts: Object.fromEntries(['L', 'R'].map(side => [side, retained[side].length])),
    sample(graph, verticalOffset = 0) {
      const matrices = new Map();
      return Object.fromEntries(['L', 'R'].map(side => [side, retained[side].map(influences => {
        const result = new Vector3(0, verticalOffset, 0);
        for (const { name, weight, local } of influences) {
          let world = matrices.get(name);
          if (!world) {
            const bone = graph.byName.get(name);
            if (!bone) throw new Error(`Missing support bone ${name}`);
            world = matrix.clone().compose(bone.worldPosition, bone.worldQuaternion, bone.worldScale); matrices.set(name, world);
          }
          result.addScaledVector(transformed.copy(local).applyMatrix4(world), weight);
        }
        return result.toArray();
      })]));
    },
  };
}

function contactPair(before, after, floor, tolerance, retainedIndex) {
  const candidates = [];
  for (let index = 0; index < after.length; index++) {
    const a = before[index], b = after[index];
    if (!a || Math.abs(a[1] - floor) > tolerance || Math.abs(b[1] - floor) > tolerance) continue;
    candidates.push({ index, before: a, after: b, displacement: distance(a, b), height: Math.max(a[1], b[1]) - floor });
  }
  if (!candidates.length) return null;
  // Keep a physical surface point through a support phase. When contact rolls
  // to a new toe/heel point, prefer the most stationary point in that patch.
  return candidates.find(point => point.index === retainedIndex)
    ?? candidates.sort((a, b) => a.displacement - b.displacement || a.height - b.height)[0];
}

/** Source frames only, before authored entry/exit. Target feet include baked Y.
 * A source foot's own displacement is retained, so deliberate gliding is not
 * converted to a planted pose. The correction cancels only retarget drift.
 * Airborne frames preserve the source root trajectory scaled by leg length. */
export function solveStationaryPlanarSupport({ times, sourceFeet, targetFeet, sourceRoots, legRatio, sourceFloor,
  targetFloor = .002, targetTolerance = .04, sourceTolerance = .04, maxOffset = 2, onSample }) {
  const count = times.length;
  if (count < 2 || sourceFeet.length !== count || targetFeet.length !== count || sourceRoots.length !== count
    || !(legRatio > 0 && Number.isFinite(legRatio)) || times.some((time, i) => !Number.isFinite(time) || (i && time <= times[i - 1]))) throw new Error('Invalid planar support samples');
  const floor = sourceFloor ?? quantile(sourceFeet.map(frame => Math.min(...frame.L.map(p => p[1]), ...frame.R.map(p => p[1]))), .1);
  const positionsXZ = [[0, 0]], retained = { L: { source: undefined, target: undefined }, R: { source: undefined, target: undefined } };
  let supportedPairs = 0, glidingPairs = 0, airbornePairs = 0, maximumResidual = 0;
  let supportSide;
  for (let index = 1; index < count; index++) {
    const options = [];
    for (const side of ['L', 'R']) {
      const source = contactPair(sourceFeet[index - 1][side], sourceFeet[index][side], floor, sourceTolerance, retained[side].source);
      const target = contactPair(targetFeet[index - 1][side], targetFeet[index][side], targetFloor, targetTolerance, retained[side].target);
      if (!source || !target) { retained[side] = { source: undefined, target: undefined }; continue; }
      retained[side] = { source: source.index, target: target.index };
      const desired = [0, 2].map(axis => (source.after[axis] - source.before[axis]) * legRatio);
      const delta = [0, 2].map((axis, component) => desired[component] - (target.after[axis] - target.before[axis]));
      options.push({ side, delta, desired, source, target });
    }
    let delta;
    if (options.length) {
      // A sliding toe may be slightly lower than the planted foot. Source
      // surface stability is authoritative; height only breaks a tie.
      options.sort((a, b) => a.source.displacement - b.source.displacement || a.source.height - b.source.height);
      const previousSupport = options.find(option => option.side === supportSide);
      const stableAllowance = .15 * (times[index] - times[index - 1]);
      const support = previousSupport && previousSupport.source.displacement <= options[0].source.displacement + stableAllowance ? previousSupport : options[0];
      supportSide = support.side; delta = support.delta; supportedPairs++;
      if (Math.hypot(...support.desired) / (times[index] - times[index - 1]) > .15) glidingPairs++;
      maximumResidual = Math.max(maximumResidual, Math.hypot(...support.desired));
    } else {
      supportSide = undefined;
      delta = [0, 2].map(axis => (sourceRoots[index][axis] - sourceRoots[index - 1][axis]) * legRatio); airbornePairs++;
    }
    const previous = positionsXZ.at(-1), position = previous.map((value, axis) => value + delta[axis]);
    if (!position.every(Number.isFinite) || Math.hypot(...position) > maxOffset) throw new Error(`Stationary planar support exceeds ${maxOffset} units at ${times[index]}s`);
    positionsXZ.push(position);
    onSample?.({ index, time: times[index], options, delta, position });
  }
  return { positionsXZ, evidence: { version: 1, maxOffset: Math.max(...positionsXZ.map(point => Math.hypot(...point))),
    sourceFloor: floor, sourceTolerance, targetFloor, targetTolerance, supportedPairs, glidingPairs, airbornePairs,
    maximumPreservedSourceContactDisplacement: maximumResidual, method: 'actual-skin-source-contact-delta-minus-target-contact-delta' } };
}

/** Smooth authored entry/exit returns the mascot to its original dock pose. */
export function envelopePlanarSupport(positionsXZ, entryFrames, exitFrames) {
  const first = positionsXZ[0], last = positionsXZ.at(-1), ease = t => t * t * (3 - 2 * t);
  return [...Array.from({ length: entryFrames }, (_, i) => first.map(value => value * ease(i / entryFrames))),
    ...positionsXZ, ...Array.from({ length: exitFrames }, (_, i) => last.map(value => value * (1 - ease((i + 1) / exitFrames))))];
}

/** Choose a temporally continuous logarithm, including across the pi branch.
 * Core weight one remains the exact solved orientation. */
export function blendContinuousQuaternion(authored, solved, weight, previousLog) {
  const relative = authored.clone().invert().multiply(solved).normalize();
  const sine = Math.hypot(relative.x, relative.y, relative.z);
  let log = new Vector3();
  if (sine > 1e-9) {
    const axis = new Vector3(relative.x, relative.y, relative.z).divideScalar(sine);
    const angle = 2 * Math.atan2(sine, relative.w);
    const center = Math.round(((previousLog?.dot(axis) ?? 0) - angle) / (2 * Math.PI));
    const candidates = [center - 1, center, center + 1].map(turn => axis.clone().multiplyScalar(angle + turn * 2 * Math.PI));
    candidates.sort((a, b) => a.distanceToSquared(previousLog ?? new Vector3()) - b.distanceToSquared(previousLog ?? new Vector3()));
    log = candidates[0];
  } else if (previousLog?.length() > Math.PI) {
    const turns = Math.round(previousLog.length() / (2 * Math.PI));
    log.copy(previousLog).normalize().multiplyScalar(turns * 2 * Math.PI);
  }
  const angle = log.length();
  const delta = angle > 1e-9 ? new Quaternion().setFromAxisAngle(log.clone().divideScalar(angle), angle * weight) : new Quaternion();
  return { quaternion: weight === 1 ? solved.clone() : authored.clone().multiply(delta), log };
}

/** Fixed-length leg IK. The zero-length shin spacer keeps its authored rotation;
 * knee rotation is solved only once. Preserve the foot's world orientation. */
export function solvePlanarFoot(target, side, goal, update, previousPole, weight = 1, forcedPole, preserveTwist = false) {
  const hip = target.byName.get(`thigh${side}`), knee = target.byName.get(`knee${side}`), foot = target.byName.get(`foot${side}`);
  const origin = hip.worldPosition.clone(), upper = knee.worldPosition.distanceTo(origin), lower = foot.worldPosition.distanceTo(knee.worldPosition);
  const footRotation = foot.worldQuaternion.clone(), initialHip = hip.quaternion.clone(), initialKnee = knee.quaternion.clone();
  const direction = goal.clone().sub(origin), requested = direction.length();
  if (requested < 1e-8) throw new Error('Degenerate foot IK goal');
  direction.normalize();
  const reach = Math.max(Math.abs(upper - lower) + 1e-5, Math.min(upper + lower - 1e-5, requested));
  const pole = knee.worldPosition.clone().sub(origin).addScaledVector(direction, -knee.worldPosition.clone().sub(origin).dot(direction));
  // Parallel-transport the previous physical bend plane along the new goal
  // axis. Resetting to the authored plane each sample made clearance branches
  // alternate, with compensating hip/foot rotations that spun between keys.
  const transportedPole = forcedPole ?? previousPole;
  if (transportedPole) pole.copy(transportedPole).addScaledVector(direction, -transportedPole.dot(direction));
  if (pole.lengthSq() < 1e-8) {
    pole.copy(previousPole ?? new Vector3(0, 0, 1).applyQuaternion(target.byName.get('body').worldQuaternion));
    pole.addScaledVector(direction, -pole.dot(direction));
  }
  if (pole.lengthSq() < 1e-8) pole.set(side === 'L' ? 1 : -1, 0, 0).addScaledVector(direction, -direction.x * (side === 'L' ? 1 : -1));
  pole.normalize();
  if (previousPole && !forcedPole && pole.dot(previousPole) < 0) pole.negate();
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const kneeGoal = origin.clone().addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  // Fix the axial-twist degree of freedom explicitly. Incrementally rotating
  // the current segment preserves an arbitrary twist that can wind around the
  // chain; compensating foot rotations then spin during independent slerp.
  const orient = (node, localDirection, worldDirection) => {
    const basis = (segment, normal) => {
      const y = segment.clone().normalize();
      const x = normal.clone().addScaledVector(y, -normal.dot(y)).normalize();
      if (x.lengthSq() < 1e-10) throw new Error('Degenerate anatomical knee-plane basis');
      const z = x.clone().cross(y).normalize();
      return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    };
    const localNormal = localDirection.clone().cross(new Vector3(0, 0, 1)).normalize();
    const worldNormal = direction.clone().cross(pole).normalize();
    const localBasis = basis(localDirection, localNormal);
    const worldBasis = basis(worldDirection, worldNormal);
    node.quaternion.copy(node.parent.worldQuaternion.clone().invert().multiply(worldBasis).multiply(localBasis.invert()));
    update();
  };
  const reachable = origin.clone().addScaledVector(direction, reach);
  if (preserveTwist) {
    const upperDelta = new Quaternion().setFromUnitVectors(knee.worldPosition.clone().sub(origin).normalize(), kneeGoal.clone().sub(origin).normalize());
    hip.quaternion.copy(hip.parent.worldQuaternion.clone().invert().multiply(upperDelta.multiply(hip.worldQuaternion))); update();
    const lowerDelta = new Quaternion().setFromUnitVectors(foot.worldPosition.clone().sub(knee.worldPosition).normalize(), reachable.clone().sub(knee.worldPosition).normalize());
    knee.quaternion.copy(knee.parent.worldQuaternion.clone().invert().multiply(lowerDelta.multiply(knee.worldQuaternion))); update();
  } else {
    orient(hip, knee.position, kneeGoal.clone().sub(origin));
    const shin = target.byName.get(`shin${side}`);
    const lowerLocal = foot.position.clone().multiply(shin.scale).applyQuaternion(shin.quaternion).add(shin.position);
    orient(knee, lowerLocal, reachable.sub(knee.worldPosition));
  }
  if (weight < 1) { hip.quaternion.copy(initialHip.slerp(hip.quaternion, weight)); knee.quaternion.copy(initialKnee.slerp(knee.quaternion, weight)); }
  update(); foot.quaternion.copy(foot.parent.worldQuaternion.clone().invert().multiply(footRotation)); update();
  return { pole, reachClamp: Math.max(0, requested - upper - lower) };
}

/** Retarget the donor leg's geometric direction and knee flexion before
 * grounding. Bone rotation deltas alone do not preserve these quantities when
 * the target knee/ankle rest offsets differ from the donor skeleton. */
export function retargetSourceLegPose(target, sourceLegs, update) {
  for (const side of ['L', 'R']) {
    const source = sourceLegs[side];
    const sourceHip = new Vector3().fromArray(source.hip), sourceKnee = new Vector3().fromArray(source.knee), sourceFoot = new Vector3().fromArray(source.foot);
    const a = sourceKnee.distanceTo(sourceHip), b = sourceFoot.distanceTo(sourceKnee), d = sourceFoot.distanceTo(sourceHip);
    if (a < 1e-6 || b < 1e-6 || d < 1e-6) throw new Error('Degenerate donor leg geometry');
    const hip = target.byName.get(`thigh${side}`), knee = target.byName.get(`knee${side}`), foot = target.byName.get(`foot${side}`);
    const upper = hip.worldPosition.distanceTo(knee.worldPosition), lower = knee.worldPosition.distanceTo(foot.worldPosition);
    const cosine = Math.max(-1, Math.min(1, (a*a+b*b-d*d)/(2*a*b)));
    const desired = Math.sqrt(Math.max(1e-10, upper*upper+lower*lower-2*upper*lower*cosine));
    const direction = sourceFoot.sub(sourceHip).normalize(), pole = sourceKnee.sub(sourceHip);
    pole.addScaledVector(direction, -pole.dot(direction));
    const reference = pole.lengthSq() > 1e-10 ? pole.normalize() : undefined;
    solvePlanarFoot(target, side, hip.worldPosition.clone().addScaledVector(direction, desired), update, undefined, 1, reference, true);
  }
}

/** Correct short legs against source support phases using actual skin anchors. */
export function createStationaryFootContactAdapter({ sourceFeet, sourceTimes, sourceFloor, legRatio, sourceLegFrames, targetSampler, targetLegSampler, plannedTargetFeet, plannedRootPath, plannedContactFrames, plannedPoleAngles, probePoleIntervals = false, onFrame,
  sourceTolerance = .04, targetFloor = .002, virtualRootBound = 2, preserveSourceTwist = true, preparationDuration = .25 }) {
  if (!Number.isFinite(virtualRootBound) || virtualRootBound <= 0 || virtualRootBound > 12) throw new Error('Offline virtualRootBound must be finite, positive, and at most 12 units.');
  if (typeof preserveSourceTwist !== 'boolean') throw new Error('Offline preserveSourceTwist must be boolean.');
  if (!Number.isFinite(preparationDuration) || preparationDuration < .1 || preparationDuration > .75) throw new Error('Offline preparationDuration must be between .1 and .75 seconds.');
  const states = { L: null, R: null }, poles = { L: undefined, R: undefined };
  let previousSkin, lastFrameIndex;
  const previousDebugGoals = { L: null, R: null };
  const previousRotations = { L: null, R: null };
  const phasePoleAngles = { L: 0, R: 0 };
  const warmLogs = { L: {}, R: {} };
  const transitionDuration = .25, ease = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  const advanceGoal = (state, side, index, previousIndex) => {
    const before = sourceFeet[previousIndex][side][state.sourceIndex], after = sourceFeet[index][side][state.sourceIndex];
    state.goal.x += (after[0] - before[0]) * legRatio;
    state.goal.z += (after[2] - before[2]) * legRatio;
    state.goal.y = targetFloor + Math.max(0, after[1] - sourceFloor) * legRatio;
  };
  const evidence = { version: 1, correctedFrames: 0, maxSkinError: 0, maxReachClamp: 0, maxPelvisLowering: 0, maxPlanarRecentering: 0, maxKneePlaneAdjustment: 0, method: 'source-phase-actual-skin-fixed-length-two-bone-IK' };
  return { evidence,
    synchronizeGrounding(target) {
      previousSkin = targetSampler.sample(target);
      onFrame?.({ phase: 'after-grounding', index: lastFrameIndex, root: target.byName.get('DoreumiRig').position.toArray() });
    },
    apply(target, index, update) {
      lastFrameIndex = index;
      const authoredRoot = target.byName.get('DoreumiRig').position.toArray();
      const framePoles = { L: poles.L?.clone(), R: poles.R?.clone() };
      const sourcePoleBases = {};
      if (plannedRootPath?.[index]) { target.byName.get('DoreumiRig').position.fromArray(plannedRootPath[index]); update(); }
      const debug = onFrame ? { index, time: sourceTimes[index], authoredRoot, initialRoot: target.byName.get('DoreumiRig').position.toArray(),
        previousPoles: Object.fromEntries(['L', 'R'].map(side => [side, poles[side]?.toArray() ?? null])), iterations: [], clearances: [] } : null;
      if (debug && sourceLegFrames) debug.sourceLegs = sourceLegFrames[index];
      const authoredLegs = Object.fromEntries(['L', 'R'].map(side => [side, {
        thigh: target.byName.get(`thigh${side}`).quaternion.clone(), knee: target.byName.get(`knee${side}`).quaternion.clone(),
        footWorld: target.byName.get(`foot${side}`).worldQuaternion.clone(),
        hipPosition: target.byName.get(`thigh${side}`).worldPosition.clone(),
        kneePosition: target.byName.get(`knee${side}`).worldPosition.clone(),
        footPosition: target.byName.get(`foot${side}`).worldPosition.clone(),
      }]));
      let sampled = targetSampler.sample(target);
      const authoredSkin = sampled;
      if (!index) previousSkin = sampled;
      const previousIndex = Math.max(0, index - 1);
      const dt = index ? sourceTimes[index] - sourceTimes[index - 1] : 0, constraints = [];
      for (const side of ['L', 'R']) {
        const old = states[side];
        let pair = contactPair(sourceFeet[previousIndex][side], sourceFeet[index][side], sourceFloor, sourceTolerance, old?.sourceIndex);
        // Contact begins at the first near-floor sample, not one frame later.
        // A future confirmed pair supplies phase evidence, never future motion.
        if (!pair && index + 1 < sourceFeet.length) {
          const landing = contactPair(sourceFeet[index][side], sourceFeet[index + 1][side], sourceFloor, sourceTolerance, old?.sourceIndex);
          if (landing) pair = { ...landing, before: landing.before, after: landing.before };
        }
        if (pair) {
          let state = old;
          if (!state || state.releasing || state.sourceIndex !== pair.index) {
            const points = sampled[side];
            const targetIndex = points.reduce((best, point, candidate) => Math.abs(point[1] - targetFloor) < Math.abs(points[best][1] - targetFloor) ? candidate : best, 0);
            const goal = new Vector3().fromArray(previousSkin?.[side][targetIndex] ?? points[targetIndex]);
            if (old && !old.releasing && !old.anticipating && previousSkin) {
              // A heel/toe material-point change is still the same stance.
              // Carry the desired foot transform, not an earlier unreachable
              // solver's actual drift, into the replacement surface anchor.
              goal.copy(old.goal).add(new Vector3().fromArray(previousSkin[side][targetIndex]).sub(new Vector3().fromArray(previousSkin[side][old.targetIndex])));
            }
            goal.add(new Vector3().fromArray(pair.after).sub(new Vector3().fromArray(pair.before)).multiplyScalar(legRatio));
            goal.y = targetFloor + Math.max(0, pair.after[1] - sourceFloor) * legRatio;
            state = { sourceIndex: pair.index, targetIndex, goal, releasing: 0 };
          } else {
            state.goal.x += (pair.after[0] - pair.before[0]) * legRatio;
            state.goal.z += (pair.after[2] - pair.before[2]) * legRatio;
            state.goal.y = targetFloor + Math.max(0, pair.after[1] - sourceFloor) * legRatio;
          }
          state.anticipating = false;
          states[side] = state; constraints.push({ side, state, weight: 1 });
        } else {
          // Prepare the landing outside its planted core. The goal follows the
          // source foot's current trajectory toward a known future contact;
          // source motion is never held frozen at an old floor point.
          let landing;
          if (plannedTargetFeet) for (let future = index + 1; future + 1 < sourceFeet.length && sourceTimes[future] - sourceTimes[index] <= preparationDuration; future++) {
            const contact = contactPair(sourceFeet[future][side], sourceFeet[future + 1][side], sourceFloor, sourceTolerance, old?.sourceIndex);
            if (contact) { landing = { future, contact }; break; }
          }
          if (old?.anticipating && landing) {
            advanceGoal(old, side, index, previousIndex);
            constraints.push({ side, state: old, weight: ease(1 - (old.landingTime - sourceTimes[index]) / preparationDuration) });
          } else if (old && landing) {
            // A short hop has overlapping release and landing envelopes. Keep
            // following the same physical point across that overlap instead of
            // dropping IK for one frame and re-entering at a large weight.
            advanceGoal(old, side, index, previousIndex);
            old.releasing += dt;
            const releasing = 1 - ease(old.releasing / transitionDuration);
            const approaching = ease(1 - (sourceTimes[landing.future] - sourceTimes[index]) / preparationDuration);
            constraints.push({ side, state: old, weight: 1 - (1 - releasing) * (1 - approaching) });
          } else if (landing && !old) {
            const { future, contact } = landing, points = plannedTargetFeet[future][side];
            const targetIndex = points.reduce((best, point, candidate) => Math.abs(point[1] - targetFloor) < Math.abs(points[best][1] - targetFloor) ? candidate : best, 0);
            const currentSource = sourceFeet[index][side][contact.index];
            const goal = new Vector3().fromArray(points[targetIndex]).add(new Vector3().fromArray(currentSource).sub(new Vector3().fromArray(contact.before)).multiplyScalar(legRatio));
            goal.y = targetFloor + Math.max(0, currentSource[1] - sourceFloor) * legRatio;
            const state = { sourceIndex: contact.index, targetIndex, goal, releasing: 0, anticipating: true, landingTime: sourceTimes[future] };
            states[side] = state;
            constraints.push({ side, state, weight: ease(1 - (state.landingTime - sourceTimes[index]) / preparationDuration) });
          } else if (old && (old.releasing += dt) < transitionDuration) {
            advanceGoal(old, side, index, previousIndex);
            constraints.push({ side, state: old, weight: 1 - ease(old.releasing / transitionDuration) });
          } else states[side] = null;
        }
      }
      for (const constraint of constraints) {
        const planned = plannedContactFrames?.[index]?.[constraint.side];
        if (planned) {
          constraint.state.goal.fromArray(planned.goal);
          constraint.state.targetIndex = planned.targetIndex;
          constraint.state.sourceIndex = planned.sourceIndex;
        }
      }
      for (const constraint of constraints) {
        constraint.solveGoal = new Vector3().fromArray(authoredSkin[constraint.side][constraint.state.targetIndex]).lerp(constraint.state.goal, constraint.weight);
      }
      if (!constraints.length) {
        previousSkin = sampled;
        for (const side of ['L', 'R']) previousRotations[side] = { thigh: authoredLegs[side].thigh.clone(), knee: authoredLegs[side].knee.clone() };
        if (debug) onFrame({ ...debug, phase: 'solved', constraints: [], finalRoot: target.byName.get('DoreumiRig').position.toArray() });
        return;
      }
      // Warm-start the chain from its previous solved pose. Merely transporting
      // its geometric pole still allowed authored axial twist to choose a new
      // compensating hip/knee/foot branch at every sample.
      for (const { side, weight } of constraints) if (previousRotations[side]) {
        for (const name of ['thigh', 'knee']) {
          const warm = blendContinuousQuaternion(authoredLegs[side][name], previousRotations[side][name], weight, warmLogs[side][name]);
          warmLogs[side][name] = warm.log;
          target.byName.get(`${name}${side}`).quaternion.copy(warm.quaternion);
        }
      }
      update();
      for (const { side } of constraints) {
        const foot = target.byName.get(`foot${side}`);
        foot.quaternion.copy(foot.parent.worldQuaternion.clone().invert().multiply(authoredLegs[side].footWorld));
      }
      update();
      const root = target.byName.get('DoreumiRig');
      const originalRootY = root.position.y;
      const originalRootXZ = [root.position.x, root.position.z];
      const solveContactLeg = (side, goal, weight = 1) => {
      const preserveTwist = preserveSourceTwist;
      const phaseConstraint = constraints.find(item => item.side === side);
      const phaseWeight = phaseConstraint?.weight ?? 0;
      if (phaseWeight === 1 || phaseWeight === 0) phasePoleAngles[side] = 0;
      let previousPole = phaseWeight < 1 ? phaseConstraint?.state.contactPole ?? framePoles[side] : framePoles[side];
      if (phaseWeight < 1) {
        const axis = goal.clone().sub(target.byName.get(`thigh${side}`).worldPosition).normalize();
        const authoredAxis = authoredLegs[side].footPosition.clone().sub(authoredLegs[side].hipPosition).normalize();
        const authoredPole = authoredLegs[side].kneePosition.clone().sub(authoredLegs[side].hipPosition);
        authoredPole.addScaledVector(authoredAxis, -authoredPole.dot(authoredAxis));
        const authoredBend = authoredPole.length();
        authoredPole.applyQuaternion(new Quaternion().setFromUnitVectors(authoredAxis, axis));
        if (debug) (debug.poleReferences ??= []).push({side,phaseWeight,authoredBend,hip:authoredLegs[side].hipPosition.toArray(),knee:authoredLegs[side].kneePosition.toArray(),foot:authoredLegs[side].footPosition.toArray()});
        if (authoredPole.lengthSq() > 1e-8) {
          authoredPole.normalize();
          if (previousPole) {
            const reference = previousPole.clone().addScaledVector(axis, -previousPole.dot(axis)).normalize();
            const rawAngle = Math.atan2(axis.dot(authoredPole.clone().cross(reference)), authoredPole.dot(reference));
            const angle = rawAngle + 2 * Math.PI * Math.round((phasePoleAngles[side] - rawAngle) / (2 * Math.PI));
            if (debug) (debug.poleAngles ??= []).push({side,phaseWeight,rawAngle,angle,previous:phasePoleAngles[side]});
            phasePoleAngles[side] = phaseWeight ? angle : 0;
            previousPole = authoredPole.applyAxisAngle(axis, angle * phaseWeight);
          } else previousPole = authoredPole;
        }
      }
      const sourceLeg = sourceLegFrames?.[index]?.[side];
      if (sourceLeg) {
        const sourceHip = new Vector3().fromArray(sourceLeg.hip), sourceKnee = new Vector3().fromArray(sourceLeg.knee), sourceFoot = new Vector3().fromArray(sourceLeg.foot);
        const sourceAxis = sourceFoot.sub(sourceHip).normalize(), goalAxis = goal.clone().sub(target.byName.get(`thigh${side}`).worldPosition).normalize();
        const sourcePole = sourceKnee.sub(sourceHip);
        sourcePole.addScaledVector(sourceAxis, -sourcePole.dot(sourceAxis));
        const bend = sourcePole.length();
        sourcePole.applyQuaternion(new Quaternion().setFromUnitVectors(sourceAxis, goalAxis));
        if (bend > 1e-6) {
          sourcePole.normalize();
          const previous = framePoles[side]?.clone().addScaledVector(goalAxis, -framePoles[side].dot(goalAxis)).normalize();
          if (bend < .01 && previous && sourcePole.dot(previous) < 0) sourcePole.negate();
          const strength = Math.min(1, bend / .02);
          previousPole = previous ? previous.lerp(sourcePole, strength * strength * (3 - 2 * strength)).normalize() : sourcePole;
        }
        sourcePoleBases[side] = previousPole?.clone();
        if (debug) (debug.sourcePoles ??= []).push({ side, bend, pole: previousPole?.toArray() });
      }
      if (previousPole && plannedPoleAngles?.[index]?.[side]) {
        const axis = goal.clone().sub(target.byName.get(`thigh${side}`).worldPosition).normalize();
        previousPole = previousPole.clone().applyAxisAngle(axis, plannedPoleAngles[index][side]);
      }
      target.byName.get(`thigh${side}`).quaternion.copy(authoredLegs[side].thigh);
      target.byName.get(`knee${side}`).quaternion.copy(authoredLegs[side].knee); update();
      const authoredFoot = target.byName.get(`foot${side}`);
      authoredFoot.quaternion.copy(authoredFoot.parent.worldQuaternion.clone().invert().multiply(authoredLegs[side].footWorld)); update();
      let solved = solvePlanarFoot(target, side, goal, update, previousPole, weight, undefined, preserveTwist);
      // The broad calf can hit the floor even with an exact ankle goal.
      // Rotate the bend plane, preserving both segment lengths and the foot
      // orientation, before allowing a whole-body lift to undo contact.
      if (targetLegSampler && weight === 1) {
        const minimum = () => Math.min(...targetLegSampler.sample(target)[side].map(point => point[1]));
        let bestHeight = minimum();
        if (bestHeight < targetFloor - .001) {
          const nodes = [`thigh${side}`, `knee${side}`, `foot${side}`].map(name => target.byName.get(name));
          const initial = nodes.map(node => node.quaternion.clone());
          const basePole = solved.pole.clone(), axis = goal.clone().sub(nodes[0].worldPosition).normalize();
          let best = initial, bestPole = basePole, bestAngle = 0, signedAngle = 0;
          const evaluate = angle => {
            nodes.forEach((node, i) => node.quaternion.copy(initial[i])); update();
            const candidate = basePole.clone().applyAxisAngle(axis, angle);
            const result = solvePlanarFoot(target, side, goal, update, previousPole, weight, candidate, preserveTwist);
            return { angle, height: minimum(), rotations: nodes.map(node => node.quaternion.clone()), pole: result.pole };
          };
          const feasible = [];
          for (const sign of [1, -1]) {
            let lower = 0;
            for (const degrees of [15, 30, 45, 60, 75, 90]) {
              let upper = degrees * Math.PI / 180;
              const result = evaluate(sign * upper);
              if (result.height > bestHeight) {
                bestHeight = result.height; best = result.rotations; bestPole = result.pole; bestAngle = upper; signedAngle = sign * upper;
              }
              if (result.height >= targetFloor - .001) {
                let boundary = result;
                for (let step = 0; step < 12; step++) {
                  const middle = (lower + upper) / 2, candidate = evaluate(sign * middle);
                  if (candidate.height >= targetFloor - .001) { upper = middle; boundary = candidate; } else lower = middle;
                }
                feasible.push(boundary); break;
              }
              lower = upper;
            }
          }
          if (feasible.length) {
            feasible.sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle));
            const chosen = feasible[0]; bestHeight = chosen.height; best = chosen.rotations; bestPole = chosen.pole;
            bestAngle = Math.abs(chosen.angle); signedAngle = chosen.angle;
          }
          debug?.clearances.push({ side, bestAngle, signedAngle, bestHeight, basePole: basePole.toArray(), chosenPole: bestPole.toArray() });
          nodes.forEach((node, i) => node.quaternion.copy(best[i])); update();
          solved = { ...solved, pole: bestPole };
          evidence.maxKneePlaneAdjustment = Math.max(evidence.maxKneePlaneAdjustment, bestAngle);
        }
      }
      poles[side] = solved.pole;
      evidence.maxReachClamp = Math.max(evidence.maxReachClamp, solved.reachClamp);
      };
      for (let iteration = 0; iteration < 8; iteration++) {
        sampled = targetSampler.sample(target);
        let lowerBy = 0;
        const goals = constraints.map(constraint => {
          const { side, state } = constraint, foot = target.byName.get(`foot${side}`), hip = target.byName.get(`thigh${side}`), knee = target.byName.get(`knee${side}`);
          const goal = foot.worldPosition.clone().add(constraint.solveGoal.clone().sub(new Vector3().fromArray(sampled[side][state.targetIndex])));
          const reach = hip.worldPosition.distanceTo(knee.worldPosition) + knee.worldPosition.distanceTo(foot.worldPosition) - .0001;
          if (debug) debug.iterations.push({ iteration, side, weight: constraint.weight, root: root.position.toArray(), hip: hip.worldPosition.toArray(),
            goal: goal.toArray(), requestedDistance: hip.worldPosition.distanceTo(goal), reach,
            reachRatio: hip.worldPosition.distanceTo(goal) / reach, pole: poles[side]?.toArray() ?? null });
          return { ...constraint, goal, reach };
        });
        // A planted foot cannot follow an authored hip beyond the short leg's
        // reach. Move the pelvis over the support polygon instead of lengthening
        // either segment or accepting an airborne "contact" target.
        const shift = new Vector3(); let outside = 0;
        for (const { side, goal, reach, weight } of goals) {
          if (weight <= 0) continue;
          const hip = target.byName.get(`thigh${side}`).worldPosition;
          const dx = goal.x - hip.x, dz = goal.z - hip.z, horizontal = Math.hypot(dx, dz);
          const vertical = Math.max(0, hip.y - goal.y - Math.max(0, .12 - (originalRootY - root.position.y)));
          const allowed = Math.sqrt(Math.max(.0001, reach * reach - vertical * vertical));
          if (horizontal > allowed) { shift.x += dx * (horizontal - allowed) / horizontal * weight; shift.z += dz * (horizontal - allowed) / horizontal * weight; outside++; }
        }
        if (outside && !plannedRootPath) {
          root.position.x += shift.x / outside * .85; root.position.z += shift.z / outside * .85; update();
          if (Math.hypot(root.position.x, root.position.z) > virtualRootBound) throw new Error('Contact pelvis recentering exceeds the bounded planar contract');
          evidence.maxPlanarRecentering = Math.max(evidence.maxPlanarRecentering, Math.hypot(root.position.x - originalRootXZ[0], root.position.z - originalRootXZ[1]));
        }
        for (const { side, goal, reach, weight } of goals) {
          const hip = target.byName.get(`thigh${side}`).worldPosition, horizontal = Math.hypot(goal.x - hip.x, goal.z - hip.z);
          if (horizontal < reach && hip.y > goal.y) lowerBy = Math.max(lowerBy, (hip.y - goal.y - Math.sqrt(reach * reach - horizontal * horizontal)) * weight);
        }
        lowerBy = Math.max(0, Math.min(.12 - (originalRootY - root.position.y), lowerBy));
        if (lowerBy > 0 && !plannedRootPath) { root.position.y -= lowerBy; update(); evidence.maxPelvisLowering = Math.max(evidence.maxPelvisLowering, originalRootY - root.position.y); }
        for (const { side, goal, weight } of goals) {
          solveContactLeg(side, goal);
        }
        // Pelvis lowering also moves the unconstrained swing leg. Correct its
        // floor collision locally rather than lifting the planted leg with it.
        const clearanceSkin = targetSampler.sample(target);
        for (const side of ['L', 'R']) {
          const lift = targetFloor - Math.min(...clearanceSkin[side].map(point => point[1]));
          if (lift <= .00001) continue;
          const foot = target.byName.get(`foot${side}`);
          const goal = foot.worldPosition.clone().add(new Vector3(0, lift, 0));
          solveContactLeg(side, goal);
        }
      }
      // Cartesian transition goals are solved above; restore authored foot
      // orientation once before checking the final surface constraints.
      update();
      for (const { side } of constraints) {
        const foot = target.byName.get(`foot${side}`);
        foot.quaternion.copy(foot.parent.worldQuaternion.clone().invert().multiply(authoredLegs[side].footWorld));
      }
      update();
      // Coupled leg corrections can move the opposite sole below the floor.
      // Enforce the surface constraint on the final pose, before the caller's
      // whole-body grounding can lift the opposite planted foot.
      for (let correction = 0; correction < 8; correction++) {
        const finalSkin = targetSampler.sample(target);
        let changed = false;
        for (const side of ['L', 'R']) {
          const lift = targetFloor - Math.min(...finalSkin[side].map(point => point[1]));
          if (lift <= .00001) continue;
          solveContactLeg(side, target.byName.get(`foot${side}`).worldPosition.clone().add(new Vector3(0, lift, 0)));
          changed = true;
        }
        if (!changed) break;
      }
      if (probePoleIntervals && debug && targetLegSampler) {
        debug.poleIntervals = {};
        for (const side of ['L', 'R']) {
          const base = sourcePoleBases[side];
          if (!base) continue;
          const nodes = [`thigh${side}`, `knee${side}`, `foot${side}`].map(name => target.byName.get(name));
          const saved = nodes.map(node => node.quaternion.clone());
          const goal = nodes[2].worldPosition.clone(), axis = goal.clone().sub(nodes[0].worldPosition).normalize();
          const footWorld = nodes[2].worldQuaternion.clone();
          const clear = angle => {
            nodes[0].quaternion.copy(authoredLegs[side].thigh); nodes[1].quaternion.copy(authoredLegs[side].knee); update();
            nodes[2].quaternion.copy(nodes[2].parent.worldQuaternion.clone().invert().multiply(footWorld)); update();
            solvePlanarFoot(target, side, goal, update, undefined, 1, base.clone().applyAxisAngle(axis, angle), true);
            const calf = targetLegSampler.sample(target)[side], sole = targetSampler.sample(target)[side];
            return Math.min(...calf.map(point => point[1]), ...sole.map(point => point[1])) >= targetFloor - .001;
          };
          const grid = Array.from({ length: 37 }, (_, i) => ({ angle: (i - 18) * Math.PI / 36 }));
          for (const point of grid) point.clear = clear(point.angle);
          const boundary = (a, b, wantClear) => { for (let iteration = 0; iteration < 10; iteration++) { const middle = (a+b)/2; if(clear(middle) === wantClear) b=middle; else a=middle; } return b; };
          const intervals = [];
          for (let i = 0; i < grid.length; i++) if (grid[i].clear) {
            const start = i;
            while (i+1<grid.length && grid[i+1].clear) i++;
            const minimum = start ? boundary(grid[start-1].angle,grid[start].angle,true) : grid[start].angle;
            const maximum = i+1<grid.length ? boundary(grid[i+1].angle,grid[i].angle,true) : grid[i].angle;
            intervals.push({ minimum, maximum });
          }
          nodes.forEach((node,i)=>node.quaternion.copy(saved[i])); update();
          debug.poleIntervals[side] = { intervals, goal: goal.toArray(), base: base.toArray() };
        }
      }
      for (const side of ['L', 'R']) previousRotations[side] = {
        thigh: target.byName.get(`thigh${side}`).quaternion.clone(), knee: target.byName.get(`knee${side}`).quaternion.clone(),
      };
      sampled = targetSampler.sample(target);
      for (const { side, state, weight } of constraints) if (weight === 1 && poles[side]) state.contactPole = poles[side].clone();
      previousSkin = sampled;
      for (const { side, state, weight } of constraints) if (weight === 1) {
        const error = new Vector3().fromArray(sampled[side][state.targetIndex]).distanceTo(state.goal);
        if (error > evidence.maxSkinError) {
          evidence.maxSkinError = error;
          evidence.worstFrame = { index, time: sourceTimes[index], side, goal: state.goal.toArray(), actual: sampled[side][state.targetIndex],
            root: root.position.toArray(), hip: target.byName.get(`thigh${side}`).worldPosition.toArray(), sourceVertex: state.sourceIndex };
        }
      }
      if (debug) {
        debug.constraints = constraints.map(({ side, state, weight }) => {
          const old = previousDebugGoals[side], goal = state.goal.toArray();
          const hip = target.byName.get(`thigh${side}`), knee = target.byName.get(`knee${side}`), foot = target.byName.get(`foot${side}`);
          const ankleGoal = foot.worldPosition.clone().add(state.goal.clone().sub(new Vector3().fromArray(sampled[side][state.targetIndex])));
          const row = { side, ankleGoal: ankleGoal.toArray(), authoredAnkleOffset: authoredLegs[side].footPosition.clone().sub(new Vector3().fromArray(debug.initialRoot)).toArray(), hipOffset: hip.worldPosition.clone().sub(root.position).toArray(),
            reach: hip.worldPosition.distanceTo(knee.worldPosition) + knee.worldPosition.distanceTo(foot.worldPosition),
            sourceIndex: state.sourceIndex, targetIndex: state.targetIndex, weight, anticipating: Boolean(state.anticipating),
            releasing: state.releasing, goal, goalVelocity: old && dt ? state.goal.distanceTo(new Vector3().fromArray(old.goal)) / dt : null,
            changedTargetIndex: Boolean(old && old.targetIndex !== state.targetIndex), changedSourceIndex: Boolean(old && old.sourceIndex !== state.sourceIndex),
            pole: poles[side]?.toArray() ?? null, poleDotPrevious: debug.previousPoles[side] && poles[side] ? poles[side].dot(new Vector3().fromArray(debug.previousPoles[side])) : null };
          previousDebugGoals[side] = row; return row;
        });
        onFrame({ ...debug, phase: 'solved', finalRoot: root.position.toArray() });
      }
      evidence.correctedFrames++;
    },
  };
}
