/** Source-bound, fixed-length side grip and screen taps for the short plush arms.
 * Candidate-only callback; the default retarget pipeline does not invoke this.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { solveHand } from './meshy-adaptation.mjs';
import { createPhoneContactAdapter } from './meshy-phone-contact.mjs';
import { PHONE_PALM_CONTACTS } from '../../src/lib/doreumi/motion-phone-contact.ts';

const frame = (normal, up) => {
  const y = up.clone().addScaledVector(normal, -up.dot(normal));
  if (y.lengthSq() < 1e-8) throw new Error('Degenerate phone contact frame.');
  y.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(y.clone().cross(normal), y, normal));
};
export async function createPhoneTextContactAdapter(options) {
  if (![122, 676].includes(options.actionId)) throw new Error('Text contact requires the acquired texting source.');
  const validated = await createPhoneContactAdapter({ ...options, offset: [0, 0, 0], palmFrame: true });
  const asset = await loadDoreumiAsset(options.modelFile), mesh = asset.skinned.find(({ object }) => object.name === 'Doreumi').object;
  const attrs = mesh.geometry.attributes;
  const palms = PHONE_PALM_CONTACTS.map(({ vertex, localUp }) => {
    const position = new Vector3().fromBufferAttribute(attrs.position, vertex).applyMatrix4(mesh.bindMatrix);
    const normal = new Vector3().fromBufferAttribute(attrs.normal, vertex).normalize();
    const influences = [];
    for (let i = 0; i < 4; i++) {
      const weight = attrs.skinWeight.getComponent(vertex, i), index = attrs.skinIndex.getComponent(vertex, i);
      if (weight > 0) influences.push({ weight, name: mesh.skeleton.bones[index].name,
        local: position.clone().applyMatrix4(mesh.skeleton.boneInverses[index]) });
    }
    return { inverseFrame: frame(normal, new Vector3(...localUp)).invert(), influences };
  });
  const contact = (target, side) => palms[side === 'L' ? 0 : 1].influences.reduce((sum, item) => {
    const bone = target.byName.get(item.name);
    return sum.addScaledVector(item.local.clone().multiply(bone.worldScale).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), item.weight);
  }, new Vector3());
  const leftSkin = [];
  for (let vertex = 0; vertex < attrs.position.count; vertex++) {
    let wristWeight = 0;
    for (let i = 0; i < 4; i++) if (mesh.skeleton.bones[attrs.skinIndex.getComponent(vertex, i)].name === 'wristL') wristWeight += attrs.skinWeight.getComponent(vertex, i);
    if (wristWeight < .5) continue;
    const position = new Vector3().fromBufferAttribute(attrs.position, vertex).applyMatrix4(mesh.bindMatrix), influences = [];
    for (let i = 0; i < 4; i++) {
      const weight = attrs.skinWeight.getComponent(vertex, i), index = attrs.skinIndex.getComponent(vertex, i);
      if (weight > 0) influences.push({ weight, name: mesh.skeleton.bones[index].name, local: position.clone().applyMatrix4(mesh.skeleton.boneInverses[index]) });
    }
    leftSkin.push({ vertex, influences });
  }
  const skinPoint = (target, influences) => influences.reduce((sum, item) => {
    const bone = target.byName.get(item.name);
    return sum.addScaledVector(item.local.clone().multiply(bone.worldScale).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), item.weight);
  }, new Vector3());
  const trace = [];
  return {
    trace, provenance: { ...validated.provenance, version: 2, grip: 'side-support-and-screen-tap', center: [.01, .32, .447], screenTapCycles: 2, tapContact: 'actual-wrist-skin-support-plane' },
    apply(target, source, update, metadata) {
      if (metadata.actionId !== options.actionId || !Number.isFinite(metadata.time) || !(metadata.sourceDuration > 0)) throw new Error('Text contact source clock mismatch.');
      const torso = target.byName.get('torso'), head = target.byName.get('head');
      const center = new Vector3(.01, .32, .447).applyQuaternion(torso.worldQuaternion).add(torso.worldPosition);
      const normal = head.worldPosition.clone().sub(center).normalize();
      const up = new Vector3(0, 1, 0).addScaledVector(normal, -normal.y).normalize(), right = up.clone().cross(normal);
      const tapGap = .012 * Math.sin(2 * Math.PI * metadata.time / metadata.sourceDuration) ** 2;
      const goals = { R: center.clone().addScaledVector(right, .092),
        L: center.clone().addScaledVector(normal, .0205 + tapGap).addScaledVector(right, -.055) };
      const row = { time: metadata.time, tapGap, maxReachClamp: 0, errors: {}, wristDisplacement: {}, collarAngle: {} };
      for (const side of ['R', 'L']) {
        const shoulder = target.byName.get(`shoulder${side}`), arm = target.byName.get(`arm${side}`), elbow = target.byName.get(`elbow${side}`), wrist = target.byName.get(`wrist${side}`);
        const originals = [shoulder, arm, elbow].map(bone => bone.quaternion.clone());
        const originalWrist = wrist.worldPosition.clone(), originalCollarWorld = shoulder.worldQuaternion.clone();
        const orientation = frame(side === 'L' ? normal.clone().negate() : right.clone().negate(), up).multiply(palms[side === 'L' ? 0 : 1].inverseFrame);
        for (let iteration = 0; iteration < 12; iteration++) {
          wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientation)); update();
          const error = goals[side].clone().sub(contact(target, side));
          if (side === 'L') {
            let minimum = Infinity;
            for (const point of leftSkin) minimum = Math.min(minimum, skinPoint(target, point.influences).sub(center).dot(normal));
            error.addScaledVector(normal, .0205 + .0005 + tapGap - minimum - error.dot(normal));
          }
          const wristGoal = wrist.worldPosition.clone().add(error);
          [shoulder, arm, elbow].forEach((bone, i) => bone.quaternion.copy(originals[i])); update();
          const axis = arm.worldPosition.clone().sub(shoulder.worldPosition).normalize(), desired = wristGoal.clone().sub(shoulder.worldPosition).normalize();
          shoulder.quaternion.copy(shoulder.parent.worldQuaternion.clone().invert().multiply(new Quaternion().setFromUnitVectors(axis, desired).multiply(shoulder.worldQuaternion))); update();
          row.maxReachClamp = Math.max(row.maxReachClamp, solveHand(target, side, wristGoal, 1, update, side === 'L' ? new Vector3(1, 0, 0) : new Vector3(-.4, -.4, .2)));
          wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientation)); update();
        }
        const contactError = contact(target, side).sub(goals[side]);
        if (side === 'L') {
          let minimum = Infinity;
          for (const point of leftSkin) minimum = Math.min(minimum, skinPoint(target, point.influences).sub(center).dot(normal));
          row.skinTapGap = minimum - .0205;
          contactError.addScaledVector(normal, row.skinTapGap - .0005 - tapGap - contactError.dot(normal));
        }
        row.errors[side] = contactError.length();
        row.wristDisplacement[side] = wrist.worldPosition.distanceTo(originalWrist);
        row.collarAngle[side] = shoulder.worldQuaternion.angleTo(originalCollarWorld);
      }
      row.sourceHandSpan = source.byName.get('LeftHand').worldPosition.distanceTo(source.byName.get('RightHand').worldPosition);
      trace.push(row); return row;
    },
  };
}
