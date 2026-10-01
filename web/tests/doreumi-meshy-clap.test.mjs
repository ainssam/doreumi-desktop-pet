import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip, Quaternion, Vector3 } from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { createPlanarFootSampler } from '../scripts/doreumi/meshy-planar-support.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const contract = read('public/doreumi/rig-contract.json'), manifest = read('public/doreumi/motions/meshy-source-manifest.json');
const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
const hands = createPlanarFootSampler(asset.document, { L: ['wristL'], R: ['wristR'] }, { morphWeight: 1 });
const contacts = { 35: [2.95, 3.95, 5.55, 6.5, 7.85, 8.75, 9.6], 299: [.8, 1.2, 1.5, 1.9, 2.5], 354: [.3, .45, 1.15, 1.75, 2.35] };

test('shipping claps close actual mitten skin without penetration or a release twist', context => {
  for (const id of [35, 299, 354]) {
    const clip = AnimationClip.parse(read(`public/doreumi/motions/meshy-${id}.json`));
    const item = manifest.motions.find(item => item.actionId === id), target = targetGraph(contract);
    const tracks = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
    const sample = time => { for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(time)); target.ordered.forEach(updateNode); };
    let maximumLocalStep = 0, maximumWorldStep = 0, previous, maximumGap = 0, minimumClearance = Infinity;
    const arms = target.ordered.filter(node => /^(shoulder|arm|elbow|wrist)/.test(node.name));
    for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame++) {
      sample(Math.min(frame / 60, clip.duration));
      for (const [index, node] of arms.entries()) if (previous) {
        maximumLocalStep = Math.max(maximumLocalStep, node.quaternion.angleTo(previous[index].local) * 180 / Math.PI);
        maximumWorldStep = Math.max(maximumWorldStep, node.worldQuaternion.angleTo(previous[index].world) * 180 / Math.PI);
      }
      for (const rest of contract.bones) {
        const node = target.byName.get(rest.name);
        if (rest.name !== 'DoreumiRig') assert.deepEqual(node.position.toArray(), rest.restLocalPosition);
        assert.deepEqual(node.scale.toArray(), rest.restLocalScale);
      }
      for (const side of ['L', 'R']) assert.ok(target.byName.get(`wrist${side}`).quaternion.angleTo(new Quaternion()) < 1e-6);
      previous = arms.map(node => ({ local: node.quaternion.clone(), world: node.worldQuaternion.clone() }));
    }
    for (const sourceTime of contacts[id]) {
      sample(item.retargetEvidence.entryDuration + sourceTime);
      const points = hands.sample(target), axis = new Vector3(1, 0, 0).applyQuaternion(target.byName.get('torso').worldQuaternion);
      const projection = point => point[0] * axis.x + point[1] * axis.y + point[2] * axis.z;
      minimumClearance = Math.min(minimumClearance, Math.min(...points.L.map(projection)) - Math.max(...points.R.map(projection)));
      let squared = Infinity;
      for (const left of points.L) for (const right of points.R) squared = Math.min(squared, (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2 + (left[2] - right[2]) ** 2);
      maximumGap = Math.max(maximumGap, Math.sqrt(squared));
    }
    context.diagnostic(JSON.stringify({ id, maximumGap, minimumClearance, maximumLocalStep, maximumWorldStep }));
    assert.ok(maximumGap < .0214, 'actual source clap accents must meet within 1% of body height');
    assert.ok(minimumClearance > .008, 'positive plane separation must hold for every hand-skin vertex');
    assert.ok(maximumLocalStep < 4 && maximumWorldStep < 6, 'source approach, clap and release must keep a continuous arm branch');
  }
});
