import { Quaternion, Vector3 } from 'three';

/** A rest-relative limit must keep the source rotation's temporal branch.
 * Independent shortest slerps choose opposite axes at 180 degrees, turning a
 * small source step into nearly 180 degrees of target wrist movement.
 * `previousLog` belongs to one bone and one source clip; it is never shared
 * across clips. Positions, scales and the source quaternion remain untouched.
 */
export function limitRestQuaternion(rest, source, limitRadians, previousLog) {
  if (!Number.isFinite(limitRadians) || limitRadians <= 0 || limitRadians > Math.PI) throw new Error('Invalid joint rotation limit');
  const relative = rest.clone().invert().multiply(source).normalize();
  if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
  const axis = new Vector3(relative.x, relative.y, relative.z), sine = axis.length();
  const angle = 2 * Math.atan2(sine, Math.max(0, relative.w));
  if (sine > 1e-10) axis.divideScalar(sine);
  else if (previousLog?.lengthSq() > 1e-16) axis.copy(previousLog).normalize();
  else axis.set(1, 0, 0);
  let log = axis.clone().multiplyScalar(angle);
  if (previousLog) {
    const winding = Math.round((previousLog.dot(axis) - angle) / (Math.PI * 2));
    let distance = Infinity;
    for (let turn = winding - 1; turn <= winding + 1; turn++) {
      const candidate = axis.clone().multiplyScalar(angle + turn * Math.PI * 2), next = candidate.distanceToSquared(previousLog);
      if (next < distance) { distance = next; log = candidate; }
    }
  }
  const magnitude = log.length(), limited = magnitude > limitRadians;
  const quaternion = magnitude < 1e-10 ? rest.clone() : rest.clone().multiply(new Quaternion().setFromAxisAngle(log.clone().divideScalar(magnitude), Math.min(magnitude, limitRadians))).normalize();
  return { quaternion, log, limited };
}
