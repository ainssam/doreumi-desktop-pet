import test from 'node:test';
import assert from 'node:assert/strict';
import { auditContactSamples } from '../scripts/doreumi/meshy-contact-audit.mjs';
const sole = [[0,.002,0],[.1,.002,0],[0,.002,.1]];
const raised = sole.map(([x,,z])=>[x,1,z]);
const frame = L => ({L,R:raised});
const base = {times:[0,1/30],sourceFeet:[frame(sole),frame(sole)],sourceFloor:.002,sourceHeight:2,targetHeight:2};
test('contact audit distinguishes a stationary pivot from whole-patch sliding and missing contact',()=>{
 const pivot=sole.map(([x,y,z])=>[-z,y,x]);
 const result=auditContactSamples({...base,targetFeet:[frame(sole),frame(pivot)]});
 assert.equal(result.sourcePlantedPairs,1);assert.equal(result.pivotCompatiblePairs,1);assert.deepEqual(result.failures,[]);
 const slide=auditContactSamples({...base,targetFeet:[frame(sole),frame(sole.map(([x,y,z])=>[x+.03,y,z]))]});
 assert.equal(slide.excessiveDriftPairs,1);assert.equal(slide.maxDriftByHeight,.015);
 const floating=auditContactSamples({...base,targetFeet:[frame(sole),frame(raised)]});
 assert.equal(floating.sourcePlantedPairs,1);assert.equal(floating.missingTargetContactPairs,1);assert.equal(floating.failures[0].missing,true);
});
test('source-authored moving contact is counted separately rather than forced stationary',()=>{
 const moving=sole.map(([x,y,z])=>[x+.03,y,z]);
 const result=auditContactSamples({...base,sourceFeet:[frame(sole),frame(moving)],targetFeet:[frame(sole),frame(moving)]});
 assert.equal(result.sourceMovingContactPairs,1);assert.equal(result.sourcePlantedPairs,0);assert.deepEqual(result.failures,[]);
});
test('retimed contact compares actual playback drift at the same 30 Hz speed threshold',()=>{
 const interval=sole.map(([x,y,z])=>[x+.006,y,z]);
 const oldClock=auditContactSamples({...base,targetFeet:[frame(sole),frame(interval)]});
 assert.equal(oldClock.sourcePlantedPairs,1);assert.equal(oldClock.excessiveDriftPairs,0);
 // The same source30Hz pair spans only 1/150 playback second at 5x speed.
 // Its .006 displacement is .03 per 1/30 second, so it must fail the .02 limit.
 const fast=auditContactSamples({...base,targetFeet:[frame(sole),frame(interval)],targetTimeScale:5});
 assert.equal(fast.sourcePlantedPairs,1);assert.equal(fast.excessiveDriftPairs,1);
 assert.ok(Math.abs(fast.maxDriftByHeight-.015)<1e-12);
 for(const targetTimeScale of [0,-1,NaN,Infinity,17]) assert.throws(()=>auditContactSamples({...base,targetFeet:[frame(sole),frame(interval)],targetTimeScale}),/contact clock/);
});
test('joint audit catches a world-space spin hidden by matching endpoint foot orientations',async()=>{
 const {Quaternion,Vector3}=await import('three');
 const {measureJointStep}=await import('../scripts/doreumi/meshy-joint-audit.mjs');
 const axis=new Vector3(1,0,0),identity=new Quaternion();
 const pose=angle=>{const local=new Quaternion().setFromAxisAngle(axis,angle);return {local,world:local.clone().multiply(local),position:new Vector3(),sourceLocal:identity,sourceWorld:identity};};
 const start=pose(0),middle=pose(Math.PI/2),end=pose(Math.PI);
 assert.ok(start.world.angleTo(end.world)<1e-7);
 const step=measureJointStep(start,middle);
 assert.equal(step.sourceWorldDegrees,0);assert.ok(Math.abs(step.targetWorldDegrees-180)<1e-7);
 assert.ok(Math.abs(step.targetLocalDegrees-90)<1e-7);
});
