import { Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0), FORWARD = new Vector3(0, 0, 1);
const BELL = new Set([327, 598]), BOX = new Set([551, 611]);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

// The same stable skin vertices selected by createDoreumiContextProps on Idle.
// They include their real elbow blend instead of approximating a palm socket.
export const PROP_GRIP_SKIN = {
  L: { vertex: 78089, influences: [
    { bone: 'wristL', weight: .9893847107887268, local: [.03074913904688059, -.029495896735908578, .01718014967900966] },
    { bone: 'elbowL', weight: .01061527244746685, local: [.11774913904688067, -.1264958967359086, .04818014967900966] },
  ] },
  R: { vertex: 705, influences: [
    { bone: 'wristR', weight: .9996151924133301, local: [-.03420420210098041, -.029464875959982595, .012868045647606782] },
    { bone: 'elbowR', weight: .0003848022024612874, local: [-.12120420210098048, -.12646487595998263, .04386804564760678] },
  ] },
};

export function propGripSkin(target, side) {
  const point = new Vector3();
  for (const influence of PROP_GRIP_SKIN[side].influences) {
    const bone = target.byName.get(influence.bone);
    point.addScaledVector(new Vector3(...influence.local).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), influence.weight);
  }
  return point;
}

function headingOf(node) {
  const heading = FORWARD.clone().applyQuaternion(node.worldQuaternion).setY(0);
  return heading.lengthSq() > 1e-8 ? heading.normalize() : FORWARD.clone();
}

function limitWorldTilt(node, degrees, update) {
  const heading = headingOf(node), yaw = new Quaternion().setFromAxisAngle(UP, Math.atan2(heading.x, heading.z));
  const tilt = yaw.clone().invert().multiply(node.worldQuaternion), angle = new Quaternion().angleTo(tilt), limit = degrees * Math.PI / 180;
  if (angle <= limit) return;
  const desired = yaw.multiply(new Quaternion().slerp(tilt, limit / angle));
  node.quaternion.copy(node.parent.worldQuaternion.clone().invert().multiply(desired)); update();
}

/** Targeted carry/swing adaptation. Every position and scale stays unchanged.
 * Body tilt is moderated while the original thigh world rotations are restored,
 * preserving the source knee/foot rhythm rather than rotating legs with the torso.
 */
export function adaptPropContact(target, metadata, sourceTime, sourceDuration, update, solveHand) {
  const id = metadata.actionId;
  if (!BELL.has(id) && !BOX.has(id)) return { active: false, maxReachClamp: 0 };
  const isBell = BELL.has(id), body = target.byName.get('body');
  const sourceGripHeight = (propGripSkin(target, 'L').y + propGripSkin(target, 'R').y) / 2 - body.worldPosition.y;
  const lift = clamp((sourceGripHeight + .1) / .9, 0, 1);
  const thighs = new Map(['L', 'R'].map(side => [side, target.byName.get(`thigh${side}`).worldQuaternion.clone()]));
  limitWorldTilt(body, isBell ? 20 : 10, update);
  for (const [side, world] of thighs) {
    const thigh = target.byName.get(`thigh${side}`);
    thigh.quaternion.copy(thigh.parent.worldQuaternion.clone().invert().multiply(world));
  }
  update();
  limitWorldTilt(target.byName.get('torso'), isBell ? 25 : 10, update);
  limitWorldTilt(target.byName.get('head'), isBell ? 25 : 15, update);
  const heading = headingOf(body), right = UP.clone().cross(heading).normalize();
  const halfWidth = isBell ? .375 : .52, height = isBell ? .20 + lift * .32 : .36, forward = isBell ? .43 + lift * .10 : .40;
  const goals = {}, errors = {};
  let maxReachClamp = 0;
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1, wrist = target.byName.get(`wrist${side}`), shoulder = target.byName.get(`shoulder${side}`), arm = target.byName.get(`arm${side}`);
    const goal = body.worldPosition.clone().addScaledVector(right, halfWidth * sign).addScaledVector(UP, height).addScaledVector(heading, forward);
    wrist.quaternion.copy(wrist.restLocalQuaternion);
    const direction = goal.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
    const collar = new Quaternion().setFromUnitVectors(arm.position.clone().normalize(), direction), collarAngle = new Quaternion().angleTo(collar);
    shoulder.quaternion.copy(new Quaternion().slerp(collar, Math.min(1, 104.8 * Math.PI / 180 / collarAngle))); update();
    let reachClamp = 0;
    const wristGoal = wrist.worldPosition.clone();
    // Keep a neutral wrist and a fixed collar for the solve. Re-aiming the
    // collar every iteration makes the forearm/contact frame alternate near
    // extended poses. A damped skin-offset solve converges without that twist.
    for (let iteration = 0; iteration < 32; iteration++) {
      const next = goal.clone().sub(propGripSkin(target, side).sub(wrist.worldPosition));
      wristGoal.lerp(next, .6);
      reachClamp = solveHand(target, side, wristGoal, 1, update, new Vector3(sign, -.4, 0));
      if (propGripSkin(target, side).distanceTo(goal) < .0001) break;
    }
    maxReachClamp = Math.max(maxReachClamp, reachClamp); goals[side] = goal.toArray(); errors[side] = propGripSkin(target, side).distanceTo(goal);
  }
  return { active: true, maxReachClamp, goals, skinErrors: errors };
}
