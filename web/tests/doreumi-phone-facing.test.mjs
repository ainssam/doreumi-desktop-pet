import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { PHONE_PALM_CONTACTS } from '../src/lib/doreumi/motion-phone-contact.ts';
import { createDoreumiContextProps } from '../src/lib/doreumi/motion-context-props.ts';

const manifest = JSON.parse(fs.readFileSync('public/doreumi/motions/meshy-source-manifest.json'));
test('phone family follows a fixed material palm frame and keeps the measured rear or side grip inside the rigid case', async () => {
 const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), holder = new THREE.Group(); holder.add(asset.scene);
 const props = createDoreumiContextProps({model:asset.scene,parent:holder}), mixer = new THREE.AnimationMixer(asset.scene);
 try {
  for (const id of [29,50,122,124,312,676,693]) {
   const entry=manifest.motions.find(x=>x.actionId===id), e=entry.retargetEvidence;
   const clip=THREE.AnimationClip.parse(JSON.parse(fs.readFileSync('public/'+entry.url)));
   mixer.stopAllAction();const action=mixer.clipAction(clip).reset().play();action.setLoop(THREE.LoopOnce,0);action.clampWhenFinished=true;
   props.setMotion({sourceActionId:id,props:['phone'],entryDuration:e.entryDuration,exitDuration:e.exitDuration});
   for (const yaw of [0,1.7]) for (let i=0;i<=Math.floor(e.sourceDuration*30);i++) {
    holder.rotation.y=yaw;const time=e.entryDuration+i/30;mixer.setTime(time);holder.updateMatrixWorld(true);asset.skinned.forEach(x=>x.object.skeleton.update());props.update({time,duration:clip.duration});holder.updateMatrixWorld(true);
    const body=holder.getObjectByName('Doreumi_context_phone').children[0], screen=body.children[1];
    const normal=new THREE.Vector3(0,0,1).transformDirection(screen.matrixWorld), side=[29,312].includes(id)?0:1;
    const mesh=asset.scene.getObjectByName('Doreumi'), wrist=asset.scene.getObjectByName(side?'wristR':'wristL');
    const palmNormal=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,PHONE_PALM_CONTACTS[side].vertex).normalize().applyQuaternion(wrist.getWorldQuaternion(new THREE.Quaternion()));
    const texting=[122,676].includes(id), expected=texting?new THREE.Vector3(-1,0,0).transformDirection(body.matrixWorld):normal;
    assert.ok(expected.dot(palmNormal)>1-1e-6,`${id}@${i/30}: display must follow its fixed grip frame`);
    const state=props.inspect();assert.equal(state.finite,true);assert.equal(state.contacts.length,1);
    const actualSkin=mesh.getVertexPosition(PHONE_PALM_CONTACTS[side].vertex,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert.ok(actualSkin.distanceTo(new THREE.Vector3(...state.contacts[0].targetPoint))<1e-6, `${id}: exact material contact point`);
    const rearPoint=new THREE.Vector3(...state.contacts[0].propPoint).applyMatrix4(body.matrixWorld.clone().invert());
    assert.ok(texting ? Math.abs(rearPoint.x-.075)<1e-6 && Math.abs(rearPoint.z)<1e-6 : Math.abs(rearPoint.z+.0175)<1e-6,`${id}: grip must be on its case plane`);
    assert.ok(Math.abs(rearPoint.x)<=.075+1e-6 && Math.abs(rearPoint.y-.02)<=.125,`${id}: rear grip must be inside rigid case`);
    assert.ok(texting ? Math.abs(rearPoint.y)<1e-6 : rearPoint.y < -.07 && rearPoint.y > -.105, `${id}: grip has a positive edge margin`);
    assert.ok(Math.abs(state.contacts[0].distance-.017)<1e-6,`${id}: actual skin gap`);
   }
  }
 } finally { props.dispose(); }
});
