import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip, Quaternion, Vector3 } from 'three';
import { adaptFloorAirborne, adaptFloorTransitions, createFloorTransitionLibrary, floorAirbornePolicy, FLOOR_TRANSITION_ACTIONS, SOURCE_PRESERVED_FLOOR_ACTIONS } from '../scripts/doreumi/meshy-transition.mjs';
import { targetGraph, updateNode, serializeClip } from '../scripts/doreumi/meshy-retarget.mjs';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';

const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const contract=json('public/doreumi/rig-contract.json'),manifest=json('public/doreumi/motions/meshy-source-manifest.json');
const library=await createFloorTransitionLibrary('public/doreumi/doreumi-master.glb',contract);
const converted=new Map();
function candidate(id) {
  if(converted.has(id))return converted.get(id);
  const item=manifest.motions.find(item=>item.actionId===id),original=AnimationClip.parse(json(`public${item.url}`));
  const result=adaptFloorTransitions(original,item.retargetEvidence,item,library);
  const output={...result,item,original};converted.set(id,output);return output;
}
function sampleGraph(clip) {
  const target=targetGraph(contract),tracks=clip.tracks.map(track=>({node:target.byName.get(track.name.split('.')[0]),property:track.name.split('.')[1],sample:track.createInterpolant()}));
  return time=>{for(const track of tracks)track.node[track.property].fromArray(track.sample.evaluate(time));target.ordered.forEach(updateNode);return target;};
}

test('floor semantic policy removes belly-derived false airborne without flattening real jumps',()=>{
  assert.equal(floorAirbornePolicy({actionId:344}),'grounded-floor-action');
  assert.deepEqual(adaptFloorAirborne({actionId:344},[.1,.2,.3]).values,[0,0,0]);
  assert.deepEqual(adaptFloorAirborne({actionId:255},[.1,.2,.3]).values,[.1,.2,.3]);
  assert.deepEqual(adaptFloorAirborne({actionId:269},[.1,.2,.3]).values,[0,0,0]);
  for(const actionId of [490,502])assert.deepEqual(adaptFloorAirborne({actionId},[.1,.2,.3]).values,[.1,.2,.3]);
  for(const actionId of SOURCE_PRESERVED_FLOOR_ACTIONS)assert.deepEqual(adaptFloorAirborne({actionId},[.1,2,.3]).values,[.1,2,.3]);
  const feet=[[.08,.09],[.08,.09],[.28,.09],[.28,.39],[.08,.09]];
  const jump=adaptFloorAirborne({actionId:325},[0,0,0,0,0],feet,.4);
  assert.deepEqual(jump.values.slice(0,3),[0,0,0]);
  assert.ok(Math.abs(jump.values[3]-.0768)<1e-10);
  assert.throws(()=>adaptFloorAirborne({actionId:325},[0,0],undefined,.4),/actual source foot/);
  const airborne=adaptFloorAirborne({actionId:369},[.04,.3,.04],undefined,.4,{heights:[.004,.6,-.2],restFloor:0});
  assert.deepEqual(airborne.values,[0,.2368,0]);
  assert.throws(()=>adaptFloorAirborne({actionId:366},[0],undefined,.4),/actual source skin rest floor/);
});

test('supported entry and recovery copy the complete original source interval',context=>{
  let maximumSourceError=0;
  for(const id of [3,264,269,329,344,363,365,367,369,372,487,488,489,490,498,499,500,502,504,549]) {
    const {clip,evidence,original,item}=candidate(id);
    assert.equal(clip.tracks.length,original.tracks.length);
    for(let index=0;index<clip.tracks.length;index++) {
      const track=clip.tracks[index],before=original.tracks[index],a=before.createInterpolant(),b=track.createInterpolant();
      assert.equal(track.name,before.name);
      for(let frame=0;frame<=100;frame++) {
        const time=evidence.sourceDuration*frame/100,x=[...a.evaluate(item.retargetEvidence.entryDuration+time)],y=[...b.evaluate(evidence.entryDuration+time)];
        const error=x.length===4?new Quaternion().fromArray(x).normalize().angleTo(new Quaternion().fromArray(y).normalize()):new Vector3().fromArray(x).distanceTo(new Vector3().fromArray(y));
        maximumSourceError=Math.max(maximumSourceError,error);
      }
    }
    assert.equal(evidence.floorTransitions.sourceKeysPreserved,true);
  }
  context.diagnostic(JSON.stringify({maximumSourceError}));
  assert.ok(maximumSourceError<.00001,'original exercise motion changed');
});

test('prone transition kneels before leaning and puts both actual palms on the floor',context=>{
  for(const id of [329,340,369,372,502]) {
    const {clip,evidence}=candidate(id),sample=sampleGraph(clip);
    const transition=evidence.floorTransitions.entry??evidence.floorTransitions.exit;
    const enter=Boolean(evidence.floorTransitions.entry);
    const at=pathTime=>enter?pathTime:evidence.entryDuration+evidence.sourceDuration+evidence.exitDuration-pathTime;
    let graph=sample(at(transition.stages.kneelEnd));
    for(const side of ['L','R'])assert.ok(graph.byName.get(`knee${side}`).quaternion.angleTo(graph.byName.get(`knee${side}`).restLocalQuaternion)>100*Math.PI/180);
    assert.ok(new Vector3(0,1,0).angleTo(new Vector3(0,1,0).applyQuaternion(graph.byName.get('body').worldQuaternion))<.001);
    graph=sample(at((transition.stages.braceStart+transition.stages.braceEnd)/2));
    const hands=library.handSampler.sample(graph),minimumHands=['L','R'].map(side=>Math.min(...hands[side].map(point=>point[1])));
    assert.ok(minimumHands.every(height=>height>=0&&height<.006),`palms do not support ${id}: ${minimumHands}`);
    assert.equal(transition.bracing.maxReachClamp,0);
    for(const bone of contract.bones) {
      const node=graph.byName.get(bone.name);
      if(bone.name!=='DoreumiRig')assert.deepEqual(node.position.toArray(),bone.restLocalPosition);
      assert.deepEqual(node.scale.toArray(),bone.restLocalScale);
    }
    context.diagnostic(JSON.stringify({id,minimumHands,entryDuration:evidence.entryDuration,exitDuration:evidence.exitDuration}));
  }
});

test('serialized transition surfaces stay grounded and joints move continuously at 120 Hz',context=>{
  let minimumFloor=Infinity,minimumTransitionInterior=Infinity,maximumStep=0,worst,floorWorst;
  for(const id of [329,344,363,365,367,369,372,487,488,489,498,499,500,504]) {
    const result=candidate(id),clip=AnimationClip.parse(serializeClip(result.clip)),e=result.evidence,sample=sampleGraph(clip);
    for(const [from,to,adapted] of [[0,e.entryDuration,e.floorTransitions.entry],[e.entryDuration+e.sourceDuration,clip.duration,e.floorTransitions.exit]]) {
      if(!adapted)continue;
      let previous;
      for(let index=0;index<=Math.ceil((to-from)*120);index++) {
        const time=Math.min(to,from+index/120),target=sample(time);
        const floor=library.support.measure(target);
        if(floor<minimumFloor){minimumFloor=floor;floorWorst={id,time:Math.min(to,from+index/120),from,to};}
        if(time>from+1e-6&&time<to-1e-6){
          minimumTransitionInterior=Math.min(minimumTransitionInterior,floor);
          assert.ok(floor>=Math.min(.001,adapted.minimum-.0005),'new transition loses the source-boundary clearance');
        }
        const current=new Map(target.ordered.map(node=>[node.name,node.quaternion.clone().normalize()]));
        if(previous)for(const [name,q] of current){const step=q.angleTo(previous.get(name));if(step>maximumStep){maximumStep=step;worst={id,time:Math.min(to,from+index/120),name};}}
        previous=current;
      }
    }
  }
  context.diagnostic(JSON.stringify({minimumFloor,minimumTransitionInterior,maximumStep,maximumDegreesPer120HzStep:maximumStep*180/Math.PI,worst,floorWorst}));
  // The source boundary is copied exactly, including its smaller positive
  // clearance (367: .000719 after its airborne-policy correction). The final
  // approach eases into that exact boundary, rather than changing source data.
  assert.ok(minimumFloor>=0,'entry/recovery skin penetrates the floor');
  assert.ok(maximumStep<.031,'entry/recovery exceeds its 3.5 rad/s speed envelope');
});

test('airborne falling fragments keep their existing approach while their floor recovery is replaced',()=>{
  for(const id of [488,489,498,499,500,504,505]) {
    const {clip,evidence,original,item}=candidate(id);
    assert.equal(evidence.floorTransitions.entry,null);
    assert.ok(evidence.floorTransitions.deferredEntry.minimum>.12);
    assert.match(evidence.floorTransitions.deferredEntry.reason,/requires-launch-or-environment/);
    for(let index=0;index<clip.tracks.length;index++) {
      const a=original.tracks[index].createInterpolant(),b=clip.tracks[index].createInterpolant();
      for(let frame=0;frame<=30;frame++) {
        const time=item.retargetEvidence.entryDuration*frame/30;
        assert.ok([...a.evaluate(time)].every((value,i)=>Math.abs(value-b.evaluate(time)[i])<.000002));
      }
    }
  }
});

test('unrelated actions remain byte-for-byte unchanged',()=>{
  const {original,item}=candidate(329);
  const result=adaptFloorTransitions(original,item.retargetEvidence,{actionId:318},library);
  assert.equal(result.clip,original);assert.equal(result.evidence,item.retargetEvidence);
});

test('every serialized floor candidate passes the actual runtime clip registry contract',async()=>{
  const {register}=await import('node:module');register('./alias-hooks.mjs',import.meta.url);
  const {DoreumiMotion}=await import('../src/lib/doreumi/motion.ts');
  const asset=await loadDoreumiAsset('public/doreumi/doreumi-master.glb'),motion=new DoreumiMotion(asset.scene,asset.clips);
  try {
    for(const id of FLOOR_TRANSITION_ACTIONS) {
      const clip=AnimationClip.parse(serializeClip(candidate(id).clip));
      assert.doesNotThrow(()=>motion.registerClip(clip),`runtime refused floor clip ${id}`);
      assert.equal(motion.hasClip(`meshy:${id}`),true);
    }
  } finally {motion.dispose();}
});
