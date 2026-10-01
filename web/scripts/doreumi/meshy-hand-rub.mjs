import { Quaternion, Vector3 } from 'three';

export function closestFacingPair(points, axis) {
  const project = point => point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
  const left = [...points.L].sort((a, b) => project(a) - project(b)).slice(0, 192);
  const right = [...points.R].sort((a, b) => project(b) - project(a)).slice(0, 192);
  let best = Infinity, pair;
  for (const a of left) for (const b of right) {
    const distance = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (distance < best) { best = distance; pair = [new Vector3(...a), new Vector3(...b)]; }
  }
  return { pair, distance: Math.sqrt(best) };
}

/** Doreumi's short forearms need a small collar turn before its real mitten
 * surfaces can meet. This does not change translations, scale, or body motion. */
export function adaptHandRub(target, source, metadata, update, solveHand, sampler) {
  if (metadata.actionId !== 318) return { active: false, maxReachClamp: 0 };
  if (!sampler) throw new Error('Hand rubbing requires the master hand surface sampler.');
  // Continuous rubbing keeps its support contact through the whole source
  // interval. The converter supplies the smooth Idle entry and recovery.
  const weight = 1;
  const axis = new Vector3(1, 0, 0).applyQuaternion(target.byName.get('torso').worldQuaternion);
  const orientations = Object.fromEntries(['L', 'R'].map(side => [side, target.byName.get(`wrist${side}`).worldQuaternion.clone()]));
  const originalGoals = Object.fromEntries(['L', 'R'].map(side => [side, target.byName.get(`wrist${side}`).worldPosition.clone()]));
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    target.byName.get(`shoulder${side}`).quaternion.slerp(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -100 * Math.PI / 180 * sign), weight);
  }
  update();
  let maxReachClamp = 0, distance = Infinity;
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1, wrist = target.byName.get(`wrist${side}`);
    maxReachClamp = Math.max(maxReachClamp, solveHand(target, side, originalGoals[side], 1, update, new Vector3(sign, -.4, .2)));
    wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientations[side])); update();
  }
  for (let iteration = 0; iteration < 5; iteration++) {
    const points = sampler.sample(target), closest = closestFacingPair(points, axis); distance = closest.distance;
    const project = point => point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
    const clearance = Math.min(...points.L.map(project)) - Math.max(...points.R.map(project));
    const delta = closest.pair[1].clone().sub(closest.pair[0]);
    delta.addScaledVector(axis, -delta.dot(axis)).multiplyScalar(.5 * weight);
    // Signed plane clearance, unlike nearest vertex distance, detects overlap.
    // Keep the two complete hand surfaces on opposite sides of a small gap.
    delta.addScaledVector(axis, (.010 - clearance) * .5 * weight);
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1, wrist = target.byName.get(`wrist${side}`), goal = wrist.worldPosition.clone().addScaledVector(delta, sign);
      maxReachClamp = Math.max(maxReachClamp, solveHand(target, side, goal, 1, update, new Vector3(sign, -.4, .2)));
      wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientations[side])); update();
    }
  }
  distance = closestFacingPair(sampler.sample(target), axis).distance;
  return { active: true, maxReachClamp, distance, weight };
}
