import test from 'node:test';import assert from 'node:assert/strict';
import {reconstructInplaceGroundFrame} from '../scripts/doreumi/meshy-inplace-ground.mjs';
const foot=(x,y,z)=>[[x,y,z],[x+.01,y,z],[x,y,z+.01]];
const build=()=>({times:[0,.1,.2,.3],sourceFloor:0,sourceRoots:[[0,1,0],[0,1,0],[0,1,0],[0,1,0]],sourceFeet:[0,1,2,3].map(i=>({L:foot(-.1,0,-i*.1),R:foot(.1,.03,-i*.05)}))});
test('treadmill stance becomes stationary while the other foot retains its relative drag',()=>{
 const input=build(),before=structuredClone(input),r=reconstructInplaceGroundFrame(input);assert.deepEqual(input,before);
 for(let i=0;i<4;i++){assert.ok(Math.abs(r.sourceFeet[i].L[0][2])<1e-12);assert.ok(Math.abs(r.sourceFeet[i].R[0][2]-i*.05)<1e-12);}
 assert.deepEqual(r.evidence.supports.map(s=>s.side),['L','L','L']);assert.ok(Math.abs(r.evidence.positionsXZ.at(-1)[1]-.3)<1e-12);
});
test('airborne interval carries the last observed support velocity and preserves donor height',()=>{
 const input=build();input.sourceFeet[2]={L:foot(-.1,.2,-.2),R:foot(.1,.2,-.1)};input.sourceFeet[3]={L:foot(-.1,.3,-.3),R:foot(.1,.3,-.15)};
 const r=reconstructInplaceGroundFrame(input);assert.equal(r.evidence.supports[1].airborne,true);assert.ok(Math.abs(r.evidence.positionsXZ[3][1]-.3)<1e-12);assert.equal(r.sourceFeet[3].L[0][1],.3);
});
test('ground reconstruction rejects reordered clocks and changed material vertex identity',()=>{
 const a=build();a.times[2]=a.times[1];assert.throws(()=>reconstructInplaceGroundFrame(a),/clock/);
 const b=build();b.sourceFeet[2].L.pop();assert.throws(()=>reconstructInplaceGroundFrame(b),/vertices/);
 const c=build();c.sourceFeet[2].R[0][0]=NaN;assert.throws(()=>reconstructInplaceGroundFrame(c),/vertices/);
});

test('final fractional donor sample remains a positive contact phase in reconstructed mode',async()=>{
 const {serializeContactPhaseTimes}=await import('../scripts/doreumi/meshy-phase-travel.mjs');
 const phase={start:146/30,end:4.866666793823242};
 const exact=serializeContactPhaseTimes(phase,.7,true);assert.ok(exact.end>exact.start);assert.equal(exact.end,phase.end+.7);
 assert.deepEqual(serializeContactPhaseTimes({start:1/30,end:2/30},.7),{start:.733333,end:.766667});
});

test('source ground translation is idempotent and preserves bone direction and height',async()=>{
 const {applyInplaceGroundFrameToGraph}=await import('../scripts/doreumi/meshy-inplace-ground.mjs');
 const hip={worldPosition:{x:0,y:1,z:0}},foot={worldPosition:{x:.1,y:0,z:-.1}},graph={byName:new Map([['Hips',hip]]),ordered:[hip,foot]},input=build(),evidence=reconstructInplaceGroundFrame(input).evidence;
 applyInplaceGroundFrameToGraph(graph,.1,evidence,input.sourceRoots);const once=structuredClone(graph.ordered);applyInplaceGroundFrameToGraph(graph,.1,evidence,input.sourceRoots);assert.deepEqual(graph.ordered,once);assert.equal(foot.worldPosition.y,0);assert.equal(hip.worldPosition.y,1);assert.ok(Math.abs(hip.worldPosition.z-foot.worldPosition.z-.1)<1e-12);
 assert.throws(()=>applyInplaceGroundFrameToGraph(graph,.155,evidence,input.sourceRoots),/clock/);
});
