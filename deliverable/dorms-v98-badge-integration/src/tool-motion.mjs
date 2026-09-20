import {AnimationClip,QuaternionKeyframeTrack,Vector3,Quaternion} from 'three';
export const TOOL_ACTIONS={MegaphoneSpeak:'megaphone',CarryBag:'christmas-gift-sack'};
export function createToolClips(idle){
 const arm=idle.tracks.find(t=>t.name==='armL.quaternion');if(!arm)throw new Error('V60 armL track missing');
 return Object.keys(TOOL_ACTIONS).map(name=>{
  const times=[0,.6,1.3,2,2.7,3.4,4.1,4.8,5.5,6];
  const levels=name==='MegaphoneSpeak'?[0,.25,1,1,.96,1,.97,1,.25,0]:[0,.7,1,.95,1,.95,1,.95,.7,0];
  const rest=new Vector3(.234528,-.233184,.132414).normalize();
  const target=name==='MegaphoneSpeak'?new Vector3(-.23,.08,.38):new Vector3(.29,-.15,.12);
  const delta=new Quaternion().setFromUnitVectors(rest,target.normalize());
  const tracks=idle.tracks.map(t=>{
   const first=Array.from(t.values.slice(0,t.getValueSize()));
   if(t.name==='armL.quaternion'||t.name==='shoulderL.quaternion'){
    const q=new Quaternion().fromArray(first),factor=t.name.startsWith('shoulder')?.10:1;
    return new QuaternionKeyframeTrack(t.name,times,levels.flatMap(v=>new Quaternion().slerp(delta,v*factor).multiply(q).toArray()));
   }
   // Freeze non-tool joints at the approved neutral pose; no source tracks edited.
   const clone=t.clone();clone.times=new Float32Array([0,6]);clone.values=new Float32Array([...first,...first]);return clone;
  });return new AnimationClip(name,6,tracks);
 });
}
