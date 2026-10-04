import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundled = await build({entryPoints:['src/components/doreumi/locomotion.ts'], bundle:true, format:'esm', write:false});
const {stepLocomotion, stepImportedStage, importedStageFits, floorY, wallX, wallInset, nearestWall, clampPosition} = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const b={width:116,height:98,viewportWidth:390,viewportHeight:844,occupiedBottom:82};
const initial={x:110,y:20,vy:0,elapsed:0,phase:'falling',side:'left'};
test('ambient travel fits before takeoff, including a character resting exactly at the wall', async () => {
 const registry=JSON.parse(await readFile('public/doreumi/motions/registry.json','utf8'));
 const walk=registry.motions.find(item=>item.sourceActionId===1).travel;
 const leap=registry.motions.find(item=>item.sourceActionId===518).travel;
 assert.equal(importedStageFits(walk,wallX('right',b),b,42),true);
 assert.equal(importedStageFits(walk,wallX('left',b),b,42),true);
 assert.equal(importedStageFits(leap,129.44,b,42),false);
 const desktop={...b,viewportWidth:1280,width:140};
 assert.equal(importedStageFits(leap,950,desktop,52),true);
});
test('release falls continuously, lands for 650ms then runs to chosen wall and settles',()=>{
 let state=initial, landingFrames=0, phases=new Set();
 for(let i=0;i<500;i++){
  const prior=state; state=stepLocomotion(state,16,b); phases.add(state.phase);
  assert.ok(state.y>=0 && state.y<=floorY(b));
  if(prior.phase==='falling')assert.ok(state.y>=prior.y);
  if(prior.phase==='landing')landingFrames++;
  if(state.phase==='idle')break;
 }
 assert.deepEqual([...phases],['falling','landing','running','idle']);
 assert.equal(landingFrames,41); assert.equal(state.x,wallX('left',b)); assert.equal(state.y,664);
});
test('right wall, resized bounds, negative delta and delayed frames stay bounded',()=>{
 assert.equal(nearestWall(250,b),'right'); assert.equal(nearestWall(0,b),'left');
 // The box may pass the wall by wallInset (its transparent margin) so the body rests against the edge (2026-09-26).
 assert.deepEqual(clampPosition(10000,-100,b),{x:390-116+wallInset(116),y:0}); assert.ok(wallInset(116)<=Math.round(116*.11));
 assert.deepEqual(stepLocomotion(initial,10000,b),stepLocomotion(initial,250,b));
 assert.equal(stepLocomotion(initial,-100,b).y,20);
 const resized={...b,viewportWidth:320,viewportHeight:200,occupiedBottom:160};
 assert.equal(floorY(resized),0);
 assert.equal(stepLocomotion({...initial,x:900},16,resized).phase,'landing');
});
test('run travel follows the same wall-clock speed at 60 fps and 12 fps without clipping the body',()=>{
 const start={...initial,x:8,y:floorY(b),phase:'running',side:'right'};
 let fast=start,slow=start;
 for(let i=0;i<60;i++)fast=stepLocomotion(fast,1000/60,b);
 for(let i=0;i<12;i++)slow=stepLocomotion(slow,1000/12,b);
 assert.ok(Math.abs(fast.x-slow.x)<1e-8);
 assert.ok(fast.x>wallX('left',b) && fast.x<=wallX('right',b));
});
test('reduced motion settles immediately with both feet above occupied footer',()=>{
 const state=stepLocomotion({...initial,side:'right'},16,b,true);
 assert.equal(state.phase,'idle'); assert.equal(state.x,wallX('right',b)); assert.equal(state.y+ b.height,b.viewportHeight-b.occupiedBottom);
});

const travel = {version:1,times:[0,.7,1.2,1.7,2.4],positionsXZ:[[0,0],[0,0],[0,.20],[0,.55],[0,.55]],direction:[0,1],source:'target-stance'};
const stageFrame = (time, extra={})=>({action:'meshy:14',time,duration:2.4,paused:false,pixelsPerUnit:45,travel,...extra});
test('imported travel uses actual clip time with stationary entry and exit at every frame rate',()=>{
 const wide={...b,viewportWidth:1200};
 const positionAt=(fps)=>{let state=null;for(let i=0;i<=Math.round(2.4*fps);i++)state=stepImportedStage(state,stageFrame(i/fps),wide,20).state;return state;};
 const fast=positionAt(60),slow=positionAt(10);assert.ok(Math.abs(fast.x-slow.x)<1e-8);assert.ok(Math.abs(fast.x-(20+.55*45))<1e-8);
 let state=stepImportedStage(null,stageFrame(0),wide,20).state;
 state=stepImportedStage(state,stageFrame(.6),wide,20).state;assert.equal(state.x,20);
 state=stepImportedStage(state,stageFrame(1.7),wide,20).state;const end=state.x;
 assert.equal(stepImportedStage(state,stageFrame(2.3),wide,20).state.x,end);
 assert.equal(stepImportedStage(state,stageFrame(1.7),wide,20).state.x,end);
});
test('backward and sideways sources keep source-facing semantics while entering available screen space',()=>{
 const wide={...b,viewportWidth:1200};
 const backwards={...travel,direction:[0,-1],positionsXZ:travel.positionsXZ.map(([x,z])=>[x,-z])};
 let state=stepImportedStage(null,stageFrame(0,{travel:backwards}),wide,20).state;
 assert.ok(Math.abs(state.yaw+Math.PI/2)<1e-8);state=stepImportedStage(state,stageFrame(1.7,{travel:backwards}),wide,20).state;assert.ok(state.x>20);
 const strafe={...travel,direction:[1,0],positionsXZ:travel.positionsXZ.map(([,z])=>[z,0])};
 state=stepImportedStage(null,stageFrame(0,{travel:strafe}),wide,20).state;assert.equal(state.yaw,0);
 const rightStart=stepImportedStage(null,stageFrame(0),b,260).state;assert.ok(Math.abs(rightStart.yaw+Math.PI/2)<1e-8);
});
test('camera framing changes preserve the current frame travel without moving prior distance again',()=>{
 const wide={...b,viewportWidth:1200};let state=stepImportedStage(null,stageFrame(0),wide,20).state;
 state=stepImportedStage(state,stageFrame(1.2),wide,20).state;const before=state.x;
 state=stepImportedStage(state,stageFrame(1.7,{pixelsPerUnit:60}),wide,20).state;
 assert.ok(Math.abs(state.x-before-(.55-.20)*60)<1e-8);
});
test('pause, resize, clipping and action changes never replay travel or send the avatar beyond safe bounds',()=>{
 let state=stepImportedStage(null,stageFrame(0),b,150).state;
 state=stepImportedStage(state,stageFrame(1.2),b,150).state;const before=state.x;
 assert.equal(stepImportedStage(state,stageFrame(2,{paused:true}),b,150).state.x,before);
 state=stepImportedStage(state,stageFrame(1.2,{pixelsPerUnit:60}),b,150).state;assert.equal(state.x,before);
 const short={...b,viewportWidth:160};const resized=stepImportedStage(state,stageFrame(1.2,{pixelsPerUnit:60}),short,150);assert.equal(resized.state.x,wallX('right',short));
 const far={...travel,positionsXZ:travel.positionsXZ.map(([x,z])=>[x,z*100])};state=stepImportedStage(null,stageFrame(0,{travel:far}),b,150).state;
 const clipped=stepImportedStage(state,stageFrame(1.7,{travel:far}),b,150);assert.equal(clipped.decision.stop,true);assert.ok(clipped.state.x>=wallX('left',b) && clipped.state.x<=wallX('right',b));
 assert.equal(stepImportedStage(clipped.state,stageFrame(2,{travel:far}),b,150).state.x,clipped.state.x);
 assert.equal(stepImportedStage(state,stageFrame(0,{action:'Idle',travel:null}),b,150).state,null);
});

// Exercise actual hook handlers with a minimal deterministic hook/RAF host.
const vm = await import('node:vm');
const hookBundle=await build({entryPoints:['src/components/doreumi/useDoreumiLocomotion.ts'],bundle:true,format:'cjs',write:false,plugins:[{name:'hooks',setup(builder){builder.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fake'}));builder.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export const useRef=(current)=>({current});export const useCallback=(fn)=>fn;export const useState=(value)=>[value,()=>{}];export const useEffect=(fn)=>globalThis.effects.push(fn);'}));}}]});
function hookHarness(){
 const effects=[],frames=new Map(),listeners=new Map();let sequence=0,clock=0,starts=0,captured=null,rectReads=0;
 const styles=new Map();
 const geometry={left:250,top:600,width:116,height:98};
 const element={getBoundingClientRect:()=>{rectReads++;return {...geometry,left:parseFloat(styles.get('--doreumi-rest-x')??String(geometry.left))};},style:{setProperty:(key,value)=>styles.set(key,value),getPropertyValue:key=>styles.get(key)??'',removeProperty:key=>styles.delete(key)},dataset:{},removeAttribute:name=>{if(name==='data-stage-moving')delete element.dataset.stageMoving;}};
 const target={setPointerCapture:id=>{captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;}};
 // The cache invalidation and clamp effects both listen to resize. Keep both,
 // as the real event target does, rather than overwriting the first listener.
 const events={addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
 const viewport={...events,innerWidth:390,innerHeight:844,matchMedia:()=>({matches:false})};
 const fixtureModule={exports:{}};
 vm.runInNewContext(hookBundle.outputFiles[0].text,{module:fixtureModule,exports:fixtureModule.exports,effects,window:viewport,document:{...events,hidden:false},performance:{now:()=>clock},requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id)});
 const options={elementRef:{current:element},enabled:true,stageEnabled:true,occupiedBottom:82,resetKey:'/',onDragStart:()=>starts++};
 const api=fixtureModule.exports.useDoreumiLocomotion(options);
 const cleanups=effects.map(fn=>fn());
 const event=(x,y,other={})=>({isPrimary:true,button:0,buttons:1,pointerId:1,clientX:x,clientY:y,currentTarget:target,preventDefault(){},...other});
 return {api,event,frames,element,styles,options,geometry,viewport,rectReads:()=>rectReads,clearReads:()=>{rectReads=0;},emit:name=>{for(const fn of [...(listeners.get(name)??[])])fn();},starts:()=>starts,captured:()=>captured,dispose:()=>cleanups.forEach(fn=>fn?.())};
}
test('actual pointer handlers distinguish taps and drag, suppress release click, release capture and clean RAF',()=>{
 const h=hookHarness(),p=h.api.pointerHandlers;
 p.onPointerDown(h.event(280,630));p.onPointerMove(h.event(283,632));p.onPointerUp(h.event(283,632));
 assert.equal(h.starts(),0);assert.equal(h.api.consumeClick(),false);assert.equal(h.captured(),null);
 p.onPointerDown(h.event(280,630));p.onPointerMove(h.event(270,400));
 assert.equal(h.starts(),1);assert.equal(h.element.dataset.locomotion,'dragged');
 p.onPointerUp(h.event(270,400));assert.equal(h.element.dataset.locomotion,'falling');assert.equal(h.captured(),null);
 assert.equal(h.api.consumeClick(),true);assert.equal(h.api.consumeClick(),false);assert.equal(h.frames.size,1);
 h.dispose();assert.equal(h.frames.size,0);
});
test('pointer cancellation and lost-button watchdog recover without opening a conversation',()=>{
 for(const end of ['onPointerCancel','onLostPointerCapture','watchdog']){
  const h=hookHarness(),p=h.api.pointerHandlers;p.onPointerDown(h.event(280,630));p.onPointerMove(h.event(260,300));
  if(end==='watchdog')p.onPointerMove(h.event(260,300,{buttons:0}));else p[end](h.event(260,300));
  assert.equal(h.captured(),null);assert.equal(h.api.consumeClick(),true);assert.equal(h.element.dataset.locomotion,'falling');h.dispose();
 }
});
test('actual imported-frame hook paints the same frame, stays idle to avoid cancelling personality, and yields to interaction',()=>{
 const h=hookHarness();h.api.onMotionFrame(stageFrame(0));h.api.onMotionFrame(stageFrame(1.2));
 const x=parseFloat(h.styles.get('--doreumi-rest-x'));assert.ok(x<250);assert.equal(h.element.dataset.stageMoving,'meshy:14');assert.equal(h.element.dataset.locomotion,'idle');assert.equal(h.frames.size,0);
 h.api.onMotionFrame(stageFrame(1.2));assert.equal(parseFloat(h.styles.get('--doreumi-rest-x')),x);
 h.options.stageEnabled=false;assert.equal(h.api.onMotionFrame(stageFrame(1.3)).stop,true);assert.equal(parseFloat(h.styles.get('--doreumi-rest-x')),x);assert.equal(h.element.dataset.stageMoving,undefined);
 h.options.stageEnabled=true;h.api.onMotionFrame(stageFrame(0,{action:'Idle',travel:null}));h.api.onMotionFrame(stageFrame(0));
 h.api.pointerHandlers.onPointerDown(h.event(260,620));assert.equal(h.api.onMotionFrame(stageFrame(.9)).stop,true);h.api.pointerHandlers.onPointerUp(h.event(260,620));assert.equal(h.api.consumeClick(),false);h.dispose();
});

test('actual stage entry refreshes body dimensions and following travel frames perform no DOM reads',()=>{
 const h=hookHarness();
 // Initial mount measured116px. The first motion must replace that stale box.
 h.geometry.width=260;h.geometry.height=180;h.clearReads();
 h.api.onMotionFrame(stageFrame(0));
 assert.equal(h.rectReads(),2,'fresh size and initial page origin, without another read after the position write');
 const right=wallX('right',{...b,width:260,height:180});
 assert.ok(Math.abs(parseFloat(h.styles.get('--doreumi-rest-x'))-right)<1e-8);
 h.clearReads();
 for(const time of [.6,.7,1.2,1.7,2.3])h.api.onMotionFrame(stageFrame(time));
 assert.equal(h.rectReads(),0,'subsequent frames reuse dimensions through side selection');
 assert.ok(parseFloat(h.styles.get('--doreumi-rest-x'))<right);
 h.dispose();
});

test('actual resize invalidates stage dimensions and clamps with the fresh viewport before cached frames resume',()=>{
 const h=hookHarness();h.api.onMotionFrame(stageFrame(0));
 h.geometry.width=180;h.geometry.height=140;h.viewport.innerWidth=320;h.viewport.innerHeight=640;h.clearReads();
 h.emit('resize');
 assert.equal(h.rectReads(),1,'resize cache-drop and clamp listeners both run');
 const right=wallX('right',{...b,width:180,height:140,viewportWidth:320,viewportHeight:640});
 assert.ok(Math.abs(parseFloat(h.styles.get('--doreumi-rest-x'))-right)<1e-8);
 h.clearReads();h.api.onMotionFrame(stageFrame(1.2));h.api.onMotionFrame(stageFrame(1.7));
 assert.equal(h.rectReads(),0);
 assert.ok(parseFloat(h.styles.get('--doreumi-rest-x'))<=right);
 h.dispose();
});

test('actual action changes refresh dimensions even when the viewport did not resize',()=>{
 const h=hookHarness();h.api.onMotionFrame(stageFrame(0));
 h.geometry.width=240;h.clearReads();h.api.onMotionFrame(stageFrame(0,{action:'meshy:15'}));
 assert.equal(h.rectReads(),1,'new action measures once and retains its established origin');
 const right=wallX('right',{...b,width:240});
 assert.ok(Math.abs(parseFloat(h.styles.get('--doreumi-rest-x'))-right)<1e-8);
 h.clearReads();h.api.onMotionFrame(stageFrame(1.2,{action:'meshy:15'}));
 assert.equal(h.rectReads(),0);
 h.dispose();
});

test('actual reset refreshes dimensions once for idle ledge paint and a restarted action gets another fresh box',()=>{
 const h=hookHarness();h.api.onMotionFrame(stageFrame(0));
 h.options.ledges=[{left:0,right:390,top:700}];h.geometry.width=210;h.clearReads();
 h.api.reset();assert.equal(h.rectReads(),1,'reset reads fresh dimensions and idle paint reuses them');
 h.api.onMotionFrame(stageFrame(0,{action:'Idle',travel:null}));
 h.geometry.width=280;h.clearReads();h.api.onMotionFrame(stageFrame(0));
 assert.equal(h.rectReads(),1,'after reset the new motion cannot reuse its prior cached box');
 assert.ok(parseFloat(h.styles.get('--doreumi-rest-x'))<=wallX('right',{...b,width:280}));
 h.dispose();
});
