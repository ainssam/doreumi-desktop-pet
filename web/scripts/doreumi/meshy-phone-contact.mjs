/** Offline, source-bound phone grip adaptation. Never called by the default converter.
 * Geometry, joint translations, and all unselected joints remain unchanged.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { solveHand } from './meshy-adaptation.mjs';
import { PHONE_PALM_CONTACTS } from '../../src/lib/doreumi/motion-phone-contact.ts';

const IDS = new Set([29, 50, 122, 124, 312, 676, 693]);
const MASTER = '97495a8fe07a0b6a5035aee5b2b37e54bf0a2b244fe4d80e5f447fb91d9a0394';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const VERTEX = { L: 78089, R: 705 };

export async function createPhoneContactAdapter({ actionId, modelFile, sourceFile, sourceSha256, offset, radialOffset = 0, palmFrame = false, sourceArmPlane = false }) {
  if (!IDS.has(actionId) || hash(modelFile) !== MASTER || !/^[a-f0-9]{64}$/.test(sourceSha256) || hash(sourceFile) !== sourceSha256) {
    throw new Error('Phone contact adaptation requires the measured v9 master and exact acquired source.');
  }
  if (!Number.isFinite(radialOffset) || radialOffset < 0 || radialOffset > .15) throw new Error('Invalid phone radial clearance.');
  if (!Array.isArray(offset) || offset.length !== 3 || offset.some(v => !Number.isFinite(v)) || Math.hypot(...offset) + radialOffset > .3) {
    throw new Error('Phone contact offset must be a finite bounded torso-local vector.');
  }
  const side = [29, 312].includes(actionId) ? 'L' : 'R', texting = [122, 676].includes(actionId);
  const asset = await loadDoreumiAsset(modelFile), mesh = asset.skinned.find(({ object }) => object.name === 'Doreumi')?.object;
  if (!mesh) throw new Error('Phone contact master mesh missing.');
  const attrs = mesh.geometry.attributes, vertex = palmFrame ? PHONE_PALM_CONTACTS[side === 'L' ? 0 : 1].vertex : VERTEX[side];
  const position = new Vector3().fromBufferAttribute(attrs.position, vertex).applyMatrix4(mesh.bindMatrix);
  const normal = new Vector3().fromBufferAttribute(attrs.normal, vertex).normalize();
  const influences = [];
  for (let i = 0; i < 4; i++) {
    const weight = attrs.skinWeight.getComponent(vertex, i), index = attrs.skinIndex.getComponent(vertex, i);
    if (weight > 0) influences.push({ weight, name: mesh.skeleton.bones[index].name,
      local: position.clone().applyMatrix4(mesh.skeleton.boneInverses[index]) });
  }
  const trace = [];
  const contact = target => influences.reduce((sum, item) => {
    const bone = target.byName.get(item.name);
    return sum.addScaledVector(item.local.clone().multiply(bone.worldScale).applyQuaternion(bone.worldQuaternion).add(bone.worldPosition), item.weight);
  }, new Vector3());
  return {
    trace, provenance: { version: 1, actionId, masterSha256: MASTER, sourceSha256, vertex, offset: [...offset], radialOffset, palmFrame, sourceArmPlane },
    apply(target, _source, update, metadata) {
      if (metadata.actionId !== actionId) throw new Error('Phone contact adapter action mismatch.');
      const wrist = target.byName.get(`wrist${side}`), elbow = target.byName.get(`elbow${side}`), arm = target.byName.get(`arm${side}`);
      const torso = target.byName.get('torso'), head = target.byName.get('head');
      const originalWrist = wrist.worldPosition.clone(), originalOrientation = wrist.worldQuaternion.clone();
      const sourceDistance = _source.byName.get(side === 'L' ? 'LeftHand' : 'RightHand').worldPosition.distanceTo(_source.byName.get('Head').worldPosition);
      const t = Math.max(0, Math.min(1, (.65 - sourceDistance) / .2));
      const facingWeight = texting ? 1 : t * t * (3 - 2 * t);
      const away = contact(target).sub(head.worldPosition); if (!texting) away.y = 0;
      if (away.lengthSq() < 1e-10) throw new Error('Degenerate phone radial direction.');
      const offsetWeight = palmFrame && !texting ? facingWeight : 1;
      const goal = originalWrist.clone().add(new Vector3(...offset).applyQuaternion(torso.worldQuaternion).multiplyScalar(offsetWeight)).addScaledVector(away.normalize(), radialOffset * offsetWeight);
      let pole = elbow.worldPosition.clone().sub(arm.worldPosition);
      if (sourceArmPlane && facingWeight > 0) {
        const prefix = side === 'L' ? 'Left' : 'Right';
        const sourceArm = _source.byName.get(prefix + 'Arm').worldPosition;
        const sourceElbow = _source.byName.get(prefix + 'ForeArm').worldPosition;
        const sourceWrist = _source.byName.get(prefix + 'Hand').worldPosition;
        const sourceAxis = sourceWrist.clone().sub(sourceArm).normalize(), sourcePole = sourceElbow.clone().sub(sourceArm);
        sourcePole.addScaledVector(sourceAxis, -sourcePole.dot(sourceAxis));
        if (sourcePole.lengthSq() > 1e-8) {
          const axis = goal.clone().sub(arm.worldPosition).normalize();
          sourcePole.normalize().applyQuaternion(new Quaternion().setFromUnitVectors(sourceAxis, axis));
          pole.addScaledVector(axis, -pole.dot(axis)).normalize();
          pole.applyQuaternion(new Quaternion().setFromUnitVectors(pole.clone(), sourcePole).slerp(new Quaternion(), 1 - facingWeight));
        }
      }
      pole.applyQuaternion(torso.worldQuaternion.clone().invert());
      const maxReachClamp = palmFrame && facingWeight < .00001 ? 0 : solveHand(target, side, goal, 1, update, pole);
      // Always solve from the authored orientation, not the previous frame's correction.
      // The fixed material point includes its measured elbow blend, so re-evaluate it.
      for (let iteration = 0; iteration < 5; iteration++) {
        const desired = head.worldPosition.clone().sub(contact(target));
        if (!texting) desired.y = 0;
        if (desired.lengthSq() < 1e-10) throw new Error('Degenerate phone viewing direction.');
        desired.normalize();
        const authoredNormal = normal.clone().applyQuaternion(originalOrientation).normalize();
        let orientation = new Quaternion().setFromUnitVectors(authoredNormal, desired).multiply(originalOrientation);
        if (palmFrame) {
          const frame = (z, rawUp) => { const y = rawUp.clone().addScaledVector(z, -rawUp.dot(z)).normalize(); return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(y.clone().cross(z), y, z)); };
          const localUp = new Vector3(...PHONE_PALM_CONTACTS[side === 'L' ? 0 : 1].localUp);
          orientation = frame(desired, new Vector3(0, 1, 0)).multiply(frame(normal, localUp).invert());
          orientation = originalOrientation.clone().slerp(orientation, facingWeight);
        }
        wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(orientation));
        update();
      }
      const sourceHand = _source.byName.get(side === 'L' ? 'LeftHand' : 'RightHand');
      const row = { time: metadata.time, facingWeight, sourceHandSpan: _source.byName.get('LeftHand').worldPosition.distanceTo(_source.byName.get('RightHand').worldPosition), sourceLeftHandToHead: _source.byName.get('LeftHand').worldPosition.distanceTo(_source.byName.get('Head').worldPosition), sourceRightHandToHead: _source.byName.get('RightHand').worldPosition.distanceTo(_source.byName.get('Head').worldPosition), sourceHandToHead: sourceHand.worldPosition.distanceTo(_source.byName.get('Head').worldPosition), maxReachClamp, wristDisplacement: wrist.worldPosition.distanceTo(originalWrist),
        wristWorldAngle: originalOrientation.angleTo(wrist.worldQuaternion), contact: contact(target).toArray() };
      trace.push(row);
      return row;
    },
  };
}
