/** Offline locomotion ground-frame reconstruction. Reconstruct the missing treadmill ground frame from
 * actual donor material contacts. Do not apply to deliberate glides or dances. */
export function reconstructInplaceGroundFrame({times,sourceFeet,sourceRoots,sourceFloor,tolerance=.04}) {
 if(!Array.isArray(times)||times.length<2||times.length>100000||sourceFeet.length!==times.length||sourceRoots.length!==times.length||!Number.isFinite(sourceFloor)||!Number.isFinite(tolerance)||tolerance<=0||tolerance>.5)throw Error('Invalid inplace ground samples');
 const counts={L:sourceFeet[0]?.L?.length,R:sourceFeet[0]?.R?.length};
 for(let i=0;i<times.length;i++){
  if(!Number.isFinite(times[i])||(i&&times[i]<=times[i-1])||sourceRoots[i]?.length!==3||!sourceRoots[i].every(Number.isFinite))throw Error('Invalid inplace ground clock/root');
  for(const side of ['L','R'])if(!counts[side]||sourceFeet[i]?.[side]?.length!==counts[side]||sourceFeet[i][side].some(p=>p.length!==3||!p.every(Number.isFinite)))throw Error('Invalid inplace material vertices');
 }
 const positions=[[0,0]],supports=[],retained={L:undefined,R:undefined};let oldSide,velocity=[0,0];
 for(let i=1;i<times.length;i++){
  const dt=times[i]-times[i-1],options=[];
  for(const side of ['L','R']){
   const candidates=[];for(let v=0;v<sourceFeet[i][side].length;v++){
    const a=sourceFeet[i-1][side][v],b=sourceFeet[i][side][v];if(Math.abs(a[1]-sourceFloor)>tolerance||Math.abs(b[1]-sourceFloor)>tolerance)continue;
    candidates.push({side,vertex:v,height:Math.max(a[1],b[1])-sourceFloor,delta:[b[0]-a[0],b[2]-a[2]]});
   }
   candidates.sort((a,b)=>a.height-b.height||a.vertex-b.vertex);
   const prior=candidates.find(c=>c.vertex===retained[side]);const best=prior&&prior.height<=candidates[0].height+.003?prior:candidates[0];
   if(best){retained[side]=best.vertex;options.push(best);}else retained[side]=undefined;
  }
  options.sort((a,b)=>a.height-b.height||a.side.localeCompare(b.side));const old=options.find(o=>o.side===oldSide),support=old&&old.height<=options[0].height+.005?old:options[0];
  let delta;if(support){delta=support.delta.map(v=>-v);velocity=delta.map(v=>v/dt);oldSide=support.side;}else{delta=velocity.map(v=>v*dt);oldSide=undefined;}
  positions.push(positions.at(-1).map((v,k)=>v+delta[k]));supports.push(support?{index:i,side:support.side,vertex:support.vertex,height:support.height,rawDelta:support.delta}: {index:i,airborne:true});
 }
 const feet=sourceFeet.map((f,i)=>Object.fromEntries(['L','R'].map(side=>[side,f[side].map(p=>[p[0]+positions[i][0],p[1],p[2]+positions[i][1]])]))),roots=sourceRoots.map((p,i)=>[p[0]+positions[i][0],p[1],p[2]+positions[i][1]]);
 return {sourceFeet:feet,sourceRoots:roots,evidence:{version:1,basis:'inplace-locomotion-actual-source-skin-ground-frame',sourceFloor,tolerance,times,positionsXZ:positions,supports,airbornePolicy:'last-observed-support-velocity'}};
}

/** Apply a previously measured source ground frame after sampling donor local
 * tracks. World translation only preserves every donor bone direction. The
 * absolute hip target makes repeated application idempotent. */
export function applyInplaceGroundFrameToGraph(graph, time, evidence, sourceRoots) {
 if (!Array.isArray(evidence?.times) || !evidence.times.length) throw Error('Ground donor clock changed');
 let low = 0, high = evidence.times.length;
 while (low < high) { const middle = (low + high) >>> 1; if (evidence.times[middle] < time) low = middle + 1; else high = middle; }
 let sample = Math.min(low, evidence.times.length - 1);
 if (sample > 0 && Math.abs(evidence.times[sample - 1] - time) < Math.abs(evidence.times[sample] - time)) sample--;
 if (!Number.isFinite(time) || sample < 0 || Math.abs(evidence.times[sample] - time) > 1e-6
   || !sourceRoots[sample] || !evidence.positionsXZ[sample]) throw Error('Ground donor clock changed');
 const hip = graph.byName.get('Hips');
 if (!hip || !Array.isArray(graph.ordered)) throw Error('Ground donor hip missing');
 const raw = sourceRoots[sample], offset = evidence.positionsXZ[sample];
 // Keep the original addition order on a freshly sampled graph, avoiding an
 // unnecessary cancellation that can perturb offline Float32 key compaction.
 const fresh = hip.worldPosition.x === raw[0] && hip.worldPosition.z === raw[2];
 const x = fresh ? offset[0] : raw[0] + offset[0] - hip.worldPosition.x;
 const z = fresh ? offset[1] : raw[2] + offset[1] - hip.worldPosition.z;
 if (!Number.isFinite(x) || !Number.isFinite(z)) throw Error('Invalid ground donor translation');
 for (const node of graph.ordered) { node.worldPosition.x += x; node.worldPosition.z += z; }
}
