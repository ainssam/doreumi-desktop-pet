import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { loadDoreumiAsset } from './rig-utils.mjs';
import { targetGraph, updateNode } from './meshy-retarget.mjs';
import { createMasterSupport } from './meshy-master-support.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';
import { solveHand } from './meshy-adaptation.mjs';

// Verified against all 524 decoded source boundaries in meshy-endpoint-audit.
// These additions only replace entry/recovery; sleeping, airborne and crawling
// source intervals retain their existing root height and every rotation key.
export const SOURCE_PRESERVED_FLOOR_ACTIONS = new Set([3,264,265,266,267,270,271,272,396,419,487,488,489,498,499,500,504,505,549,622]);
export const FLOOR_TRANSITION_ACTIONS = new Set([269,321,322,324,325,328,329,330,340,344,345,346,347,348,349,350,351,352,353,362,363,365,366,367,368,369,370,372,490,502,...SOURCE_PRESERVED_FLOOR_ACTIONS]);
const REST_FLOOR_AIRBORNE = new Set([366,369]);
const PRESERVE_SOURCE_AIRBORNE = new Set([490,502,...SOURCE_PRESERVED_FLOOR_ACTIONS]);
const GROUNDED = new Set([...FLOOR_TRANSITION_ACTIONS].filter(id => id !== 325&&!REST_FLOOR_AIRBORNE.has(id)&&!PRESERVE_SOURCE_AIRBORNE.has(id)));
const UP = new Vector3(0,1,0), FORWARD = new Vector3(0,0,1), RAD = Math.PI / 180;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const clonePose = pose => ({ rotations: new Map([...pose.rotations].map(([name,q])=>[name,q.clone()])), root: pose.root.clone() });
const mixPose = (a,b,weight) => ({ rotations: new Map([...a.rotations].map(([name,q])=>[name,q.clone().slerp(b.rotations.get(name) ?? q,weight)])), root:a.root.clone().lerp(b.root,weight) });
const blendDuration=(a,b,minimum=.6)=>Math.ceil(Math.max(minimum,Math.max(...[...a.rotations].map(([name,q])=>q.angleTo(b.rotations.get(name)??q)))*1.5/3.5)*60)/60;

/** A donor's belly can penetrate below its rest floor while lying down.
 * That minimum must not make the later standing pose appear airborne.
 */
export function floorAirbornePolicy(metadata) {
  return GROUNDED.has(metadata.actionId) ? 'grounded-floor-action' : metadata.actionId === 325 ? 'bilateral-foot-lift'
    : REST_FLOOR_AIRBORNE.has(metadata.actionId)?'full-body-rest-floor':'source-skin';
}

export function adaptFloorAirborne(metadata, original, footMinima, legRatio, sourceSupport) {
  const policy = floorAirbornePolicy(metadata);
  if (policy === 'grounded-floor-action') return { values: original.map(()=>0), policy };
  if (policy === 'source-skin') return { values: [...original], policy };
  if(policy==='full-body-rest-floor') {
    if(!Array.isArray(sourceSupport?.heights)||sourceSupport.heights.length!==original.length
      ||!sourceSupport.heights.every(Number.isFinite)||!Number.isFinite(sourceSupport.restFloor)||!(legRatio>0))throw new Error('Falling and airborne floor actions require the actual source skin rest floor');
    return {values:sourceSupport.heights.map(height=>Math.max(0,height-sourceSupport.restFloor-.008)*legRatio),policy,sourceRestFloor:sourceSupport.restFloor};
  }
  if (!Array.isArray(footMinima) || footMinima.length !== original.length || !(legRatio > 0)
    || footMinima.some(feet=>!Array.isArray(feet)||feet.length!==2||!feet.every(Number.isFinite))) throw new Error('Jump push-up requires actual source foot-surface samples');
  const floors = [0,1].map(side=>footMinima.map(feet=>feet[side]).sort((a,b)=>a-b)[Math.floor(footMinima.length*.1)]);
  return { values: footMinima.map(feet=>Math.max(0,Math.min(feet[0]-floors[0],feet[1]-floors[1])-.008)*legRatio), policy, sourceFootFloors:floors };
}

export async function createFloorTransitionLibrary(masterPath, contract, existingSupport) {
  const asset = await loadDoreumiAsset(masterPath), support = existingSupport ?? await createMasterSupport(masterPath,contract);
  return { contract, support, masterClips:asset.clips, handSampler:createPlanarFootSampler(asset.document,{L:['wristL'],R:['wristR']},{morphWeight:1}) };
}

function sampler(clip, names) {
  const tracks = clip.tracks.filter(track=>track.name==='DoreumiRig.position'||(track.name.endsWith('.quaternion')&&names.has(track.name.split('.')[0])))
    .map(track=>({name:track.name.split('.')[0],property:track.name.split('.')[1],sample:track.createInterpolant()}));
  return time => {
    const pose={rotations:new Map(),root:new Vector3()};
    for(const track of tracks) { const value=track.sample.evaluate(time); if(track.property==='quaternion')pose.rotations.set(track.name,new Quaternion().fromArray(value));else pose.root.fromArray(value); }
    return pose;
  };
}

function applyPose(target, pose) {
  for(const node of target.ordered) {
    node.quaternion.copy(pose.rotations.get(node.name) ?? node.restLocalQuaternion);
    if(node.name==='DoreumiRig')node.position.copy(pose.root);
    updateNode(node);
  }
}

function poseFromTarget(target, names) {
  return {rotations:new Map([...names].map(name=>[name,target.byName.get(name).quaternion.clone()])),root:target.byName.get('DoreumiRig').position.clone()};
}

function describeEndpoint(target, pose, support, metadata) {
  applyPose(target,pose);
  const body=target.byName.get('body'),tilt=UP.angleTo(UP.clone().applyQuaternion(body.worldQuaternion))/RAD;
  const face=FORWARD.clone().applyQuaternion(body.worldQuaternion).y;
  const knees=['L','R'].map(side=>target.byName.get(`knee${side}`).quaternion.angleTo(target.byName.get(`knee${side}`).restLocalQuaternion)/RAD);
  let kind='standing';
  if((/kneel/i.test(metadata.sourceName??'')||tilt<50&&face<0)&&Math.max(...knees)>95)kind='kneeling';
  else if(tilt>48&&Math.abs(face)<.60)kind='side';
  else if(face<-.35&&(tilt>48||Math.max(...knees)>100))kind=Math.min(...knees)>95?'kneeling':'prone';
  else if(face>.60&&tilt>48)kind='reclined';
  else if(body.worldPosition.y<.36||Math.max(...knees)>65)kind='seated';
  return {kind,tilt,face,knees,minimum:support.measure(target),bodyHeight:body.worldPosition.y};
}

/** Inspect the decoded source boundaries without changing either the clip or
 * its root motion. This same classifier drives the supported transition path. */
export function describeFloorEndpoints(clip, evidence, metadata, library) {
  const names = new Set(clip.tracks.filter(track => track.name.endsWith('.quaternion')).map(track => track.name.split('.')[0]));
  const sample = sampler(clip, names), target = targetGraph(library.contract);
  return Object.fromEntries(['entry', 'exit'].map((phase, index) => [phase,
    describeEndpoint(target, sample(evidence.entryDuration + (index ? evidence.sourceDuration : 0)), library.support, metadata)]));
}

function groundPose(target, pose, support, lift=0) {
  const grounded=clonePose(pose); applyPose(target,grounded);
  grounded.root.y+=.002-support.measure(target)+lift;
  return grounded;
}

function bracePose(library,target,kneel,endpoint,names) {
  const {support,handSampler}=library;
  applyPose(target,endpoint);
  const endRight=new Vector3(1,0,0).applyQuaternion(target.byName.get('body').worldQuaternion);endRight.y=0;endRight.normalize();
  const yaw=Math.atan2(-endRight.z,endRight.x),heading=new Quaternion().setFromAxisAngle(UP,yaw);
  applyPose(target,kneel);
  const thighWorld=Object.fromEntries(['L','R'].map(side=>[side,heading.clone().multiply(target.byName.get(`thigh${side}`).worldQuaternion)]));
  let best;
  for(const lean of [55,65,75,85]) {
    // A symmetric kneel is the supporting waypoint. Blending the source's
    // rolled/asymmetric shoulders here can leave one short arm out of reach.
    const pose=clonePose(kneel);
    pose.rotations.set('body',heading.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),lean*RAD)));
    pose.rotations.set('torso',target.byName.get('torso').restLocalQuaternion.clone());
    pose.rotations.set('head',target.byName.get('head').restLocalQuaternion.clone());
    applyPose(target,pose);
    for(const side of ['L','R'])pose.rotations.set(`thigh${side}`,target.byName.get('body').worldQuaternion.clone().invert().multiply(thighWorld[side]));
    applyPose(target,groundPose(target,pose,support));
    const update=()=>target.ordered.forEach(updateNode);
    let maxReachClamp=0;
    for(const side of ['L','R']) {
      const sign=side==='L'?1:-1,shoulder=target.byName.get(`shoulder${side}`),arm=target.byName.get(`arm${side}`),wrist=target.byName.get(`wrist${side}`);
      const body=target.byName.get('body'),right=new Vector3(1,0,0).applyQuaternion(body.worldQuaternion);right.y=0;right.normalize();
      const forward=right.clone().cross(UP).normalize(),depth=Math.max(.28,shoulder.worldPosition.clone().sub(body.worldPosition).dot(forward)+.10);
      const goal=body.worldPosition.clone().addScaledVector(right,sign*.59).addScaledVector(forward,depth);goal.y=.055;
      const direction=goal.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
      const collar=new Quaternion().setFromUnitVectors(arm.position.clone().normalize(),direction),angle=new Quaternion().angleTo(collar);
      shoulder.quaternion.copy(new Quaternion().slerp(collar,Math.min(1,104.8*RAD/angle)));
      wrist.quaternion.copy(wrist.restLocalQuaternion);update();
      for(let iteration=0;iteration<8;iteration++) {
        const points=handSampler.sample(target)[side],lowest=points.reduce((a,b)=>a[1]<b[1]?a:b);
        const wristGoal=wrist.worldPosition.clone();wristGoal.y+=.002-lowest[1];
        wristGoal.x=goal.x;wristGoal.z=goal.z;
        maxReachClamp=Math.max(maxReachClamp,solveHand(target,side,wristGoal,1,update,new Vector3(sign,-.3,-.3)));
      }
    }
    let resolved=poseFromTarget(target,names);resolved=groundPose(target,resolved,support);applyPose(target,resolved);
    const hands=handSampler.sample(target),handHeights=['L','R'].map(side=>Math.min(...hands[side].map(point=>point[1])));
    const score=Math.max(...handHeights)+maxReachClamp;
    if(!best||score<best.score)best={pose:resolved,score,handHeights,maxReachClamp,lean};
  }
  return best;
}

function createPath(library,target,endpoint,names,metadata) {
  const description=describeEndpoint(target,endpoint,library.support,metadata);
  if(description.kind==='standing')return null;
  const samples=Object.fromEntries(['Idle','Sit','Lie','NewYearBow'].map(name=>[name,sampler(library.masterClips.find(clip=>clip.name===name),names)]));
  const idle=samples.Idle(0),seated=samples.Sit(1.15),kneel=samples.NewYearBow(1.1);
  const fill=pose=>{for(const name of names)if(!pose.rotations.has(name))pose.rotations.set(name,idle.rotations.get(name)?.clone()??target.byName.get(name).restLocalQuaternion.clone());return pose;};
  [idle,seated,kneel].forEach(fill);
  // The frozen legacy master clips do not all start with Idle's exact elbow
  // rotation. Ease that offset in before using their authored support path.
  const authored=(name,time,endTime)=>{
    const pose=mixPose(idle,fill(samples[name](time)),smooth(time/.3)),end=fill(samples[name](endTime));
    // Reusing the old arm IK frame-by-frame can cross its elbow pole branch.
    // Keep the master pelvis/legs path and move the arms continuously to the
    // same waypoint, before the separately solved floor-bracing phase.
    for(const name of names)if(/^(shoulder|arm|elbow|wrist)/.test(name))pose.rotations.set(name,idle.rotations.get(name).clone().slerp(end.rotations.get(name),smooth(time/endTime)));
    return pose;
  };
  let duration,phase,bracing,stages;
  if(description.kind==='seated') {
    const finish=blendDuration(seated,endpoint);duration=1.15+finish;
    phase=time=>time<=1.15?authored('Sit',time,1.15):mixPose(seated,endpoint,smooth((time-1.15)/finish));
  } else if(description.kind==='reclined'||description.kind==='side') {
    const endTime=description.kind==='side'||description.tilt>=80?1.8:1.35;
    const reclined=fill(samples.Lie(endTime)),finish=blendDuration(reclined,endpoint);duration=endTime+finish;
    phase=time=>time<=endTime?authored('Lie',time,endTime):mixPose(reclined,endpoint,smooth((time-endTime)/finish));
  } else if(description.kind==='kneeling'&&description.tilt<50) {
    const finish=blendDuration(kneel,endpoint);duration=1.1+finish;
    phase=time=>time<=1.1?authored('NewYearBow',time,1.1):mixPose(kneel,endpoint,smooth((time-1.1)/finish));
  } else {
    bracing=bracePose(library,target,kneel,endpoint,names);
    const approach=blendDuration(kneel,bracing.pose,.65),finish=blendDuration(bracing.pose,endpoint),braceStart=1.1+approach,braceEnd=braceStart+.15;
    duration=braceEnd+finish;stages={kneelEnd:1.1,braceStart,braceEnd};
    phase=time=>time<=1.1?authored('NewYearBow',time,1.1):time<=braceStart?mixPose(kneel,bracing.pose,smooth((time-1.1)/approach))
      :time<=braceEnd?clonePose(bracing.pose):mixPose(bracing.pose,endpoint,smooth((time-braceEnd)/finish));
  }
  return {duration,description,stages,bracing:bracing&&{handHeights:bracing.handHeights,maxReachClamp:bracing.maxReachClamp,lean:bracing.lean},sample(time){
    if(time<=0)return clonePose(idle);if(time>=duration)return clonePose(endpoint);
    return groundPose(target,phase(time),library.support,(description.minimum-.002)*smooth((time-(duration-.3))/.3));
  }};
}

/** Replace only authored entry/recovery. Every original source key and its
 * interpolated boundary value is copied; the source motion itself is untouched.
 */
export function adaptFloorTransitions(clip,evidence,metadata,library,{force=false}={}) {
  if(!force&&!FLOOR_TRANSITION_ACTIONS.has(metadata.actionId))return {clip,evidence};
  const names=new Set(clip.tracks.filter(track=>track.name.endsWith('.quaternion')).map(track=>track.name.split('.')[0]));
  const sample=sampler(clip,names),sourceStart=evidence.entryDuration,sourceEnd=sourceStart+evidence.sourceDuration;
  const target=targetGraph(library.contract), first=sample(sourceStart);
  const firstDescription=describeEndpoint(target,first,library.support,metadata);
  // A falling fragment may begin metres above the floor. A floor-lying
  // waypoint followed by a last-moment vertical lift would invent a teleport.
  // Preserve that existing airborne approach until its launch/support context
  // has its own measured path; the grounded recovery is independently useful.
  const deferredEntry=SOURCE_PRESERVED_FLOOR_ACTIONS.has(metadata.actionId)&&firstDescription.minimum>.12
    ?{reason:'source-begins-airborne; requires-launch-or-environment-approach',...firstDescription}:null;
  const entry=deferredEntry?null:createPath(library,target,first,names,metadata),exit=createPath(library,target,sample(sourceEnd),names,metadata);
  if(!entry&&!exit)return deferredEntry?{clip,evidence:{...evidence,floorTransitions:{version:1,sourceKeysPreserved:true,entry:null,exit:null,deferredEntry}}}:{clip,evidence};
  const entryDuration=entry?.duration??evidence.entryDuration,exitDuration=exit?.duration??evidence.exitDuration;
  const duration=entryDuration+evidence.sourceDuration+exitDuration;
  // Ground each pose once. The skin envelope is shared by every bone track.
  const entryFrames=entry?Array.from({length:Math.ceil(entryDuration*60)},(_,index)=>({time:index/60,pose:entry.sample(index/60)})):[];
  const exitFrames=exit?Array.from({length:Math.ceil(exitDuration*60)},(_,index)=>{
    const time=Math.min((index+1)/60,exitDuration);return {time,pose:exit.sample(exitDuration-time)};
  }):[];
  const bounds={...evidence.bounds};
  for(const {pose} of [...entryFrames,...exitFrames]) {
    applyPose(target,pose);const frame=library.support.measure(target,true);
    for(const key of ['minX','minY','minZ'])bounds[key]=Math.min(bounds[key],frame[key]);
    for(const key of ['maxX','maxY','maxZ','radius'])bounds[key]=Math.max(bounds[key],frame[key]);
  }
  const tracks=[];
  for(const track of clip.tracks) {
    const quaternion=track.name.endsWith('.quaternion'),name=track.name.split('.')[0],size=track.getValueSize(),interpolant=track.createInterpolant(),times=[],values=[];
    if(!quaternion&&track.name!=='DoreumiRig.position')throw new Error(`Unsupported floor-transition track: ${track.name}`);
    const append=(time,value)=>{if(times.length&&Math.abs(time-times.at(-1))<1e-7){values.splice(values.length-size,size,...value);return;}times.push(time);values.push(...value);};
    const poseValue=pose=>quaternion?pose.rotations.get(name).toArray():pose.root.toArray();
    if(entry)for(const {time,pose} of entryFrames)append(time,poseValue(pose));
    else for(const time of track.times)if(time<sourceStart)append(time,[...interpolant.evaluate(time)]);
    append(entryDuration,[...interpolant.evaluate(sourceStart)]);
    for(const time of track.times)if(time>sourceStart&&time<sourceEnd)append(entryDuration+time-sourceStart,[...interpolant.evaluate(time)]);
    append(entryDuration+evidence.sourceDuration,[...interpolant.evaluate(sourceEnd)]);
    if(exit)for(const {time,pose} of exitFrames)append(entryDuration+evidence.sourceDuration+time,poseValue(pose));
    else for(const time of track.times)if(time>sourceEnd)append(entryDuration+time-sourceStart,[...interpolant.evaluate(time)]);
    tracks.push(quaternion?new QuaternionKeyframeTrack(track.name,times,values):new VectorKeyframeTrack(track.name,times,values));
  }
  const result=new AnimationClip(clip.name,duration,tracks);
  return {clip:result,evidence:{...evidence,duration,entryDuration,exitDuration,bounds,
    retainedKeys:tracks.reduce((sum,track)=>sum+track.times.length,0),
    framing:{halfHeight:Math.max((bounds.maxY-bounds.minY)/2+.16,bounds.radius+.16),centerY:(bounds.minY+bounds.maxY)/2},
    transitions:'master-sit-kneel-recline-supported-entry-and-recovery; original-source-keys-preserved',
    floorTransitions:{version:1,sourceKeysPreserved:true,...(deferredEntry?{deferredEntry}:{}),entry:entry&&{...entry.description,duration:entryDuration,stages:entry.stages,bracing:entry.bracing},exit:exit&&{...exit.description,duration:exitDuration,stages:exit.stages,bracing:exit.bracing}}}};
}
