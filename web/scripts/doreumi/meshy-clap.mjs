import { Quaternion, Vector3 } from 'three';
import { closestFacingPair } from './meshy-hand-rub.mjs';

export const CLAP_ACTIONS = new Set([35, 299, 354]);
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const intervals = { 35: [1.7, 2.8, 11.2, 12.4], 299: [-.35, .65, 2.7, 3.9], 354: [-.7, -.01, 2.4, 3.33] };
export function clapWeight(actionId, sourceTime) {
  const interval = intervals[actionId]; if (!interval) return 0;
  const [start, hold, release, end] = interval;
  return smooth((sourceTime - start) / (hold - start)) * (1 - smooth((sourceTime - release) / (end - release)));
}

/** Keep the original clap rhythm, using one rest-based arm solution instead of
 * blending a partially solved arm with the humanoid source's axial wrist twist.
 * Signed clearance is measured over both complete mitten surfaces.
 */
export function adaptClap(target, source, metadata, sourceTime, update, solveHand, sampler) {
  if (!CLAP_ACTIONS.has(metadata.actionId)) return { active: false, maxReachClamp: 0 };
  if (!sampler) throw new Error('Clapping requires actual target hand surfaces');
  const weight = clapWeight(metadata.actionId, sourceTime), torso = target.byName.get('torso');
  const axis = new Vector3(1, 0, 0).applyQuaternion(torso.worldQuaternion);
  const distance = source.byName.get('LeftHand').worldPosition.distanceTo(source.byName.get('RightHand').worldPosition);
  const desiredGap = .010 + .16 * smooth((distance - .095) / .75), goals = {};
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    for (const prefix of ['shoulder', 'arm', 'elbow', 'wrist']) { const node = target.byName.get(`${prefix}${side}`); node.quaternion.copy(node.restLocalQuaternion); }
    target.byName.get(`shoulder${side}`).quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -100 * Math.PI / 180 * sign));
    goals[side] = new Vector3(.11 * sign, .18, .34).applyQuaternion(torso.worldQuaternion).add(torso.worldPosition);
  }
  update();
  const solve = side => {
    for (const prefix of ['arm', 'elbow', 'wrist']) { const node = target.byName.get(`${prefix}${side}`); node.quaternion.copy(node.restLocalQuaternion); }
    update();
    return solveHand(target, side, goals[side], 1, update, new Vector3(side === 'L' ? 1 : -1, -.4, .2));
  };
  for (const side of ['L', 'R']) solve(side);
  let maxReachClamp = 0, clearance = 0, contactGap = 0;
  for (let iteration = 0; iteration < 16; iteration++) {
    const points = sampler.sample(target), pair = closestFacingPair(points, axis);
    const project = point => point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
    clearance = Math.min(...points.L.map(project)) - Math.max(...points.R.map(project)); contactGap = pair.distance;
    const delta = pair.pair[1].clone().sub(pair.pair[0]);
    delta.addScaledVector(axis, -delta.dot(axis)).multiplyScalar(.5);
    delta.addScaledVector(axis, (.010 - clearance) * .5).multiplyScalar(.7);
    for (const side of ['L', 'R']) { goals[side].addScaledVector(delta, side === 'L' ? 1 : -1); maxReachClamp = Math.max(maxReachClamp, solve(side)); }
  }
  // A real clap opens primarily at the shoulder. Asking these very short
  // forearms to produce the whole opening as a lateral wrist translation
  // causes a large elbow bend near extension. Keep the reachable close pose
  // and open both complete arms on one continuous shoulder arc instead.
  const collars = Object.fromEntries(['L', 'R'].map(side => [side, target.byName.get(`shoulder${side}`).quaternion.clone()]));
  const open = angle => {
    for (const side of ['L', 'R']) target.byName.get(`shoulder${side}`).quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle * (side === 'L' ? 1 : -1)).multiply(collars[side]));
    update();
    const points = sampler.sample(target), project = point => point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
    return Math.min(...points.L.map(project)) - Math.max(...points.R.map(project));
  };
  if (desiredGap > .01001) {
    let low = 0, high = Math.PI / 4;
    for (let iteration = 0; iteration < 16; iteration++) { const angle = (low + high) / 2; if (open(angle) < desiredGap) low = angle; else high = angle; }
    clearance = open(high);
  }
  for (const side of ['L', 'R']) for (const prefix of ['shoulder', 'arm', 'elbow', 'wrist']) {
    const node = target.byName.get(`${prefix}${side}`); node.quaternion.copy(node.restLocalQuaternion.clone().slerp(node.quaternion, weight));
  }
  update();
  return { active: true, maxReachClamp, contactGap, clearance, desiredGap, weight };
}
