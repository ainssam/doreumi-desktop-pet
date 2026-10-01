import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnimationClip, Vector3 } from 'three';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';
import { parseDoreumiTravel, projectTravelPoint } from '../src/lib/doreumi/motion-travel.ts';
import { stepImportedStage } from '../src/components/doreumi/locomotion.ts';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, registry, contract] = await Promise.all([
  readJson('public/doreumi/motions/meshy-source-manifest.json'),
  readJson('public/doreumi/motions/registry.json'),
  readJson('public/doreumi/rig-contract.json'),
]);
const locomotion = manifest.motions.filter(item => item.retargetEvidence.semantics.kind === 'locomotion');
const travelling = locomotion.filter(item => item.retargetEvidence.semantics.travel !== undefined);
const wideBounds = { width: 116, height: 98, viewportWidth: 20000, viewportHeight: 844, occupiedBottom: 82 };

test('locomotion without a completed travel curve remains pending and unavailable to ambient playback', () => {
  for (const item of locomotion.filter(item => item.retargetEvidence.semantics.travel === undefined)) {
    const entry = registry.motions.find(entry => entry.sourceActionId === item.actionId);
    assert.ok(entry, `missing registry action ${item.actionId}`);
    assert.equal(entry.review, 'pending', `uncompleted travel ${entry.id} must not be approved`);
    assert.equal(entry.ambient, false, `uncompleted travel ${entry.id} must not play randomly`);
    assert.equal(entry.travel, undefined, `stale registry travel for ${entry.id}`);
  }
});

test('all completed locomotion travel curves pass through the runtime parser', () => {
  assert.ok(travelling.length >= 176);
  for (const id of [39,40,43,62,109,339,341,635]) assert.ok(travelling.some(item => item.actionId === id), `body-movement walk ${id} must retain its travel`);
  for (const item of travelling) {
    const entry = registry.motions.find(entry => entry.id === `meshy:${item.actionId}`);
    assert.ok(entry, `missing registry action ${item.actionId}`);
    const expected = item.retargetEvidence.semantics.travel;
    const travel = parseDoreumiTravel(entry.travel, entry.duration);
    assert.deepEqual(travel, expected, `stale target curve for ${entry.id}`);
    let state = null;
    for (const time of travel.times) {
      const result = stepImportedStage(state, { action: entry.id, time, duration: entry.duration, paused: false, pixelsPerUnit: 45, travel }, wideBounds, 10000);
      assert.notEqual(result.decision?.stop, true, `${entry.id} unexpectedly stopped in a wide stage`);
      state = result.state;
    }
    const distance = projectTravelPoint(travel.positionsXZ.at(-1), state.yaw) * 45;
    assert.ok(Math.abs(state.x - 10000 - distance) < 1e-8, `lost travel for ${entry.id}`);
  }
});

test('real decoded forward, backward and diagonal clips keep the supporting foot fixed after host travel', async context => {
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const motion = new DoreumiMotion(asset.scene, asset.clips);
  const restFoot = contract.bones.find(bone => bone.name === 'footL');
  const soleDepth = contract.runtimeRootTranslation[1] + restFoot.restWorldMatrix[13];
  let totalContactFrames = 0, maximumScreenSlide = 0;
  try {
    for (const actionId of [5, 14, 20, 518]) {
      const item = travelling.find(item => item.actionId === actionId);
      const clip = AnimationClip.parse(await readJson(`public${item.url}`));
      const travel = parseDoreumiTravel(registry.motions.find(entry => entry.id === clip.name).travel, clip.duration);
      motion.registerClip(clip);
      const sample = time => {
        motion.seek(clip.name, time); asset.scene.updateMatrixWorld(true);
        return Object.fromEntries(['L', 'R'].map(side => [side, asset.scene.getObjectByName(`foot${side}`).localToWorld(new Vector3(0, -soleDepth, 0))]));
      };
      let state = stepImportedStage(null, { action: clip.name, time: 0, duration: clip.duration, paused: false, pixelsPerUnit: 45, travel }, wideBounds, 10000).state;
      let priorFeet = null, priorX = state.x, stance = null, tested = 0;
      for (const time of travel.times.slice(1, -1)) {
        const feet = sample(time);
        const result = stepImportedStage(state, { action: clip.name, time, duration: clip.duration, paused: false, pixelsPerUnit: 45, travel }, wideBounds, 10000);
        state = result.state;
        const lowest = feet.L.y <= feet.R.y ? 'L' : 'R';
        const nextStance = feet[lowest].y > .12 ? null : (!stance || feet[stance].y > feet[lowest].y + .035 ? lowest : stance);
        if (priorFeet && stance && nextStance === stance) {
          const before = priorX + projectTravelPoint([priorFeet[stance].x, priorFeet[stance].z], state.yaw) * 45;
          const after = state.x + projectTravelPoint([feet[stance].x, feet[stance].z], state.yaw) * 45;
          maximumScreenSlide = Math.max(maximumScreenSlide, Math.abs(after - before));
          assert.ok(Math.abs(after - before) < .002, `${clip.name} slides ${Math.abs(after - before)}px at ${time}s`);
          tested++; totalContactFrames++;
        }
        priorFeet = feet; priorX = state.x; stance = nextStance;
      }
      assert.ok(tested > 5, `${clip.name} did not exercise enough real planted-foot frames`);
    }
    assert.ok(totalContactFrames > 80);
    assert.ok(maximumScreenSlide < .002);
    context.diagnostic(`${totalContactFrames} real planted-foot frames, maximum horizontal residual ${maximumScreenSlide.toFixed(6)}px at 45px/unit`);
  } finally { motion.dispose(); }
});
