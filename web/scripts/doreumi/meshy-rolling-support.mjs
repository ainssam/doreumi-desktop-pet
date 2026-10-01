import { blendedContactRootConstraint } from './meshy-planar-support.mjs';
import { solveContactRootPath } from './meshy-contact-path.mjs';

/** Plan a rigid foot rolling on its actual skin, instead of pinning a vertex
 * that rotates above the sole. Source contact phases and foot orientations are
 * inputs; no limb length or authored rotation is changed here. */
export function planRollingMaterialSupport({ rows, frames, priorPlan, targetFloor = .002 }) {
 if (!Array.isArray(rows) || rows.length < 2 || frames.length !== rows.length || priorPlan.plannedRootPath?.length !== rows.length || priorPlan.plannedContactFrames?.length !== rows.length || !Number.isFinite(targetFloor)) throw Error('Invalid rolling support samples');
 const plan = structuredClone(priorPlan);
 for(let i=0;i<rows.length;i++) {
  if(!Number.isFinite(rows[i].time)||(i&&rows[i].time<=rows[i-1].time))throw Error('Invalid rolling support clock');
  for(const side of ['L','R']) if(!frames[i].feet?.[side]?.length||frames[i].ankles?.[side]?.length!==3||!frames[i].ankles[side].every(Number.isFinite)||frames[i].feet[side].some(p=>p.length!==3||!p.every(Number.isFinite))||(i&&frames[i].feet[side].length!==frames[0].feet[side].length))throw Error('Invalid rolling material vertices');
 }
const rolling=rows.map(()=>({}));const sub=(a,b)=>a.map((v,k)=>v-b[k]),add=(a,b)=>a.map((v,k)=>v+b[k]);
for(const side of ['L','R']){let previousCore=false,desired,retained;
 for(let i=0;i<rows.length;i++){
  const c=rows[i].constraints.find(c=>c.side===side),core=c?.weight===1;if(!core){previousCore=false;continue;}
  const current=frames[i],points=current.feet[side],ankle=current.ankles[side],minimum=Math.min(...points.map(p=>p[1]));
  if(!previousCore){desired=[...ankle];retained=undefined;}
  else{
   const prior=frames[i-1],minBefore=Math.min(...prior.feet[side].map(p=>p[1])),scores=points.map((p,v)=>({v,height:Math.max(p[1]-minimum,prior.feet[side][v][1]-minBefore)})).sort((a,b)=>a.height-b.height||a.v-b.v);
   const old=scores.find(s=>s.v===retained),v=old&&old.height<=scores[0].height+.002?old.v:scores[0].v;retained=v;
   const a=sub(prior.feet[side][v],prior.ankles[side]),b=sub(points[v],ankle);for(const k of [0,2])desired[k]-=b[k]-a[k];
  }
  desired[1]=ankle[1]+targetFloor-minimum;
  const targetIndex=points.reduce((best,p,v)=>p[1]<points[best][1]?v:best,0),goal=add(desired,sub(points[targetIndex],ankle));rolling[i][side]={goal,targetIndex,sourceIndex:c.sourceIndex,ankleGoal:[...desired]};previousCore=true;
 }
}
// Approach and release the same Cartesian rolling path without changing core contact.
for(const side of ['L','R'])for(let i=0;i<rows.length;i++){
 const c=rows[i].constraints.find(c=>c.side===side);if(!c||rolling[i][side])continue;
 const anchors=[];for(const direction of[-1,1])for(let j=i+direction;j>=0&&j<rows.length;j+=direction){const dt=Math.abs(rows[j].time-rows[i].time);if(dt>.25)break;if(!rolling[j][side]||rows[j].constraints.find(c=>c.side===side)?.weight!==1)continue;const x=1-dt/.25;anchors.push({j,w:x*x*(3-2*x)});break;}
 if(!anchors.length)continue;const weight=anchors.reduce((s,a)=>s+a.w,0),offset=[0,1,2].map(k=>anchors.reduce((s,a)=>s+(rolling[a.j][side].ankleGoal[k]-frames[a.j].ankles[side][k])*a.w,0)/weight),ankleGoal=add(frames[i].ankles[side],offset),targetIndex=plan.plannedContactFrames[i][side].targetIndex,goal=add(ankleGoal,sub(frames[i].feet[side][targetIndex],frames[i].ankles[side]));rolling[i][side]={goal,targetIndex,sourceIndex:c.sourceIndex,ankleGoal};
}
const constraints=rows.map((r,i)=>({...r, constraints:r.constraints.map(c=>rolling[i][c.side]?{...c,...rolling[i][c.side]}:c)}));
const rootFrames=constraints.map((r,i)=>({rawRoot:plan.plannedRootPath[i],contacts:r.constraints.map(c=>blendedContactRootConstraint(c)).filter(Boolean)})),root=solveContactRootPath(rootFrames,{smoothness:80});
if(!root.report.feasible)throw Error('Rolling support root infeasible');
plan.plannedRootPath=root.rootPath;
plan.plannedContactFrames=constraints.map(r=>Object.fromEntries(r.constraints.map(c=>[c.side,{goal:c.goal,targetIndex:c.targetIndex,sourceIndex:c.sourceIndex}])));
return {plan,rolling,rootReport:root.report};
}
