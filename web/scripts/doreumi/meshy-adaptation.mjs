import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { auditMotionContext } from './meshy-context-audit.mjs';
import { HEART_CONTACTS, HEART_CHEEK_GAP, heartCheek } from './meshy-heart.mjs';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Two bone solve keeps both measured target segment lengths unchanged. */
export function solveHand(target, side, goal, weight, update, localPole) {
  if (weight <= .001) return 0;
  const arm = target.byName.get(`arm${side}`), elbow = target.byName.get(`elbow${side}`), wrist = target.byName.get(`wrist${side}`);
  const origin = arm.worldPosition.clone(), a = elbow.position.length(), b = wrist.position.length();
  const direction = goal.clone().sub(origin), requested = direction.length();
  const distance = Math.max(Math.abs(a - b) + .001, Math.min(a + b - .001, requested)); direction.normalize();
  const pole = (localPole ?? new Vector3(side === 'L' ? .4 : -.4, -.25, 1)).clone().applyQuaternion(target.byName.get('torso').worldQuaternion);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, a * a - along * along));
  const elbowGoal = origin.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
  const initialArm = arm.quaternion.clone(), initialElbow = elbow.quaternion.clone();
  const upperDelta = new Quaternion().setFromUnitVectors(elbow.worldPosition.clone().sub(origin).normalize(), elbowGoal.clone().sub(origin).normalize());
  arm.quaternion.copy(arm.parent.worldQuaternion.clone().invert().multiply(upperDelta.multiply(arm.worldQuaternion)));
  update();
  const reachableGoal = origin.clone().addScaledVector(direction, distance);
  const lowerDelta = new Quaternion().setFromUnitVectors(wrist.worldPosition.clone().sub(elbow.worldPosition).normalize(), reachableGoal.clone().sub(elbow.worldPosition).normalize());
  elbow.quaternion.copy(elbow.parent.worldQuaternion.clone().invert().multiply(lowerDelta.multiply(elbow.worldQuaternion)));
  const solvedArm = arm.quaternion.clone(), solvedElbow = elbow.quaternion.clone();
  arm.quaternion.copy(initialArm.slerp(solvedArm, weight)); elbow.quaternion.copy(initialElbow.slerp(solvedElbow, weight)); update();
  return Math.max(0, requested - (a + b));
}

export function adaptContact(target, source, name, update, options = {}) {
  const lower = name.toLowerCase(); let active = false, maxReachClamp = 0;
  if (lower === 'confused_scratch') return adaptMeasuredScratch(target, source, update, options.sourceTime);
  if (['clapping_run', 'stand_clap_and_sit_down', 'sitting_clap'].includes(lower)) return { active, maxReachClamp };
  if (/scratch/.test(lower)) {
    const sourceHead = source.byName.get('Head');
    const side = source.byName.get('LeftHand').worldPosition.distanceTo(sourceHead.worldPosition)
      < source.byName.get('RightHand').worldPosition.distanceTo(sourceHead.worldPosition) ? 'L' : 'R';
    const distance = source.byName.get(side === 'L' ? 'LeftHand' : 'RightHand').worldPosition.distanceTo(sourceHead.worldPosition);
    const weight = smooth((.68 - distance) / .35), sign = side === 'L' ? 1 : -1;
    if (weight > .001) {
      const head = target.byName.get('head');
      head.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -.21 * sign * weight)); update();
      const cheek = new Vector3(.44 * sign, .085, .17).applyQuaternion(head.worldQuaternion).add(head.worldPosition);
      maxReachClamp = solveHand(target, side, cheek, weight, update); active = true;
    }
  }
  if (/clap|hand_rub|rub_hand/.test(lower)) {
    const distance = source.byName.get('LeftHand').worldPosition.distanceTo(source.byName.get('RightHand').worldPosition);
    const weight = options.forceHandWeight ?? smooth((.70 - distance) / .44);
    if (weight > .001) {
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1, shoulder = target.byName.get(`shoulder${side}`);
        shoulder.quaternion.slerp(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2 * sign), weight);
      }
      update();
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1, torso = target.byName.get('torso');
        const palm = new Vector3(.08 * sign, .18, .34).applyQuaternion(torso.worldQuaternion).add(torso.worldPosition);
        maxReachClamp = Math.max(maxReachClamp, solveHand(target, side, palm, weight, update));
      }
      active = true;
    }
  }
  return { active, maxReachClamp };
}

export function scratchWeight(sourceTime) {
  const phases = [[.3, 1.2, 4.95, 5.9], [6.75, 7.75, 9.15, 10.1]];
  return Math.max(...phases.map(([start, hold, release, end]) => smooth((sourceTime - start) / (hold - start)) * (1 - smooth((sourceTime - release) / (end - release)))));
}

function adaptMeasuredScratch(target, source, update, sourceTime) {
  const side = 'R', sign = -1;
  const distance = source.byName.get('RightHand').worldPosition.distanceTo(source.byName.get('Head').worldPosition);
  const weight = Number.isFinite(sourceTime) ? scratchWeight(sourceTime) : smooth((.66 - distance) / .26);
  const head = target.byName.get('head'), originalHead = head.quaternion.clone();
  const headPose = head.restLocalQuaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(.025, 0, .12)));
  head.quaternion.copy(headPose); update();
  const shoulder = target.byName.get('shoulderR'), arm = target.byName.get('armR'), elbow = target.byName.get('elbowR'), wrist = target.byName.get('wristR');
  for (const bone of [shoulder, arm, elbow, wrist]) bone.quaternion.copy(bone.restLocalQuaternion);
  update();
  const cheek = heartCheek(target, side), inward = cheek.normal.clone().negate();
  const up = new Vector3(.12, 1, 0).applyQuaternion(head.worldQuaternion);
  const basis = (normal, up) => {
    const y = up.clone().addScaledVector(normal, -up.dot(normal)).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(normal, y, normal.clone().cross(y).normalize()));
  };
  const orientation = basis(inward, up).multiply(basis(new Vector3(sign, 0, 0), new Vector3(0, -1, 0)).invert());
  // Preserve the source's small rubbing rhythm on a reachable part of the cheek.
  const scratch = Math.max(-.012, Math.min(.012, (distance - .32) * .15));
  const tangent = new Vector3(0, 1, 0).applyQuaternion(head.worldQuaternion);
  tangent.addScaledVector(cheek.normal, -tangent.dot(cheek.normal)).normalize();
  const goal = cheek.point.clone().addScaledVector(cheek.normal, HEART_CHEEK_GAP).addScaledVector(tangent, scratch)
    .sub(new Vector3(...HEART_CONTACTS[side].handLocal).applyQuaternion(orientation));
  const direction = goal.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
  shoulder.quaternion.copy(new Quaternion().setFromUnitVectors(arm.position.clone().normalize(), direction)); update();
  const maxReachClamp = solveHand(target, side, goal, 1, update, new Vector3(sign, -.4, .2));
  wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientation)); update();
  const authored = [shoulder, arm, elbow, wrist].map(bone => [bone, bone.quaternion.clone()]);
  head.quaternion.copy(originalHead.slerp(headPose, weight));
  for (const [bone, pose] of authored) bone.quaternion.copy(bone.restLocalQuaternion.clone().slerp(pose, weight));
  update();
  return { active: true, maxReachClamp, weight, scratch };
}

export function motionSemantics(metadata, trajectory, sourceDuration, legRatio) {
  const name = metadata.sourceName.toLowerCase(), family = metadata.sourceSubCategory;
  // Explicitly inspected gait clips also live under Acting/LookingAround in Meshy's catalog.
  const locomotion = metadata.sourceCategory === 'WalkAndRun' || /^handbag_walk(?:_inplace)?$/.test(name)
    || ['excited_walk_f', 'excited_walk_m', 'penguin_walk', 'groovy_walk', 'walking_scan_with_sudden_look_back', 'walk_slowly_and_look_around'].includes(name);
  const running = /run|sprint|jog/.test(name);
  const first = trajectory[0], last = trajectory.at(-1);
  const displacement = [last[0] - first[0], last[2] - first[2]];
  const distance = Math.hypot(...displacement), requiresProps = [];
  const words = new Set(metadata.sourceName.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/));
  for (const [tokens, prop] of [[['laptop', 'coding', 'typing', 'keyboard'], 'laptop'], [['book', 'read', 'reading'], 'book'], [['phone', 'call', 'calling', 'texting'], 'phone'],
    [['bucket'], 'bucket'], [['cannon'], 'cannon'], [['bag', 'handbag'], 'bag'], [['umbrella'], 'umbrella'], [['guitar'], 'guitar'],
    [['sword', 'gun', 'pistol', 'rifle', 'weapon'], 'weapon'], [['object', 'box', 'crate', 'carrying'], 'carried-object'], [['kettlebell'], 'kettlebell'],
    [['door'], 'door'], [['chair'], 'chair'], [['barbell', 'dumbbell', 'weightlifting'], 'exercise-weight']]) if (tokens.some(token => words.has(token))) requiresProps.push(prop);
  const contextAudit = auditMotionContext(metadata, requiresProps);
  return { family, kind: locomotion ? 'locomotion' : 'stationary', inPlaceSource: /inplace|in_place/.test(name),
    sourceRootDisplacementXZ: displacement, targetRootDisplacementXZ: displacement.map(value => value * legRatio),
    suggestedStageSpeed: locomotion ? (distance > .15 ? Math.min(1.3, distance * legRatio / sourceDuration) : running ? .7 : .32) : 0,
    travelDirection: distance > .15 ? displacement.map(value => value / distance) : [0, 1], requiresProps: contextAudit.dependencies, contextAudit,
    contactAdaptation: name === 'big_heart_gesture' ? 'bilateral-cheek-heart-skin-contact'
      : [255, 256].includes(metadata.actionId) ? 'short-leg-visible-stomp-amplitude'
      : name === 'confused_scratch' ? 'short-arm-skin-cheek-scratch'
      : [35, 299, 354].includes(metadata.actionId) ? 'source-timed-neutral-wrist-clap-skin-contact'
      : ['stand_and_drink', 'sit_and_drink'].includes(name) ? 'source-sip-timed-palm-handle-and-mouth-rim-skin-contact'
      : /^kettlebell_swing/.test(name) ? 'short-arm-two-hand-kettlebell-skin-contact'
        : /^carry_heavy_object_walk/.test(name) ? 'short-arm-tray-skin-contact'
      : /scratch/.test(name) ? 'reachable-lower-cheek-with-head-tilt' : /clap|hand_rub|rub_hand/.test(name) ? 'two-hand-front-contact' : 'none',
    ...(metadata.actionId === 343 ? { supportingSurface: { kind: 'cushion', height: .16, phase: 'source-seated-interval', originalLegRotationsPreserved: true } } : {}) };
}
