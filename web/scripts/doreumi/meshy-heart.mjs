import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

// Measured on the unchanged v3 master. Cheeks retain their real blended skin
// influences; the mitten contact vertices are fully controlled by each wrist.
export const HEART_CONTACTS = {
  L: {
    cheekVertex: 69825, handVertex: 78797,
    cheek: [
      { bone: 'head', weight: .747548520565033, local: [.4109409944993345, .1340245105955682, .24376046904113643] },
      { bone: 'torso', weight: .25245147943496704, local: [.4109409944993345, .5490245105955682, .26876046904113643] },
    ],
    normal: [.6300373397156558, .021778402735040205, .776259397198082],
    handLocal: [.06549203623657296, .033860937042078376, -.03976632057194901],
  },
  R: {
    cheekVertex: 8888, handVertex: 0,
    cheek: [
      { bone: 'head', weight: .7078088521957397, local: [-.4110341211297382, .12049864483194025, .24401300199788886] },
      { bone: 'torso', weight: .29219117760658264, local: [-.4110341211297382, .5354986448319403, .26901300199788886] },
    ],
    normal: [-.6300373397156558, .021778402735040205, .776259397198082],
    handLocal: [-.06549203690500993, .03170489302342583, -.03373258995116841],
  },
};
export const HEART_CHEEK_GAP = .014;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function heartWeight(sourceTime, sourceDuration) {
  if (!Number.isFinite(sourceTime) || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return 0;
  const phase = sourceTime / sourceDuration;
  return smooth((phase - .045) / .175) * (1 - smooth((phase - .70) / .18));
}

export function heartCheek(target, side) {
  const contact = HEART_CONTACTS[side], point = new Vector3(), normal = new Vector3();
  for (const influence of contact.cheek) {
    const bone = target.byName.get(influence.bone);
    point.addScaledVector(new Vector3(...influence.local).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), influence.weight);
    normal.addScaledVector(new Vector3(...contact.normal).applyQuaternion(bone.worldQuaternion), influence.weight);
  }
  return { point, normal: normal.normalize() };
}

function frame(normal, up) {
  const y = up.clone().addScaledVector(normal, -up.dot(normal)).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(normal, y, normal.clone().cross(y).normalize()));
}

/** A bilateral cheek heart replaces unreachable human overhead contact.
 * The original body/leg timing and every joint translation stay intact.
 * The caller injects the existing measured two-bone solver, avoiding import cycles.
 */
export function adaptHeart(target, metadata, sourceTime, sourceDuration, update, solveHand) {
  if (metadata.sourceName !== 'Big_Heart_Gesture' && metadata.actionId !== 27) return { active: false, maxReachClamp: 0 };
  const weight = heartWeight(sourceTime, sourceDuration);
  let maxReachClamp = 0;
  // Solve the complete cheek pose in one stable anatomical frame, then ease
  // that authored pose in and out. Solving a partially blended source wrist
  // lets its relative rotation cross 180 degrees and change slerp branches.
  const head = target.byName.get('head'), originalHead = head.quaternion.clone();
  const headPose = head.restLocalQuaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(.025, 0, .045 * Math.sin(sourceTime * 1.4))));
  head.quaternion.copy(headPose); update();
  const authored = new Map();
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1, wrist = target.byName.get(`wrist${side}`);
    const shoulder = target.byName.get(`shoulder${side}`), arm = target.byName.get(`arm${side}`), elbow = target.byName.get(`elbow${side}`);
    for (const bone of [shoulder, arm, elbow, wrist]) bone.quaternion.copy(bone.restLocalQuaternion);
    update();
    const cheek = heartCheek(target, side), inward = cheek.normal.clone().negate();
    const up = new Vector3(-.12 * sign, 1, 0).applyQuaternion(head.worldQuaternion);
    const orientation = frame(inward, up).multiply(frame(new Vector3(sign, 0, 0), new Vector3(0, -1, 0)).invert());
    const goal = cheek.point.clone().addScaledVector(cheek.normal, HEART_CHEEK_GAP)
      .sub(new Vector3(...HEART_CONTACTS[side].handLocal).applyQuaternion(orientation));
    // A tilted source head moves one cheek higher. Aim the existing collar
    // segment toward that cheek instead of lengthening the upper/lower arm.
    const collarDirection = goal.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
    const collar = new Quaternion().setFromUnitVectors(arm.position.clone().normalize(), collarDirection);
    shoulder.quaternion.copy(collar); update();
    maxReachClamp = Math.max(maxReachClamp, solveHand(target, side, goal, 1, update, new Vector3(sign, -.4, .2)));
    wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientation)); update();
    for (const bone of [shoulder, arm, elbow, wrist]) authored.set(bone, bone.quaternion.clone());
  }
  head.quaternion.copy(originalHead.slerp(headPose, weight));
  for (const [bone, pose] of authored) bone.quaternion.copy(bone.restLocalQuaternion.clone().slerp(pose, weight));
  update();
  return { active: true, maxReachClamp };
}
