import { AnimationClip, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode } from './meshy-retarget.mjs';
import { adaptFloorTransitions } from './meshy-transition.mjs';
import { solveHand } from './meshy-adaptation.mjs';
import { createPlanarFootSampler } from './meshy-planar-support.mjs';
import { createSourceSupport } from './meshy-master-support.mjs';

export const FLOOR_ACROBATIC_ACTIONS=new Set([375,395,406,451]);
const X=new Vector3(1,0,0),Y=new Vector3(0,1,0),Z=new Vector3(0,0,1),TAU=2*Math.PI;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
const clone=pose=>({root:pose.root.clone(),rotations:new Map([...pose.rotations].map(([name,q])=>[name,q.clone()]))});
const mix=(a,b,t)=>({root:a.root.clone().lerp(b.root,t),rotations:new Map([...a.rotations].map(([name,q])=>[name,q.clone().slerp(b.rotations.get(name)??q,t)]))});
const rotation=(axis,angle)=>new Quaternion().setFromAxisAngle(axis,angle);

/** One actual source palm material point, sampled through its first lift-off.
 * Donor wrist origin motion is not used as a substitute for surface contact. */
export function sourcePalmSupport(document, animation) {
  const graph=sourceGraph(document),support=createSourceSupport(document),restFloor=support.measure(graph);
  const sampler=createPlanarFootSampler(document,{L:['LeftHand'],R:['RightHand']},{morphWeight:0});
  const channels=animation.listChannels().map(channel=>samplerFor(channel,graph)),frames=[];
  let vertex,contactEnd=0;
  for(let index=0;index<=48;index++) {
    const time=index/60;
    for(const channel of channels)channel.node[channel.path==='translation'?'position':channel.path==='rotation'?'quaternion':'scale'].fromArray(sampleChannel(channel,time));
    graph.ordered.forEach(updateNode);
    const points=sampler.sample(graph).R,minimum=Math.min(...points.map(point=>point[1]));
    if(vertex===undefined)vertex=points.reduce((best,point,i)=>point[1]<points[best][1]?i:best,0);
    if(time>.1&&minimum>restFloor+.025)break;
    const arm=graph.byName.get('RightArm').worldPosition,elbow=graph.byName.get('RightForeArm').worldPosition,hand=graph.byName.get('RightHand').worldPosition;
    const axis=hand.clone().sub(arm).normalize(),pole=elbow.clone().sub(arm);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
    contactEnd=time;frames.push({time,point:points[vertex],minimum,armPole:pole.toArray()});
  }
  const duration=Math.max(...channels.map(channel=>channel.times.at(-1)));
  const feet=createPlanarFootSampler(document,{L:['LeftFoot','LeftToeBase'],R:['RightFoot','RightToeBase']},{morphWeight:0});
  const floorFrames=[];
  for(let index=0;index<=Math.ceil(duration*60);index++) {
    const time=Math.min(index/60,duration);
    for(const channel of channels)channel.node[channel.path==='translation'?'position':channel.path==='rotation'?'quaternion':'scale'].fromArray(sampleChannel(channel,time));
    graph.ordered.forEach(updateNode);const skin=feet.sample(graph);
    floorFrames.push({time,minimum:support.measure(graph),feet:[Math.min(...skin.L.map(point=>point[1])),Math.min(...skin.R.map(point=>point[1]))]});
  }
  // This particular flair finishes in a stable two-foot stance. Calibrate to
  // that actual sole surface; the earlier donor palm penetrates its rest floor
  // by .10 units and must never lower the airborne reference for the whole clip.
  const landing=floorFrames.filter(frame=>frame.time>=duration-.35);
  const soles=landing.map(frame=>Math.min(...frame.feet)).sort((a,b)=>a-b);
  const verticalRange=soles.at(-1)-soles[0];
  if(verticalRange>.025)throw new Error('Flair landing is not stable enough to calibrate the source floor.');
  const landingFloor=soles[Math.floor(soles.length*.1)];
  return {version:1,vertex:sampler.vertexIds.R[vertex],restFloor,contactEnd,frames,
    floorCalibration:{version:1,method:'actual-final-stable-foot-stance',sourceInterval:[duration-.35,duration],restFloor,landingFloor,verticalRange,contactTolerance:.008},
    floorFrames};
}

function sampleClip(clip,contract) {
  const tracks=clip.tracks.filter(track=>track.name.endsWith('.quaternion')||track.name==='DoreumiRig.position')
    .map(track=>({name:track.name.split('.')[0],property:track.name.split('.')[1],sample:track.createInterpolant()}));
  return time=>{
    const pose={root:new Vector3(),rotations:new Map(contract.bones.map(b=>[b.name,new Quaternion().fromArray(b.restLocalQuaternion)]))};
    for(const track of tracks) { const value=track.sample.evaluate(time);if(track.property==='quaternion')pose.rotations.get(track.name).fromArray(value).normalize();else pose.root.fromArray(value); }
    return pose;
  };
}

function apply(target,pose) {
  for(const node of target.ordered) {node.quaternion.copy(pose.rotations.get(node.name));if(node.name==='DoreumiRig')node.position.copy(pose.root);updateNode(node);}
}

function capture(target) {
  return {root:target.byName.get('DoreumiRig').position.clone(),rotations:new Map(target.ordered.map(node=>[node.name,node.quaternion.clone()]))};
}

function ground(target,pose,support) {
  apply(target,pose);pose.root.y+=.004-support.measure(target);apply(target,pose);return pose;
}

function refineFlairFloor(result,library,palmSource,legRatio) {
  const {clip,evidence}=result,entry=evidence.entryDuration,end=entry+evidence.sourceDuration;
  const release=entry+evidence.acrobatics.palmPlanarSupport.sourceInterval[1];
  const oldRoot=clip.tracks.find(track=>track.name==='DoreumiRig.position');
  const keyTimes=new Set([...oldRoot.times]);
  for(let frame=0;frame<=Math.ceil(evidence.sourceDuration*120);frame++)keyTimes.add(Math.fround(entry+Math.min(frame/120,evidence.sourceDuration)));
  const times=[...keyTimes].sort((a,b)=>a-b),sample=sampleClip(clip,library.contract),target=targetGraph(library.contract),values=[];
  let maximumCorrection=0;
  for(const time of times) {
    const pose=sample(time);
    if(time>release+1e-6&&time<end-1e-6) {
      const sourceTime=time-entry,frame=Math.min(palmSource.floorFrames.length-2,Math.floor(sourceTime*60));
      const a=palmSource.floorFrames[frame],b=palmSource.floorFrames[frame+1];
      const ratio=Math.max(0,Math.min(1,(sourceTime-a.time)/(b.time-a.time)));
      const sourceMinimum=a.minimum+(b.minimum-a.minimum)*ratio,calibration=palmSource.floorCalibration;
      const height=.004+Math.max(0,sourceMinimum-calibration.landingFloor-calibration.contactTolerance)*legRatio;
      apply(target,pose);const correction=height-library.support.measure(target);
      pose.root.y+=correction;maximumCorrection=Math.max(maximumCorrection,Math.abs(correction));
    }
    values.push(...pose.root.toArray());
  }
  // During transfer from a palm to the round head, linear root interpolation
  // lifts both contact surfaces between otherwise grounded 60Hz keys. Bake the
  // skin envelope at 120Hz without changing any arm or source joint rotation.
  const tracks=clip.tracks.map(track=>track===oldRoot?new VectorKeyframeTrack(oldRoot.name,times,values):track);
  return {clip:new AnimationClip(clip.name,clip.duration,tracks),evidence:{...evidence,
    acrobatics:{...evidence.acrobatics,verticalSupport:{version:1,fps:120,maximumCorrection,sourceFloorCalibration:palmSource.floorCalibration}}}};
}

function basis(direction,pole) {
  const x=direction.clone().normalize(),y=pole.clone().addScaledVector(x,-pole.dot(x));
  if(y.lengthSq()<1e-8)y.copy(Math.abs(x.z)<.8?Z:Y).addScaledVector(x,-x.dot(Math.abs(x.z)<.8?Z:Y));
  y.normalize();return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,x.clone().cross(y)));
}

/** A collar plus two fixed arm segments. Absolute rest-axis frames avoid
 * accumulating the unconstrained twist of successive shortest-arc corrections. */
function handTo(target,side,goal,worldWrist=new Quaternion(),referencePole) {
  const shoulder=target.byName.get(`shoulder${side}`),arm=target.byName.get(`arm${side}`),elbow=target.byName.get(`elbow${side}`),wrist=target.byName.get(`wrist${side}`);
  const update=()=>target.ordered.forEach(updateNode),direction=goal.clone().sub(shoulder.worldPosition).normalize();
  const collarWorld=new Quaternion().setFromUnitVectors(arm.position.clone().normalize(),direction);
  shoulder.quaternion.copy(shoulder.parent.worldQuaternion.clone().invert().multiply(collarWorld));update();
  const origin=arm.worldPosition.clone(),upper=elbow.position.clone(),lower=wrist.position.clone(),a=upper.length(),b=lower.length();
  const ray=goal.clone().sub(origin),requested=ray.length(),distance=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,requested));ray.normalize();
  const pole=referencePole?.clone()??new Vector3(side==='L'?.15:-.15,1,.6);pole.addScaledVector(ray,-pole.dot(ray)).normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,a*a-along*along));
  const elbowGoal=origin.clone().addScaledVector(ray,along).addScaledVector(pole,bend),reachable=origin.clone().addScaledVector(ray,distance);
  const worldNormal=ray.clone().cross(pole).normalize();
  const upperWorld=basis(elbowGoal.clone().sub(origin),worldNormal).multiply(basis(upper,upper.clone().cross(Z)).invert());
  arm.quaternion.copy(arm.parent.worldQuaternion.clone().invert().multiply(upperWorld));update();
  const lowerWorld=basis(reachable.clone().sub(elbowGoal),worldNormal).multiply(basis(lower,lower.clone().cross(Z)).invert());
  elbow.quaternion.copy(elbow.parent.worldQuaternion.clone().invert().multiply(lowerWorld));update();
  // A fixed palm orientation keeps its material contact point stable.
  wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(worldWrist));update();
  return Math.max(0,requested-a-b);
}

// With this short, thick forearm, a humanoid elbow plane can put the forearm
// skin below the palm. A vertical distal segment leaves real surface clearance;
// the collar and upper arm solve the remaining two-segment reach.
function floorPalmTo(target,side,goal) {
  const shoulder=target.byName.get(`shoulder${side}`),arm=target.byName.get(`arm${side}`),elbow=target.byName.get(`elbow${side}`),wrist=target.byName.get(`wrist${side}`);
  const update=()=>target.ordered.forEach(updateNode),lower=wrist.position.clone();
  const lowerWorld=new Quaternion().setFromUnitVectors(lower.clone().normalize(),Y.clone().negate());
  const dy=shoulder.worldPosition.y-goal.y-lower.length();
  const radius=Math.sqrt(Math.max(.18**2,.38**2-dy*dy));
  goal=goal.clone();goal.x=shoulder.worldPosition.x-radius*.9486832981;goal.z=shoulder.worldPosition.z+radius*.3162277660;
  const elbowGoal=goal.clone().sub(lower.clone().applyQuaternion(lowerWorld));
  const origin=shoulder.worldPosition.clone(),first=arm.position.clone(),second=elbow.position.clone(),a=first.length(),b=second.length();
  const ray=elbowGoal.clone().sub(origin),requested=ray.length(),distance=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,requested));ray.normalize();
  const pole=new Vector3(side==='L'?1:-1,.2,.3);pole.addScaledVector(ray,-pole.dot(ray)).normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,a*a-along*along));
  const armGoal=origin.clone().addScaledVector(ray,along).addScaledVector(pole,bend),reachable=origin.clone().addScaledVector(ray,distance),normal=ray.clone().cross(pole).normalize();
  const collarDirection=armGoal.clone().sub(origin).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
  shoulder.quaternion.setFromUnitVectors(first.clone().normalize(),collarDirection);update();
  const upperWorld=basis(reachable.clone().sub(armGoal),normal).multiply(basis(second,second.clone().cross(Z)).invert());
  arm.quaternion.copy(arm.parent.worldQuaternion.clone().invert().multiply(upperWorld));update();
  elbow.quaternion.copy(elbow.parent.worldQuaternion.clone().invert().multiply(lowerWorld));update();
  wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert());update();
  return Math.max(0,requested-a-b);
}

function supportHand(target,side,goal,weight,library,preserveAuthored=false,referencePole) {
  const before=capture(target),wrist=target.byName.get(`wrist${side}`);let maxReachClamp=0;
  const worldWrist=wrist.worldQuaternion.clone(),arm=target.byName.get(`arm${side}`),elbow=target.byName.get(`elbow${side}`);
  const authoredAxis=wrist.worldPosition.clone().sub(arm.worldPosition).normalize(),authoredPole=elbow.worldPosition.clone().sub(arm.worldPosition);
  authoredPole.addScaledVector(authoredAxis,-authoredPole.dot(authoredAxis));
  if(authoredPole.lengthSq()<.0001)authoredPole.copy(Y).addScaledVector(authoredAxis,-authoredAxis.y);
  const localPole=(referencePole?.clone()??authoredPole).normalize().applyQuaternion(target.byName.get('torso').worldQuaternion.clone().invert());
  for(let iteration=0;iteration<7;iteration++) {
    const points=library.handSampler.sample(target)[side],minimum=Math.min(...points.map(point=>point[1]));
    const requested=new Vector3(goal[0],wrist.worldPosition.y+.002-minimum,goal[1]);
    if(preserveAuthored&&referencePole) {
      maxReachClamp=Math.max(maxReachClamp,floorPalmTo(target,side,requested));
    } else if(preserveAuthored) {
      const update=()=>target.ordered.forEach(updateNode);
      const shoulder=target.byName.get(`shoulder${side}`),initial=before.rotations.get(`shoulder${side}`);
      const direction=requested.clone().sub(shoulder.worldPosition).normalize().applyQuaternion(shoulder.parent.worldQuaternion.clone().invert());
      const aimed=new Quaternion().setFromUnitVectors(arm.position.clone().normalize(),direction);
      shoulder.quaternion.copy(initial);update();
      const desiredReach=(elbow.position.length()+wrist.position.length())*.96;
      if(arm.worldPosition.distanceTo(requested)>desiredReach) {
        let lower=0,upper=1;
        for(let step=0;step<14;step++) {
          const amount=(lower+upper)/2;shoulder.quaternion.copy(initial).slerp(aimed,amount);update();
          if(arm.worldPosition.distanceTo(requested)>desiredReach)lower=amount;else upper=amount;
        }
        shoulder.quaternion.copy(initial).slerp(aimed,upper);update();
      }
      maxReachClamp=Math.max(maxReachClamp,solveHand(target,side,requested,1,update,localPole));
      wrist.quaternion.copy(wrist.parent.worldQuaternion.clone().invert().multiply(worldWrist));update();
    } else maxReachClamp=Math.max(maxReachClamp,handTo(target,side,requested));
  }
  const solved=capture(target);
  if(weight<1)for(const prefix of ['shoulder','arm','elbow','wrist']) {
    const name=`${prefix}${side}`;target.byName.get(name).quaternion.copy(before.rotations.get(name).slerp(solved.rotations.get(name),weight));
  }
  target.ordered.forEach(updateNode);
  return maxReachClamp;
}

function unwrap(angles) {
  const result=[angles[0]];
  for(let index=1;index<angles.length;index++) {
    let delta=angles[index]-angles[index-1];while(delta>Math.PI)delta-=TAU;while(delta< -Math.PI)delta+=TAU;
    result.push(result.at(-1)+delta);
  }
  return result;
}

/** Unsupported human handstands are explicitly remapped to a supported mascot
 * variation. The donor clip remains the timing/turn source, never the body.
 * 406 retains all its flair/jump body and leg rotations; only its missing early
 * right-palm support and the authored entry/recovery are changed. */
export function adaptFloorAcrobatics(clip,evidence,metadata,library) {
  const id=metadata.actionId;if(!FLOOR_ACROBATIC_ACTIONS.has(id))return {clip,evidence};
  if(evidence.acrobatics?.version===1)return {clip,evidence};
  const contract=library.contract,target=targetGraph(contract),sample=sampleClip(clip,contract);
  const master=Object.fromEntries(['Idle','Sit','Lie','Roll'].map(name=>[name,sampleClip(library.masterClips.find(c=>c.name===name),contract)]));
  const idle=master.Idle(0),tuck=master.Roll(1.05),duration=evidence.sourceDuration;
  const count=Math.ceil(duration*60),times=Array.from({length:count+1},(_,index)=>Math.min(index/60,duration));
  const source=times.map(time=>sample(evidence.entryDuration+time));
  const turns=unwrap(source.map(pose=>{
    const q=pose.rotations.get('body'),axis=(id===375?Y:Z).clone().applyQuaternion(q);
    return id===375?Math.atan2(-axis.x,axis.y):Math.atan2(axis.x,axis.z);
  }));
  const sourceTurn=turns.at(-1)-turns[0],turnDenominator=Math.abs(sourceTurn)>Math.PI?sourceTurn:TAU;
  const palmSource=id===406?library.sourcePalmSupport:undefined;
  const frames=[],handWeights=[],handResults=[];let maximumReachClamp=0,minimumHandHeight=Infinity,maximumCoreHandHeight=0,coreHandFrames=0;
  for(let index=0;index<times.length;index++) {
    const time=times[index],original=source[index];let pose=clone(original),handWeight=0,handGoal;
    if(id===375) {
      const down=smooth(time/1.1),up=smooth((duration-time)/.95),lying=down*up;
      const progress=Math.max(0,Math.min(1,(turns[index]-turns[0])/turnDenominator));
      pose=master.Lie(1.8*lying);
      pose.rotations.set('body',rotation(Z,sourceTurn*progress).multiply(pose.rotations.get('body')));
      for(const name of pose.rotations.keys())if(/^(shoulder|arm|elbow|wrist|thigh|knee|foot)/.test(name))
        pose.rotations.get(name).slerp(tuck.rotations.get(name),smooth(lying/.85));
      pose.root.x=.26*Math.sin(Math.PI*progress);pose.root.z=0;
    } else if(id===395) {
      pose=clone(tuck);pose.rotations.set('body',rotation(Y,turns[index]-turns[0]).multiply(rotation(X,-Math.PI/2)));
      // Preserve the source leg accents within the supported tucked silhouette.
      for(const name of ['thighL','thighR','kneeL','kneeR','footL','footR'])pose.rotations.get(name).slerp(original.rotations.get(name),.16);
      pose.root.x=0;pose.root.z=0;
    } else if(id===451) {
      const sit=smooth(time/.95)*smooth((duration-time)/.95);
      handWeight=smooth((time-.65)/.5)*smooth((duration-.65-time)/.5);
      const tilt=Y.angleTo(Y.clone().applyQuaternion(original.rotations.get('body'))),balance=smooth((tilt-45*Math.PI/180)/(70*Math.PI/180));
      pose=master.Sit(1.15*sit);
      // Lean through the torso while the seated pelvis/legs keep their support.
      // Tilting the whole body would lower the near knee and lift the root,
      // cancelling the intended shoulder lowering on these very short arms.
      pose.rotations.set('body',rotation(Z,0));
      pose.rotations.set('torso',rotation(Z,.72*handWeight+.04*balance));pose.rotations.set('head',rotation(Z,-.28*handWeight));
      pose.rotations.set('shoulderL',idle.rotations.get('shoulderL').clone().multiply(rotation(Z,.5*handWeight)));
      pose.rotations.set('armL',idle.rotations.get('armL').clone().multiply(rotation(Z,1.12*handWeight)));
      pose.rotations.set('elbowL',idle.rotations.get('elbowL').clone().multiply(rotation(Z,.3*handWeight)));
      pose.root.x=0;pose.root.z=0;handGoal=[-.69,.09];
    } else {
      handWeight=palmSource?1-smooth((time-palmSource.contactEnd)/.16):1-smooth((time-.07)/.04);
      apply(target,pose);const shoulder=target.byName.get('shoulderR');
      // Leave a stable lateral brace between the body and palm. Reusing the
      // long-armed donor's wrist XZ can collapse the two proximal segments when
      // this mascot lowers its shoulder, even though the palm remains reachable.
      handGoal=[shoulder.worldPosition.x-.18,shoulder.worldPosition.z+.06];
    }
    if(id!==406||handWeight>.001)ground(target,pose,library.support);
    else {pose.root.y+=.002;apply(target,pose);}
    if(handWeight>.001) {
      const sourcePole=palmSource?.frames[index]?.armPole;
      const clamp=supportHand(target,'R',handGoal,handWeight,library,id===406,sourcePole?new Vector3(...sourcePole):undefined);
      if(handWeight>.999)maximumReachClamp=Math.max(maximumReachClamp,clamp);
      pose=capture(target);
      if(library.onPalmFrame)library.onPalmFrame({time,clamp,floor:library.support.measure(target,true,true),
        hand:Math.min(...library.handSampler.sample(target).R.map(point=>point[1])),
        arm:Object.fromEntries(['shoulderR','armR','elbowR','wristR'].map(name=>[name,target.byName.get(name).worldPosition.toArray()]))});
      ground(target,pose,library.support);
      const handMinimum=Math.min(...library.handSampler.sample(target).R.map(point=>point[1]));
      handResults[index]={clamp,minimum:handMinimum};
      minimumHandHeight=Math.min(minimumHandHeight,handMinimum);
      if(handWeight>.999){coreHandFrames++;maximumCoreHandHeight=Math.max(maximumCoreHandHeight,handMinimum);}
    }
    frames.push(pose);handWeights.push(handWeight);
  }
  let palmPlanarSupport;
  if(id===406&&palmSource) {
    const sourceLast=Math.min(frames.length-1,Math.round(palmSource.contactEnd*60));
    // The mascot's shoulder rises beyond its unchanged .534-unit arm reach
    // earlier than the human donor. End support at the last genuinely reachable
    // pose instead of stretching the limb or keeping an impossible hand goal.
    let last=0;
    for(let index=0;index<=sourceLast;index++) {
      if(!handResults[index]||handResults[index].clamp>.001||handResults[index].minimum>.015)break;
      last=index;
    }
    const releaseEnd=Math.min(duration,times[last]+.55),endIndex=Math.min(frames.length-1,Math.ceil(releaseEnd*60)),anchor=frames[last];
    const armNames=['shoulderR','armR','elbowR','wristR'];
    apply(target,anchor);const worldFrom=new Map(armNames.map(name=>[name,target.byName.get(name).worldQuaternion.clone()]));
    apply(target,source[endIndex]);const worldTo=new Map(armNames.map(name=>[name,target.byName.get(name).worldQuaternion.clone()]));
    for(let index=last+1;index<frames.length;index++) {
      let original=clone(source[index]);apply(target,original);
      if(index<endIndex) {
        const amount=smooth((times[index]-times[last])/(times[endIndex]-times[last]));
        for(const name of armNames) {
          const node=target.byName.get(name),world=worldFrom.get(name).clone().slerp(worldTo.get(name),amount);
          node.quaternion.copy(node.parent.worldQuaternion.clone().invert().multiply(world));target.ordered.forEach(updateNode);
        }
        original=capture(target);
      }
      const floorFrame=palmSource.floorFrames[index],calibration=palmSource.floorCalibration;
      if(!floorFrame||!calibration)throw new Error('Flair requires actual source foot-floor calibration.');
      const airborne=Math.max(0,floorFrame.minimum-calibration.landingFloor-calibration.contactTolerance)*evidence.legRatio;
      apply(target,original);original.root.y+=.004+airborne-library.support.measure(target);apply(target,original);
      frames[index]=original;handWeights[index]=0;
    }
    maximumReachClamp=Math.max(...handResults.slice(0,last+1).map(result=>result.clamp));
    minimumHandHeight=Math.min(...handResults.slice(0,last+1).map(result=>result.minimum));
    maximumCoreHandHeight=Math.max(...handResults.slice(0,last+1).map(result=>result.minimum));coreHandFrames=last+1;
    apply(target,frames[0]);const initialHands=library.handSampler.sample(target).R;
    const vertex=initialHands.reduce((best,point,i)=>point[1]<initialHands[best][1]?i:best,0);
    const origin=new Vector3(...initialHands[vertex]),sourceOrigin=new Vector3(...palmSource.frames[0].point),offsets=[];
    for(let index=0;index<=last;index++) {
      apply(target,frames[index]);
      const point=new Vector3(...library.handSampler.sample(target).R[vertex]);
      const desired=new Vector3(...palmSource.frames[index].point).sub(sourceOrigin).multiplyScalar(evidence.legRatio).add(origin);
      const offset=new Vector3(desired.x-point.x,0,desired.z-point.z);offsets.push(offset);
      frames[index].root.add(offset);
    }
    // Release the support correction during the following airborne phase.
    // Cubic Hermite retains the last support velocity and reaches zero with
    // zero velocity; it does not smooth the original rotations or jump height.
    const release=.45,lastOffset=offsets.at(-1),velocity=lastOffset.clone().sub(offsets.at(-2)??lastOffset).multiplyScalar(60);
    for(let index=last+1;index<frames.length;index++) {
      const t=(times[index]-times[last])/release;if(t>=1)break;
      const t2=t*t,t3=t2*t;
      frames[index].root.addScaledVector(lastOffset,2*t3-3*t2+1).addScaledVector(velocity,(t3-2*t2+t)*release);
    }
    palmPlanarSupport={version:1,sourceInterval:[0,times[last]],originalSourceContactEnd:palmSource.contactEnd,
      supportRelease:'last-actual-reachable-palm-pose; short-limb-lift-off-adaptation-without-stretch',sourceVertex:palmSource.vertex,
      targetVertex:library.handSampler.vertexIds.R[vertex],method:'source-palm-material-point-planar-retarget-with-C1-airborne-release'};
  }
  if(id===451) {
    const first=handWeights.findIndex(weight=>weight>.999),last=handWeights.findLastIndex(weight=>weight>.999);
    // Reach IK applies only while supporting the body. Entry/release follow one
    // continuous authored arm path, avoiding a near-extension elbow branch as
    // the shoulder is still lowering toward the floor.
    for(let index=0;index<frames.length;index++)if(index<first||index>last) {
      const entering=index<first,anchor=frames[entering?first:last],amount=entering?smooth(times[index]/times[first]):smooth((times[index]-times[last])/(duration-times[last]));
      for(const prefix of ['shoulder','arm','elbow','wrist']) {
        const name=`${prefix}R`,from=entering?idle.rotations.get(name):anchor.rotations.get(name),to=entering?anchor.rotations.get(name):idle.rotations.get(name);
        frames[index].rotations.set(name,from.clone().slerp(to,amount));
      }
      ground(target,frames[index],library.support);
    }
  }
  const entryDuration=evidence.entryDuration,exitDuration=evidence.exitDuration,total=entryDuration+duration+exitDuration;
  const fullFrames=[];
  for(let time=0;time<entryDuration-1e-7;time+=1/60)fullFrames.push({time,pose:ground(target,mix(idle,frames[0],smooth(time/entryDuration)),library.support)});
  for(let index=0;index<frames.length;index++)fullFrames.push({time:entryDuration+times[index],pose:frames[index]});
  for(let index=1;index<=Math.ceil(exitDuration*60);index++) {
    const time=Math.min(index/60,exitDuration);fullFrames.push({time:entryDuration+duration+time,pose:ground(target,mix(frames.at(-1),idle,smooth(time/exitDuration)),library.support)});
  }
  const names=clip.tracks.filter(track=>track.name.endsWith('.quaternion')).map(track=>track.name.split('.')[0]);
  const tracks=names.map(name=>new QuaternionKeyframeTrack(`${name}.quaternion`,fullFrames.map(frame=>frame.time),fullFrames.flatMap(frame=>frame.pose.rotations.get(name).toArray())));
  tracks.push(new VectorKeyframeTrack('DoreumiRig.position',fullFrames.map(frame=>frame.time),fullFrames.flatMap(frame=>frame.pose.root.toArray())));
  const bounds={minX:Infinity,minY:Infinity,minZ:Infinity,maxX:-Infinity,maxY:-Infinity,maxZ:-Infinity,radius:0};
  for(const {pose} of fullFrames) {apply(target,pose);const b=library.support.measure(target,true);for(const key of ['minX','minY','minZ'])bounds[key]=Math.min(bounds[key],b[key]);for(const key of ['maxX','maxY','maxZ','radius'])bounds[key]=Math.max(bounds[key],b[key]);}
  const variants={375:'source-cartwheel-turn-remapped-to-supported-tuck-roll',395:'source-axial-spin-remapped-to-supported-backspin',406:'original-flair-and-jump-with-right-palm-floor-support',451:'source-inversion-timing-remapped-to-one-palm-and-hip-balance'};
  const e={...evidence,duration:total,bounds,semantics:{...evidence.semantics,contactAdaptation:variants[id]},
    ...((id===375||palmPlanarSupport)?{planarSupport:{version:1,maxOffset:Math.max(...fullFrames.map(({pose})=>Math.hypot(pose.root.x,pose.root.z))),method:palmPlanarSupport?.method??'bounded-supported-floor-roll-translation'}}:{}),
    acrobatics:{version:1,variant:variants[id],originalSourceName:metadata.sourceName,sourceDuration:duration,sourceTurn,
      sourceBodyAndLegRotationsPreserved:id===406,handSupportSourceInterval:coreHandFrames?[times[handWeights.findIndex(weight=>weight>.999)],times[handWeights.findLastIndex(weight=>weight>.999)]]:null,
      localTranslationsAndScalesPreserved:true,maximumReachClamp,minimumHandHeight:Number.isFinite(minimumHandHeight)?minimumHandHeight:null,maximumCoreHandHeight,coreHandFrames,
      ...(palmPlanarSupport?{palmPlanarSupport,sourcePalmSupport:palmSource}:{})},
    retainedKeys:tracks.reduce((sum,track)=>sum+track.times.length,0),framing:{halfHeight:Math.max((bounds.maxY-bounds.minY)/2+.16,bounds.radius+.16),centerY:(bounds.minY+bounds.maxY)/2}};
  if(e.planarSupport?.maxOffset>2)throw new Error(`Palm/floor support exceeds the bounded root contract: ${e.planarSupport.maxOffset}`);
  const result=adaptFloorTransitions(new AnimationClip(clip.name,total,tracks),e,metadata,library,{force:true});
  return id===406&&palmSource?refineFlairFloor(result,library,palmSource,evidence.legRatio):result;
}
