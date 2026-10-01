import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip, Quaternion, Vector3 } from 'three';
import { adaptFloorAcrobatics } from '../scripts/doreumi/meshy-floor-acrobatics.mjs';
import { createFloorTransitionLibrary } from '../scripts/doreumi/meshy-transition.mjs';
import { targetGraph, updateNode, serializeClip } from '../scripts/doreumi/meshy-retarget.mjs';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';

const json=file=>JSON.parse(fs.readFileSync(file));
const contract=json('public/doreumi/rig-contract.json'),manifest=json('public/doreumi/motions/meshy-source-manifest.json');
const library=await createFloorTransitionLibrary('public/doreumi/doreumi-master.glb',contract),candidates=new Map();
function candidate(id) {
  if(candidates.has(id))return candidates.get(id);
  const item=manifest.motions.find(item=>item.actionId===id),original=AnimationClip.parse(json(`public${item.url}`));
  const result=adaptFloorAcrobatics(original,item.retargetEvidence,item,library);
  const value={...result,original,item,clip:AnimationClip.parse(serializeClip(result.clip))};candidates.set(id,value);return value;
}
function graphSampler(clip) {
  const target=targetGraph(contract),tracks=clip.tracks.map(track=>({node:target.byName.get(track.name.split('.')[0]),property:track.name.split('.')[1],sample:track.createInterpolant()}));
  return time=>{for(const track of tracks)track.node[track.property].fromArray(track.sample.evaluate(time));target.ordered.forEach(updateNode);return target;};
}

test('the impossible inverted handstands become distinct supported actions with original turn timing',()=>{
  for(const id of [375,395,451]) {
    const {clip,evidence}=candidate(id),sample=graphSampler(clip);
    assert.equal(evidence.acrobatics.sourceBodyAndLegRotationsPreserved,false);
    assert.equal(evidence.sourceDuration,evidence.acrobatics.sourceDuration);
    if(id!==451)assert.ok(Math.abs(Math.abs(evidence.acrobatics.sourceTurn)-2*Math.PI)<.001);
    for(let index=0;index<=60;index++) {
      const target=sample(evidence.entryDuration+evidence.sourceDuration*index/60);
      const vertical=new Vector3(0,1,0).applyQuaternion(target.byName.get('body').worldQuaternion).y;
      assert.ok(vertical>-.25,`inverted head support remains in ${id}`);
      if(id===395)assert.ok(Math.abs(vertical)<1e-5,'backspin is not horizontal');
    }
  }
});

test('supporting palms touch actual skin floor without changing any bone length or scale',context=>{
  for(const id of [406,451]) {
    const {clip,evidence}=candidate(id),sample=graphSampler(clip),[start,end]=evidence.acrobatics.handSupportSourceInterval;
    let maxHeight=0,minHeight=Infinity;
    for(let index=0;index<=60;index++) {
      const target=sample(evidence.entryDuration+start+(end-start)*index/60),height=Math.min(...library.handSampler.sample(target).R.map(point=>point[1]));
      maxHeight=Math.max(maxHeight,height);minHeight=Math.min(minHeight,height);
      for(const bone of contract.bones) {
        const node=target.byName.get(bone.name);
        if(bone.name!=='DoreumiRig')assert.deepEqual(node.position.toArray(),bone.restLocalPosition);
        assert.deepEqual(node.scale.toArray(),bone.restLocalScale);
      }
    }
    assert.equal(evidence.acrobatics.maximumReachClamp,0);
    assert.ok(minHeight>.002&&maxHeight<.006,`unsupported palm ${id}: ${minHeight}..${maxHeight}`);
    context.diagnostic(JSON.stringify({id,minHeight,maxHeight}));
  }
});

test('the flair body, legs and later jump rotations stay identical to the imported source',()=>{
  const {clip,evidence,original,item}=candidate(406);
  for(const name of ['body','torso','head','thighL','thighR','kneeL','kneeR','footL','footR']) {
    const before=original.tracks.find(track=>track.name===`${name}.quaternion`).createInterpolant();
    const after=clip.tracks.find(track=>track.name===`${name}.quaternion`).createInterpolant();
    for(let frame=0;frame<=150;frame++) {
      const time=evidence.sourceDuration*frame/150;
      const a=new Quaternion().fromArray(before.evaluate(item.retargetEvidence.entryDuration+time)).normalize();
      const b=new Quaternion().fromArray(after.evaluate(evidence.entryDuration+time)).normalize();
      assert.ok(a.angleTo(b)<.00002,`original flair ${name} changed`);
    }
  }
});

test('decoded acrobatics remain above the floor and have no one-frame quaternion flips at 120 Hz',context=>{
  for(const id of [375,395,406,451]) {
    const {clip}=candidate(id),sample=graphSampler(clip);let minFloor=Infinity,maxStep=0,previous,worst;
    for(let frame=0;frame<=Math.ceil(clip.duration*120);frame++) {
      const time=Math.min(frame/120,clip.duration),target=sample(time);
      minFloor=Math.min(minFloor,library.support.measure(target));
      const current=new Map(target.ordered.map(node=>[node.name,node.quaternion.clone().normalize()]));
      if(previous)for(const [name,q]of current){const step=q.angleTo(previous.get(name));if(step>maxStep){maxStep=step;worst={name,time};}}
      previous=current;
    }
    assert.ok(minFloor>.001,`skin penetrates floor in ${id}: ${minFloor}`);
    // 406 retains the source's fast flair; its existing knee reaches 9°/120 Hz.
    const limit=id===406?11:id===395?7:id===375?5:2;
    assert.ok(maxStep*180/Math.PI<limit,`joint pop in ${id}: ${JSON.stringify(worst)}`);
    context.diagnostic(JSON.stringify({id,minFloor,maxDegreesPer120Hz:maxStep*180/Math.PI,worst}));
  }
});

test('acrobatics are idempotent, scoped, and accepted by the actual runtime registry',async()=>{
  const {register}=await import('node:module');register('./alias-hooks.mjs',import.meta.url);
  const {DoreumiMotion}=await import('../src/lib/doreumi/motion.ts'),asset=await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const motion=new DoreumiMotion(asset.scene,asset.clips);
  try {
    for(const id of [375,395,406,451]) {
      const {clip,evidence,item}=candidate(id),again=adaptFloorAcrobatics(clip,evidence,item,library);
      assert.equal(again.clip,clip);assert.equal(again.evidence,evidence);
      assert.doesNotThrow(()=>motion.registerClip(clip,{planarSupportMaxOffset:evidence.planarSupport?.maxOffset}));
      const other=adaptFloorAcrobatics(clip,evidence,{actionId:318},library);assert.equal(other.clip,clip);
    }
  } finally {motion.dispose();}
});
