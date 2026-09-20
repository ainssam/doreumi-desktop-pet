import test from 'node:test';import assert from 'node:assert/strict';import {AnimationClip,QuaternionKeyframeTrack,VectorKeyframeTrack} from 'three';
const module=await import('../src/tool-motion.mjs').catch(()=>({}));
test('tool clips raise and return the arm without changing approved source tracks',()=>{
 assert.equal(typeof module.createToolClips,'function','tool-specific motion is missing');
 const idle=new AnimationClip('Idle',4,[new QuaternionKeyframeTrack('armL.quaternion',[0,4],[0,0,0,1,0,0,0,1]),new QuaternionKeyframeTrack('shoulderL.quaternion',[0,4],[0,0,0,1,0,0,0,1]),new QuaternionKeyframeTrack('head.quaternion',[0,4],[0,0,0,1,0,0,0,1]),new VectorKeyframeTrack('root.position',[0,4],[0,0,0,0,0,0])]);
 const before=JSON.stringify(idle.toJSON());const clips=module.createToolClips(idle);
 assert.equal(JSON.stringify(idle.toJSON()),before);assert.equal(clips.length,2);
 const talk=clips.find(c=>c.name==='MegaphoneSpeak');assert.ok(talk);const t=talk.tracks.find(t=>t.name==='armL.quaternion');
 assert.deepEqual(Array.from(t.values.slice(0,4)),[0,0,0,1]);assert.deepEqual(Array.from(t.values.slice(-4)),[0,0,0,1]);
 assert.ok(Array.from(t.values.slice(4,-4)).some(v=>Math.abs(v)>.1&&Math.abs(v)<.99));
 assert.ok(talk.tracks.every(t=>Array.from(t.values).every(Number.isFinite)));
 assert.deepEqual(Array.from(talk.tracks.find(t=>t.name==='head.quaternion').values),[0,0,0,1,0,0,0,1],'head yaw must stay neutral: turning it tears the V60 head/body boundary');
 assert.throws(()=>module.createToolClips(new AnimationClip('Idle',1,[])),/arm/);
});
