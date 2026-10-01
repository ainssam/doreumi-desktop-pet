import { Euler, Quaternion, Vector3 } from 'three';
import { CUP_MOUTH, cupSipWeight, cupOrientation, cupGripLocal, cupRimLocal } from '../../src/lib/doreumi/motion-cup-contact.ts';
import { propGripSkin } from './meshy-prop-contact.mjs';

function limitTilt(node, degrees, update) {
  const heading = new Vector3(0, 0, 1).applyQuaternion(node.worldQuaternion).setY(0).normalize();
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(heading.x, heading.z));
  const tilt = yaw.clone().invert().multiply(node.worldQuaternion), angle = new Quaternion().angleTo(tilt);
  if (angle <= degrees * Math.PI / 180) return;
  const world = yaw.multiply(new Quaternion().slerp(tilt, degrees * Math.PI / 180 / angle));
  node.quaternion.copy(node.parent.worldQuaternion.clone().invert().multiply(world)); update();
}

export function cupMouthSkin(target) {
  const point = new Vector3();
  for (const influence of CUP_MOUTH.influences) {
    const bone = target.byName.get(influence.bone);
    point.addScaledVector(new Vector3(...influence.local).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), influence.weight);
  }
  return point;
}

/** Match the mug handle to the real palm, and its tilted rim to the rendered
 * mouth during the original source's sip phase. Segment lengths stay fixed. */
export function adaptCup(target, metadata, sourceTime, update, solveHand) {
  const id = metadata.actionId;
  if (![342, 343].includes(id)) return { active: false, maxReachClamp: 0 };
  const side = id === 343 ? 'R' : 'L', sideIndex = side === 'R' ? 1 : 0, sign = sideIndex ? -1 : 1;
  const sip = cupSipWeight(id, sourceTime), body = target.byName.get('body');
  if (id === 343) {
    // The human source reclines with its shoulders well behind its mouth.
    // Keep the seated legs while bringing the existing short arm within reach.
    const thighs = ['L', 'R'].map(side => target.byName.get(`thigh${side}`).worldQuaternion.clone());
    limitTilt(body, 12, update);
    for (const [index, side] of ['L', 'R'].entries()) {
      const thigh = target.byName.get(`thigh${side}`);
      thigh.quaternion.copy(thigh.parent.worldQuaternion.clone().invert().multiply(thighs[index]));
    }
    update();
    const torso = target.byName.get('torso'), head = target.byName.get('head');
    const forward = new Vector3(0, 0, 1).applyQuaternion(body.worldQuaternion);
    const headYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(forward.x, forward.z));
    // Align the shoulders with the cup-bearing side. The source's extra torso
    // yaw otherwise puts the palm target behind the fixed-length arm's reach.
    torso.quaternion.copy(torso.parent.worldQuaternion.clone().invert().multiply(headYaw)); update();
    limitTilt(head, 12, update);
    const headSip = headYaw.clone().multiply(new Quaternion().setFromEuler(new Euler(.5, 0, .35)));
    head.quaternion.slerp(head.parent.worldQuaternion.clone().invert().multiply(headSip), sip); update();
  }
  const heading = new Vector3(0, 0, 1).applyQuaternion(body.worldQuaternion).setY(0).normalize(), right = new Vector3(0, 1, 0).cross(heading).normalize();
  const orientation = cupOrientation(right, heading, sip, sideIndex), mouth = cupMouthSkin(target);
  const sipping = mouth.clone().addScaledVector(heading, .012).sub(cupRimLocal(sideIndex).applyQuaternion(orientation)).add(cupGripLocal().applyQuaternion(orientation));
  const goal = body.worldPosition.clone().addScaledVector(right, .44 * sign).addScaledVector(new Vector3(0, 1, 0), .40).addScaledVector(heading, .43).lerp(sipping, sip);
  const wrist = target.byName.get(`wrist${side}`), shoulder = target.byName.get(`shoulder${side}`), arm = target.byName.get(`arm${side}`), elbow = target.byName.get(`elbow${side}`);
  // This is an authored grip pose, so use one anatomical starting frame. Keeping
  // arbitrary source forearm twist here changes the IK branch between samples.
  for (const bone of [arm, elbow, wrist]) bone.quaternion.copy(bone.restLocalQuaternion);
  update();
  const direction = goal.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
  const collar = new Quaternion().setFromUnitVectors(arm.position.clone().normalize(), direction), angle = new Quaternion().angleTo(collar);
  shoulder.quaternion.copy(new Quaternion().slerp(collar, Math.min(1, 104.8 * Math.PI / 180 / Math.max(angle, 1e-8)))); update();
  const wristGoal = wrist.worldPosition.clone(); let reachClamp = 0;
  for (let iteration = 0; iteration < 32; iteration++) {
    const next = goal.clone().sub(propGripSkin(target, side).sub(wrist.worldPosition)); wristGoal.lerp(next, .6);
    reachClamp = solveHand(target, side, wristGoal, 1, update, new Vector3(sign, -.4, 0));
    if (propGripSkin(target, side).distanceTo(goal) < .0001) break;
  }
  return { active: true, maxReachClamp: reachClamp, gripError: propGripSkin(target, side).distanceTo(goal), sip };
}
