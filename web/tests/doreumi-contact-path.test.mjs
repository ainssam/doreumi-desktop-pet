import test from 'node:test';
import assert from 'node:assert/strict';
import { planContactPhaseOffset, solveContactRootPath, solveContactAnglePath } from '../scripts/doreumi/meshy-contact-path.mjs';

const contact=(side,center,reach)=>({side,ankleGoal:center,hipOffset:[0,0,0],reach});
const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));

test('both planted feet constrain one shared root, including a measured floor halfspace',()=>{
  const frames=Array.from({length:31},(_,index)=>({time:index/30,rawRoot:[.1,1.3,.05],minimumRootY:.93,
    contacts:[contact('L',[-.2,.8,0],.36),contact('R',[.2,.8,0],.36)]}));
  const result=solveContactRootPath(frames);
  assert.equal(result.report.feasible,true);assert.equal(result.report.converged,true);
  for(const point of result.rootPath) {
    assert.ok(point[1]>=.93-1e-10);
    assert.ok(distance(point,[-.2,.8,0])<=.36*.98+1e-8);
    assert.ok(distance(point,[.2,.8,0])<=.36*.98+1e-8);
  }
});

test('global curvature smoothing anticipates stance instead of dropping the root on its first frame',context=>{
  const frames=Array.from({length:61},(_,index)=>({time:index/30,rawRoot:[0,1.2,0],
    contacts:index>=20&&index<=40?[contact('L',[0,.7,0],.35)]:[]}));
  const input=structuredClone(frames),result=solveContactRootPath(frames,{smoothness:80});
  assert.deepEqual(frames,input);assert.equal(result.report.feasible,true);assert.equal(result.report.converged,true);
  assert.ok(result.rootPath[17][1]<1.19,'root did not anticipate the planted interval');
  assert.ok(result.rootPath[43][1]<1.19,'root jumped immediately on release');
  assert.ok(result.report.maximumAcceleration<result.report.projectedMaximumAcceleration*.1);
  assert.ok(result.report.maximumReachRatio<=.98+1e-8);
  context.diagnostic(JSON.stringify(result.report));
});

test('impossible foot spacing and incompatible floor height remain explicit failures',()=>{
  const wide=solveContactRootPath([{rawRoot:[0,1,0],contacts:[contact('L',[-.5,0,0],.3),contact('R',[.5,0,0],.3)]}]);
  assert.equal(wide.report.feasible,false);assert.ok(wide.report.infeasibleFrames[0].sphereGap>.4);
  assert.ok(wide.report.maximumConstraintViolation>.2);assert.ok(wide.rootPath.flat().every(Number.isFinite));
  const floor=solveContactRootPath([{rawRoot:[0,.7,0],contacts:[contact('L',[0,.5,0],.3)],minimumRootY:1}]);
  assert.equal(floor.report.feasible,false);assert.ok(floor.report.infeasibleFrames[0].floorConflict>.2);
});

test('the solve is translation invariant and the reach safety margin is explicit',()=>{
  const frames=Array.from({length:12},(_,i)=>({rawRoot:[Math.sin(i)*.03,1.2,0],contacts:[contact('L',[0,.8,0],.35)]}));
  const result=solveContactRootPath(frames,{reachScale:1}),offset=[2,-.4,1];
  const shifted=frames.map(frame=>({...frame,rawRoot:frame.rawRoot.map((v,i)=>v+offset[i]),contacts:frame.contacts.map(c=>({...c,ankleGoal:c.ankleGoal.map((v,i)=>v+offset[i])}))}));
  const other=solveContactRootPath(shifted,{reachScale:1});
  for(let i=0;i<frames.length;i++)assert.ok(distance(result.rootPath[i].map((v,j)=>v+offset[j]),other.rootPath[i])<1e-7);
  assert.ok(result.report.maximumReachRatio<=1+1e-8);assert.equal(result.report.reachScale,1);
  assert.throws(()=>solveContactRootPath(frames,{reachScale:1.01}),/options/);
  assert.throws(()=>solveContactRootPath([{rawRoot:[0,1,0],contacts:[{reach:.3}]}]),/stance sphere/);
});

test('an unconstrained linear trajectory stays unchanged',()=>{
  const frames=Array.from({length:20},(_,i)=>({rawRoot:[i*.01,1,i*.02],contacts:[]}));
  const result=solveContactRootPath(frames);
  assert.equal(result.report.feasible,true);assert.equal(result.report.converged,true);
  result.rootPath.forEach((root,index)=>assert.ok(distance(root,frames[index].rawRoot)<1e-12));
});

test('a landing is planned against the complete future hip turn with one constant planted offset',()=>{
  const samples=[
    {ankle:[.152189,.025398,.341127],hip:[-.448437,.110372,.270088]},
    {ankle:[.217150,.006482,.344035],hip:[-.534733,.009648,.013862]},
    {ankle:[.214563,.000501,.349249],hip:[-.528089,-.023978,-.082294]},
  ];
  const frames=samples.map((sample,index)=>({time:index/30,rawRoot:[0,1.1,0],contacts:['L','R'].map(side=>{
    const sign=side==='L'?1:-1;
    return {side,ankleGoal:sample.ankle.map((value,axis)=>value*sign/2+(axis===1?.1:0)),hipOffset:sample.hip.map((value,axis)=>value*sign/2+(axis===1?-.72:0)),reach:.333525};
  })}));
  const input=structuredClone(frames),result=planContactPhaseOffset(frames,'L');
  assert.equal(result.report.feasible,true);assert.equal(result.report.converged,true);assert.equal(result.offset[1],0);
  assert.ok(result.report.offsetLength>.2&&result.report.offsetLength<.22);assert.deepEqual(frames,input);
  const shifted=frames.map(frame=>({...frame,contacts:frame.contacts.map(c=>c.side==='L'?{...c,ankleGoal:c.ankleGoal.map((v,i)=>v+result.offset[i])}:c)}));
  const root=solveContactRootPath(shifted);assert.equal(root.report.feasible,true);
  assert.deepEqual(shifted.map(f=>f.contacts[1]),frames.map(f=>f.contacts[1]));
  assert.ok(result.report.maximumConstraintViolation<1e-8);
});

test('phase planning does not hide an impossible vertical reach or excessive landing shift',()=>{
  const frame={rawRoot:[0,1,0],contacts:[contact('L',[1,0,0],.3),contact('R',[0,0,0],.3)]};
  const limited=planContactPhaseOffset([frame],'L',{maxOffset:.1,maxIterations:50});
  assert.equal(limited.report.feasible,false);assert.ok(limited.report.maximumConstraintViolation>.3);
  const vertical=planContactPhaseOffset([{...frame,contacts:[contact('L',[0,1,0],.3),contact('R',[0,0,0],.3)]}],'L');
  assert.equal(vertical.report.feasible,false);assert.ok(vertical.report.maximumVerticalDeficit>.4);
});

test('landing placement leaves enough root height for the measured body skin envelope',()=>{
  const frame={rawRoot:[0,1.2,0],minimumRootY:1.18,contacts:[contact('L',[.3,1,0],.32),contact('R',[-.3,1,0],.32)]};
  const bare=planContactPhaseOffset([{...frame,minimumRootY:undefined}],'L');
  assert.equal(bare.report.feasible,true);assert.deepEqual(bare.offset,[0,0,0]);
  const result=planContactPhaseOffset([frame],'L');
  assert.equal(result.report.feasible,true);assert.ok(result.offset[0]<-.08);
  const shifted={...frame,contacts:frame.contacts.map(c=>c.side==='L'?{...c,ankleGoal:c.ankleGoal.map((v,i)=>v+result.offset[i])}:c)};
  const root=solveContactRootPath([shifted]);
  assert.equal(root.report.feasible,true);assert.ok(root.rootPath[0][1]>=1.18-1e-8);
  const impossible=planContactPhaseOffset([{...frame,minimumRootY:1.4}],'L');
  assert.equal(impossible.report.feasible,false);assert.ok(impossible.report.maximumFloorDeficit>.08);
});

test('skin-clear knee-plane intervals anticipate a clearance turn and release continuously',()=>{
  const frames=Array.from({length:61},(_,index)=>({time:index/30,rawAngle:0,minimum:index>=20&&index<=35?.8:-1.4,maximum:1.4}));
  const input=structuredClone(frames),result=solveContactAnglePath(frames);
  assert.deepEqual(frames,input);assert.equal(result.report.feasible,true);assert.equal(result.report.converged,true);
  assert.ok(result.angles[18]>.2);assert.ok(result.angles[37]>.2);
  for(let index=0;index<frames.length;index++)assert.ok(result.angles[index]>=frames[index].minimum-1e-8&&result.angles[index]<=frames[index].maximum+1e-8);
  assert.ok(result.report.maximumAcceleration<result.report.projectedMaximumAcceleration*.1);
});

test('angle optimization preserves exact one-point intervals and reports conflicting branches',()=>{
  const exact=solveContactAnglePath([{rawAngle:0,minimum:.2,maximum:.2}]);
  assert.deepEqual(exact.angles,[.2]);assert.equal(exact.report.feasible,true);
  const bad=solveContactAnglePath([{rawAngle:0,minimum:.4,maximum:-.2}]);
  assert.equal(bad.report.feasible,false);assert.ok(bad.report.maximumConstraintViolation>=.3-1e-10);
  assert.throws(()=>solveContactAnglePath([{rawAngle:0,minimum:0,maximum:Infinity}]),/interval/);
});
