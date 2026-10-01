import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Box3, Vector3, Quaternion } from 'three';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { blendedContactRootConstraint, retargetSourceLegPose, blendContinuousQuaternion, solveStationaryPlanarSupport, envelopePlanarSupport, solvePlanarFoot, createPlanarFootSampler, createStationaryFootContactAdapter } from '../scripts/doreumi/meshy-planar-support.mjs';
const foot = (x, y = .002) => [[x, y, 0], [x + .1, y, 0], [x, y, .1]];
const frame = (x, y) => ({ L: foot(x, y), R: foot(x + .6, 1) });
const input = (source, target) => ({ times: [0, .1, .2], sourceFeet: source, targetFeet: target, sourceRoots: [[0,0,0],[0,0,0],[0,0,0]], legRatio: 1, sourceFloor: .002 });
test('source planted skin remains planted after cancelling target surface translation', () => {
  const result = solveStationaryPlanarSupport(input([frame(0),frame(0),frame(0)], [frame(0),frame(.1),frame(.25)]));
  assert.deepEqual(result.positionsXZ, [[0,0],[-.1,0],[-.25,0]]);
  assert.equal(result.evidence.supportedPairs,2);
  for (let i=0;i<3;i++) assert.ok(Math.abs([0,.1,.25][i]+result.positionsXZ[i][0])<1e-9);
});
test('intentional source gliding is preserved rather than foot-locked', () => {
  const result=solveStationaryPlanarSupport(input([frame(0),frame(.02),frame(.04)],[frame(0),frame(.1),frame(.25)]));
  assert.ok(Math.abs(result.positionsXZ[2][0]+.21)<1e-9);
  assert.equal(result.evidence.glidingPairs,2);
});
test('a lower sliding foot cannot take support away from the stationary source foot', () => {
  const source = [0,.02,.04].map(x=>({L:foot(x,.002),R:foot(.6,.012)}));
  const target = [0,.1,.2].map(x=>({L:foot(-x,.002),R:foot(.6+x,.012)}));
  const result = solveStationaryPlanarSupport(input(source,target));
  assert.ok(Math.abs(result.positionsXZ[2][0]+.2)<1e-9);
});
test('airborne source root travel is preserved and excessive correction fails without clamping', () => {
  const data=input([frame(0,1),frame(0,1),frame(0,1)],[frame(0,1),frame(0,1),frame(0,1)]);
  data.sourceRoots=[[0,0,0],[.3,0,.1],[.5,0,.2]];
  const result=solveStationaryPlanarSupport(data);assert.deepEqual(result.positionsXZ,[[0,0],[.3,.1],[.5,.2]]);
  assert.equal(result.evidence.airbornePairs,2);
  assert.throws(()=>solveStationaryPlanarSupport({...data,maxOffset:.4}),/exceeds/);
});
test('entry and exit are authored continuously and return planar offset to zero', () => {
  const result=envelopePlanarSupport([[0,0],[.5,.2]],4,5);
  assert.equal(result.length,11);assert.deepEqual(result[0],[0,0]);assert.deepEqual(result.at(-1),[0,0]);
  assert.ok(result.slice(6).every((point,i,array)=>!i||point[0]<=array[i-1][0]));
});
test('real master two-bone foot solve keeps lengths, knee-plane continuity and foot world orientation', () => {
  const target=targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const update=()=>{for(const node of target.ordered){node.worldPosition.copy(node.position);node.worldQuaternion.copy(node.quaternion);node.worldScale.copy(node.scale);if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}}};
  update();
  const hip=target.byName.get('thighL'),knee=target.byName.get('kneeL'),foot=target.byName.get('footL');
  const lengths=[hip.worldPosition.distanceTo(knee.worldPosition),knee.worldPosition.distanceTo(foot.worldPosition)],rotation=foot.worldQuaternion.clone(),start=foot.worldPosition.clone();
  const localPositions=target.ordered.map(node=>node.position.toArray());let pole;
  for(const x of [.02,.025,.03,.025,.02]){
    const goal=start.clone().add(new Vector3(x,.025,.01));
    const solved=solvePlanarFoot(target,'L',goal,update,pole);
    assert.ok(foot.worldPosition.distanceTo(goal)<1e-7);
    assert.ok(Math.abs(hip.worldPosition.distanceTo(knee.worldPosition)-lengths[0])<1e-9);
    assert.ok(Math.abs(knee.worldPosition.distanceTo(foot.worldPosition)-lengths[1])<1e-9);
    assert.ok(foot.worldQuaternion.angleTo(rotation)<1e-6);
    if(pole)assert.ok(solved.pole.dot(pole)>0);
    pole=solved.pole;
  }
  const fixedGoal=foot.worldPosition.clone(), previousKnee=knee.worldPosition.clone();
  const alternativePole=pole.clone().applyAxisAngle(fixedGoal.clone().sub(hip.worldPosition).normalize(),Math.PI/3);
  solvePlanarFoot(target,'L',fixedGoal,update,pole,1,alternativePole);
  assert.ok(knee.worldPosition.distanceTo(previousKnee)>.01);
  assert.ok(foot.worldPosition.distanceTo(fixedGoal)<1e-7);
  assert.ok(foot.worldQuaternion.angleTo(rotation)<1e-6);
  assert.ok(Math.abs(hip.worldPosition.distanceTo(knee.worldPosition)-lengths[0])<1e-9);
  assert.ok(Math.abs(knee.worldPosition.distanceTo(foot.worldPosition)-lengths[1])<1e-9);
  // An authored pose may present the opposite bend plane on the next sample.
  // The support solver must recover the previous physical plane continuously.
  const transported=solvePlanarFoot(target,'L',fixedGoal,update,pole);
  assert.ok(transported.pole.dot(pole)>.999999);
  assert.ok(knee.worldPosition.distanceTo(previousKnee)<1e-7);
  assert.ok(foot.worldPosition.distanceTo(fixedGoal)<1e-7);
  assert.deepEqual(target.ordered.map(node=>node.position.toArray()),localPositions);
});
test('actual decoded master skin keeps both source-planted feet fixed while the pelvis travels', async () => {
  const asset=await loadDoreumiAsset('public/doreumi/doreumi-master.glb'),target=targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const contactLimit=new Box3().setFromObject(asset.scene).getSize(new Vector3()).y*.01;
  const sampler=createPlanarFootSampler(asset.document,{L:['footL'],R:['footR']},{morphWeight:1});
  const update=()=>{for(const node of target.ordered){node.worldPosition.copy(node.position);node.worldQuaternion.copy(node.quaternion);node.worldScale.copy(node.scale);if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}}};
  const root=target.byName.get('DoreumiRig');root.position.y=1.046;update();
  const start=sampler.sample(target),floor=Math.min(...start.L.map(p=>p[1]),...start.R.map(p=>p[1]));
  const adapter=createStationaryFootContactAdapter({sourceFeet:[start,start,start],sourceTimes:[0,1/30,2/30],sourceFloor:floor,legRatio:1,targetSampler:sampler,targetFloor:floor});
  const rest=target.ordered.map(node=>node.quaternion.clone());adapter.apply(target,0,update);
  for(let frame=1;frame<3;frame++){
    target.ordered.forEach((node,index)=>node.quaternion.copy(rest[index]));root.position.set(.02*frame,1.046,0);update();adapter.apply(target,frame,update);
    const actual=sampler.sample(target);
    for(const side of ['L','R'])for(let i=0;i<start[side].length;i++)if(Math.abs(start[side][i][1]-floor)<.02){
      // Blended ankle/sole skin may deform around the exact anchor. Every
      // near-floor point must still satisfy the 1%-of-height motion budget.
      assert.ok(Math.hypot(actual[side][i][0]-start[side][i][0],actual[side][i][2]-start[side][i][2])<contactLimit);
    }
  }
  assert.ok(adapter.evidence.maxSkinError<1e-6);assert.equal(adapter.evidence.maxReachClamp,0);
});
test('first landing sample grounds a high-hip foot without pushing the other foot through the floor', async () => {
  const asset=await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const target=targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const sampler=createPlanarFootSampler(asset.document,{L:['footL'],R:['footR']},{morphWeight:1});
  const update=()=>{for(const node of target.ordered){node.worldPosition.copy(node.position);node.worldQuaternion.copy(node.quaternion);node.worldScale.copy(node.scale);if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}}};
  const root=target.byName.get('DoreumiRig');root.position.y=1.046;
  target.byName.get('body').quaternion.setFromAxisAngle(new Vector3(0,0,1),.3);update();
  const initial=sampler.sample(target);root.position.y+=.002-Math.min(...initial.L.map(p=>p[1]),...initial.R.map(p=>p[1]));update();
  const start=sampler.sample(target),source={L:start.L.map(p=>[p[0],.002,p[2]]),R:start.R.map(p=>[p[0],1,p[2]])};
  const airborne={L:source.L.map(p=>[p[0],1,p[2]]),R:source.R};
  const adapter=createStationaryFootContactAdapter({sourceFeet:[airborne,source,source],sourceTimes:[0,1/30,2/30],sourceFloor:.002,legRatio:1,targetSampler:sampler});
  adapter.apply(target,0,update);
  adapter.apply(target,1,update);
  const actual=sampler.sample(target);
  assert.ok(adapter.evidence.maxPelvisLowering>.02);
  assert.ok(Math.min(...actual.R.map(p=>p[1]))>=.0019);
  assert.ok(Math.min(...actual.L.map(p=>p[1]))<.042);
});

test('release interpolation keeps its rotation branch when IK crosses 180 degrees', () => {
  const authored = new Quaternion(), axis = new Vector3(0, 1, 0);
  const before = new Quaternion().setFromAxisAngle(axis, 179 * Math.PI / 180);
  const after = new Quaternion().setFromAxisAngle(axis, 181 * Math.PI / 180);
  const a = blendContinuousQuaternion(authored, before, .5);
  const b = blendContinuousQuaternion(authored, after, .5, a.log);
  assert.ok(Math.abs(a.quaternion.angleTo(b.quaternion) * 180 / Math.PI - 1) < 1e-8);
  assert.ok(authored.clone().slerp(before, .5).angleTo(authored.clone().slerp(after, .5)) > 3);
  assert.ok(blendContinuousQuaternion(authored, after, 1, a.log).quaternion.angleTo(after) < 1e-7);
  assert.ok(blendContinuousQuaternion(authored, after, 0, a.log).quaternion.angleTo(authored) < 1e-7);
});

test('a heel-toe source anchor change does not adopt a previous unreachable foot error', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const target = targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const sampler = createPlanarFootSampler(asset.document, {L:['footL'],R:['footR']}, {morphWeight:1});
  const update = () => { for (const node of target.ordered) {
    node.worldPosition.copy(node.position); node.worldQuaternion.copy(node.quaternion); node.worldScale.copy(node.scale);
    if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}
  }};
  target.byName.get('DoreumiRig').position.y = 1.046; update();
  const initial=sampler.sample(target),floor=Math.min(...initial.L.map(p=>p[1]),...initial.R.map(p=>p[1]));
  const source = (first,second) => ({L:[[0,first,0],[.1,second,0],[0,1,.1]],R:foot(0,1)});
  const rows=[];
  const adapter=createStationaryFootContactAdapter({sourceFeet:[source(floor,1),source(floor,floor),source(1,floor)],sourceTimes:[0,1/30,2/30],sourceFloor:floor,targetFloor:floor,legRatio:1,targetSampler:sampler,plannedRootPath:[[0,1.046,0],[1,1.046,0],[1,1.046,0]],onFrame:r=>rows.push(r)});
  const rest=target.ordered.map(node=>node.quaternion.clone());
  for(let index=0;index<3;index++){target.ordered.forEach((node,i)=>node.quaternion.copy(rest[i]));update();adapter.apply(target,index,update);}
  const before=rows.find(r=>r.phase==='solved'&&r.index===1).constraints[0];
  const after=rows.find(r=>r.phase==='solved'&&r.index===2).constraints[0];
  assert.notEqual(before.sourceIndex,after.sourceIndex);
  assert.ok(adapter.evidence.maxSkinError>.1,'fixture must expose a real reach failure');
  assert.ok(Math.hypot(after.ankleGoal[0]-before.ankleGoal[0],after.ankleGoal[2]-before.ankleGoal[2])<.001,'source material-point handoff preserves the desired ankle');
});

test('the donor knee plane takes precedence over the short target rest offsets', async () => {
  const asset=await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const target=targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const sampler=createPlanarFootSampler(asset.document,{L:['footL'],R:['footR']},{morphWeight:1});
  const update=()=>{for(const node of target.ordered){node.worldPosition.copy(node.position);node.worldQuaternion.copy(node.quaternion);node.worldScale.copy(node.scale);if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}}};
  target.byName.get('DoreumiRig').position.y=1.046;update();
  const feet=sampler.sample(target),floor=Math.min(...feet.L.map(p=>p[1]),...feet.R.map(p=>p[1]));
  const donor={L:{hip:[.3,1,0],knee:[.3,.5,.2],foot:[.3,0,0]},R:{hip:[-.3,1,0],knee:[-.3,.5,.2],foot:[-.3,0,0]}};
  const adapter=createStationaryFootContactAdapter({sourceFeet:[feet,feet],sourceTimes:[0,1/30],sourceFloor:floor,targetFloor:floor,legRatio:1,sourceLegFrames:[donor,donor],targetSampler:sampler});
  adapter.apply(target,0,update);
  for(const side of ['L','R']){
    const hip=target.byName.get(`thigh${side}`).worldPosition,knee=target.byName.get(`knee${side}`).worldPosition,foot=target.byName.get(`foot${side}`).worldPosition;
    const axis=foot.clone().sub(hip).normalize(),pole=knee.clone().sub(hip);pole.addScaledVector(axis,-pole.dot(axis)).normalize();
    const expected=new Vector3(0,0,1).applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,-1,0),axis));
    assert.ok(pole.dot(expected)>.999,'target rest geometry must not reverse the donor bend direction');
  }
});

test('geometric donor retarget preserves direction, knee flexion and fixed master lengths', () => {
  const target=targetGraph(JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')));
  const update=()=>{for(const node of target.ordered){node.worldPosition.copy(node.position);node.worldQuaternion.copy(node.quaternion);node.worldScale.copy(node.scale);if(node.parent){node.worldPosition.multiply(node.parent.worldScale).applyQuaternion(node.parent.worldQuaternion).add(node.parent.worldPosition);node.worldQuaternion.premultiply(node.parent.worldQuaternion);node.worldScale.multiply(node.parent.worldScale);}}};
  update();
  const positions=target.ordered.map(node=>node.position.toArray());
  const donor={hip:[0,1,0],knee:[.1,.6,.2],foot:[.15,.25,.05]};
  const sourceUpper=new Vector3().fromArray(donor.knee).sub(new Vector3().fromArray(donor.hip));
  const sourceLower=new Vector3().fromArray(donor.foot).sub(new Vector3().fromArray(donor.knee));
  const before=Object.fromEntries(['L','R'].map(side=>[side,target.byName.get('foot'+side).worldQuaternion.clone()]));
  retargetSourceLegPose(target,{L:donor,R:donor},update);
  for(const side of ['L','R']){
    const hip=target.byName.get('thigh'+side).worldPosition,knee=target.byName.get('knee'+side).worldPosition,foot=target.byName.get('foot'+side).worldPosition;
    const upper=knee.clone().sub(hip),lower=foot.clone().sub(knee);
    assert.ok(Math.abs(upper.angleTo(lower)-sourceUpper.angleTo(sourceLower))<1e-6);
    assert.ok(foot.clone().sub(hip).angleTo(new Vector3().fromArray(donor.foot).sub(new Vector3().fromArray(donor.hip)))<1e-6);
    assert.ok(target.byName.get('foot'+side).worldQuaternion.angleTo(before[side])<1e-6);
  }
  assert.deepEqual(target.ordered.map(node=>node.position.toArray()),positions);
});

test('swing reach uses the actual Cartesian blend instead of an unreachable full world goal', () => {
  const contact={side:'R',weight:.1,ankleGoal:[1,-.3,0],hipOffset:[0,0,0],authoredAnkleOffset:[0,-.3,0],reach:.333};
  const sphere=blendedContactRootConstraint(contact),radius=sphere.reach*.98;
  const center=contact.ankleGoal.map((v,k)=>v-sphere.hipOffset[k]);
  assert.ok(Math.hypot(...contact.ankleGoal)>contact.reach, 'The old unblended world goal must be unreachable.');
  assert.ok(Math.hypot(...center)<=radius, 'The blended swing is reachable at the authored root.');
  for(const root of [[0,0,0],[.2,.1,-.1],[3,0,0],[-1,.5,.2]]){
    const hip=root.map((v,k)=>v+contact.hipOffset[k]);
    const goal=root.map((v,k)=>(1-contact.weight)*(v+contact.authoredAnkleOffset[k])+contact.weight*contact.ankleGoal[k]);
    const actualDistance=Math.hypot(...hip.map((v,k)=>v-goal[k]));
    const sphereDistance=Math.hypot(...root.map((v,k)=>v-center[k]));
    assert.ok(Math.abs(actualDistance-sphereDistance*contact.weight)<1e-12);
    assert.equal(actualDistance<=contact.reach*(1-.02*contact.weight),sphereDistance<=radius);
  }
  const core=blendedContactRootConstraint({...contact,weight:1});
  assert.deepEqual(core.hipOffset,contact.hipOffset);assert.equal(core.reach,contact.reach);
});
test('zero and tiny swing weights cannot introduce huge fictitious root spheres', () => {
  const contact={weight:0,ankleGoal:[1,-.3,0],hipOffset:[0,0,0],authoredAnkleOffset:[0,-.3,0],reach:.333};
  assert.equal(blendedContactRootConstraint(contact),null);
  assert.equal(blendedContactRootConstraint({...contact,weight:1e-20}),null);
  assert.throws(()=>blendedContactRootConstraint({...contact,authoredAnkleOffset:[0,-.5,0]}),/independently/);
  assert.throws(()=>blendedContactRootConstraint({...contact,weight:NaN}),/Invalid/);
});

test('offline contact recentering accepts an explicit virtual bound while retaining the two-unit default', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const contract = JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json'));
  const sampler = createPlanarFootSampler(asset.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const run = virtualRootBound => {
    const target = targetGraph(contract), update = () => target.ordered.forEach(updateNode), root = target.byName.get('DoreumiRig');
    root.position.set(2.25, 1.046, 0); update();
    const points = sampler.sample(target), floor = Math.min(...points.L.map(p => p[1]), ...points.R.map(p => p[1]));
    const adapter = createStationaryFootContactAdapter({ sourceFeet: [points, points], sourceTimes: [0, 1 / 30], sourceFloor: floor,
      legRatio: 1, targetSampler: sampler, targetFloor: floor, ...(virtualRootBound === undefined ? {} : { virtualRootBound }) });
    adapter.apply(target, 0, update); root.position.x = 2.7; update(); adapter.apply(target, 1, update);
    return Math.hypot(root.position.x, root.position.z);
  };
  assert.throws(() => run(), /bounded planar contract/);
  assert.ok(run(3) <= 3);
  for (const virtualRootBound of [0, -1, 12.01, Infinity, NaN]) {
    assert.throws(() => createStationaryFootContactAdapter({ virtualRootBound }), /virtualRootBound/);
  }
});

test('longer landing preparation anticipates a future plant without extending its release', async () => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const contract = JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json'));
  const sampler = createPlanarFootSampler(asset.document, { L: ['footL'], R: ['footR'] }, { morphWeight: 1 });
  const run = preparationDuration => {
    const target = targetGraph(contract), update = () => target.ordered.forEach(updateNode);
    target.byName.get('DoreumiRig').position.y = 1.046; update();
    const skin = sampler.sample(target), floor = Math.min(...skin.L.map(p => p[1]), ...skin.R.map(p => p[1]));
    const times = Array.from({ length: 31 }, (_, i) => i / 30);
    const sourceFeet = times.map(time => ({ L: foot(0, time >= .4 && time <= .5 ? floor : floor + 1), R: foot(.6, floor + 1) }));
    const rows = [], adapter = createStationaryFootContactAdapter({ sourceFeet, sourceTimes: times, sourceFloor: floor,
      legRatio: 1, targetSampler: sampler, targetFloor: floor, plannedTargetFeet: times.map(() => skin),
      preparationDuration, preserveSourceTwist: false, onFrame: row => rows.push(row) });
    const pose = target.ordered.map(node => ({ position: node.position.clone(), quaternion: node.quaternion.clone() }));
    times.forEach((_, index) => { target.ordered.forEach((node, i) => { node.position.copy(pose[i].position); node.quaternion.copy(pose[i].quaternion); }); update(); adapter.apply(target, index, update); });
    return rows.filter(row => row.phase === 'solved');
  };
  const usual = run(.25), earlier = run(.4);
  const starts = rows => rows.find(row => row.constraints.some(c => c.anticipating && c.weight > 0)).time;
  assert.ok(starts(earlier) < starts(usual) - .1);
  const ends = rows => rows.filter(row => row.constraints.some(c => c.weight > 0)).at(-1).time;
  assert.equal(ends(earlier), ends(usual));
  for (const duration of [.099, .751, Infinity, NaN]) assert.throws(() => createStationaryFootContactAdapter({ preparationDuration: duration }), /preparationDuration/);
  assert.throws(() => createStationaryFootContactAdapter({ preserveSourceTwist: 'false' }), /preserveSourceTwist/);
});
