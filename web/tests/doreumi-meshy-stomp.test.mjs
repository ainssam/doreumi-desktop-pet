import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip, Euler, Vector3 } from 'three';
import { adaptStomp } from '../scripts/doreumi/meshy-stomp.mjs';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { createMasterSupport } from '../scripts/doreumi/meshy-master-support.mjs';
import { createPlanarFootSampler } from '../scripts/doreumi/meshy-planar-support.mjs';

const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const contract=json('public/doreumi/rig-contract.json'),manifest=json('public/doreumi/motions/meshy-source-manifest.json');
const support=await createMasterSupport('public/doreumi/doreumi-master.glb',contract);
const sampler=createPlanarFootSampler(support.document,{L:['footL'],R:['footR']},{morphWeight:1});

test('the stomp solve preserves the standing leg, foot orientation and all joint lengths',context=>{
  for(const id of [255,256]) {
    const item=manifest.motions.find(item=>item.actionId===id),e=item.retargetEvidence;
    const clip=AnimationClip.parse(json(`public${item.url}`)),target=targetGraph(contract);
    const tracks=clip.tracks.map(track=>({node:target.byName.get(track.name.split('.')[0]),property:track.name.split('.')[1],sample:track.createInterpolant()}));
    let originalPeak={height:0,time:0},adaptedPeak={height:0,time:0},minimumFloor=Infinity;
    for(let frame=0;frame<=168;frame++) {
      const time=e.sourceDuration*frame/168;
      for(const track of tracks)track.node[track.property].fromArray(track.sample.evaluate(e.entryDuration+time));target.ordered.forEach(updateNode);
      const before=target.ordered.map(node=>({name:node.name,position:node.position.toArray(),scale:node.scale.toArray(),quaternion:node.quaternion.toArray()}));
      const footWorld=target.byName.get('footL').worldQuaternion.clone(),rightBefore=sampler.sample(target).R;
      const result=adaptStomp(target,item,time,e.sourceDuration,()=>target.ordered.forEach(updateNode),sampler);
      if(result.liftBefore>originalPeak.height)originalPeak={height:result.liftBefore,time};
      if(result.liftAfter>adaptedPeak.height)adaptedPeak={height:result.liftAfter,time};
      assert.equal(result.maxReachClamp,0);
      assert.ok(footWorld.angleTo(target.byName.get('footL').worldQuaternion)<1e-6);
      assert.deepEqual(sampler.sample(target).R,rightBefore);
      for(const pose of before) {
        const node=target.byName.get(pose.name);
        assert.deepEqual(node.position.toArray(),pose.position);assert.deepEqual(node.scale.toArray(),pose.scale);
        if(!['thighL','kneeL','footL','torso','head'].includes(pose.name))assert.deepEqual(node.quaternion.toArray(),pose.quaternion);
      }
      minimumFloor=Math.min(minimumFloor,support.measure(target));
    }
    assert.ok(adaptedPeak.height>=originalPeak.height-.006,`sole lift was lost for ${id}`);
    // This is deliberately a second solve on shipping poses to stress reach
    // invariants. Actual source-event timing is checked on the final clip below.
    assert.ok(minimumFloor>0,'raised leg introduced skin floor penetration');
    context.diagnostic(JSON.stringify({id,stressInputPeak:originalPeak,stressOutputPeak:adaptedPeak,minimumFloor}));
  }
});

test('final shipping stomps retain a visible sole lift after reduction without reapplying IK',context=>{
  for(const id of [255,256]) {
    const item=manifest.motions.find(item=>item.actionId===id),e=item.retargetEvidence;
    assert.equal(e.semantics.contactAdaptation,'short-leg-visible-stomp-amplitude');
    const clip=AnimationClip.parse(json(`public${item.url}`)),target=targetGraph(contract);
    const tracks=clip.tracks.map(track=>({node:target.byName.get(track.name.split('.')[0]),property:track.name.split('.')[1],sample:track.createInterpolant()}));
    let peak={height:0,time:0},minimumFloor=Infinity,maximumStep=0,previous,visibleFrames=0;
    for(let frame=0;frame<=168;frame++) {
      const time=e.sourceDuration*frame/168;
      for(const track of tracks)track.node[track.property].fromArray(track.sample.evaluate(e.entryDuration+time));target.ordered.forEach(updateNode);
      const feet=sampler.sample(target),height=Math.min(...feet.L.map(point=>point[1]))-Math.min(...feet.R.map(point=>point[1]));
      if(height>.15)visibleFrames++;
      if(height>peak.height) {
        const forward=new Vector3(0,0,1).applyQuaternion(target.byName.get('body').worldQuaternion);forward.y=0;forward.normalize();
        const depth=target.byName.get('footL').worldPosition.clone().sub(target.byName.get('thighL').worldPosition).dot(forward);
        peak={height,time,depth,headPitch:new Euler().setFromQuaternion(target.byName.get('head').quaternion).x};
      }
      minimumFloor=Math.min(minimumFloor,support.measure(target));
      const current=['thighL','kneeL','footL'].map(name=>target.byName.get(name).quaternion.clone().normalize());
      if(previous)for(let index=0;index<current.length;index++)maximumStep=Math.max(maximumStep,current[index].angleTo(previous[index]));
      previous=current;
    }
    assert.ok(peak.height>.18&&peak.height<.22,`visible short-leg lift for ${id}`);
    assert.ok(peak.depth>.25,'raised foot is still hidden behind the belly');
    assert.ok(Math.abs(peak.headPitch)<.3,'head nod still dominates the foot accent');
    assert.ok(visibleFrames*e.sourceDuration/168>.15,'readable raised-foot interval is too brief');
    assert.ok(Math.abs(peak.time-1.2)<.009,'original main stomp peak moved');
    assert.ok(minimumFloor>0);assert.ok(maximumStep<.14,'shipping stomp crossed a rotation branch');
    context.diagnostic(JSON.stringify({id,shippingPeak:peak,minimumFloor,maximumStepDegrees:maximumStep*180/Math.PI}));
  }
});

test('stomp scope does not change neighboring larger source stomps',()=>{
  const target=targetGraph(contract),before=target.ordered.map(node=>node.quaternion.toArray());
  assert.deepEqual(adaptStomp(target,{actionId:257},.3,1.4,()=>assert.fail('unrelated action updated'),sampler),{active:false,maxReachClamp:0});
  assert.deepEqual(target.ordered.map(node=>node.quaternion.toArray()),before);
});
