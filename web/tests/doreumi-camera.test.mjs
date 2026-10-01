import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip } from 'three';
import { validMotionFrame, sampleMotionFrame, blendMotionFrames, advanceMotionCamera } from '../src/lib/doreumi/motion-camera.ts';
import { parseMotionLibrary } from '../src/lib/doreumi/motion-library.ts';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';
import { doreumiFrame } from '../src/lib/doreumi/motion-catalog.ts';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { targetGraph, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { createMasterSupport } from '../scripts/doreumi/meshy-master-support.mjs';
import { buildTrackedCamera } from '../scripts/doreumi/meshy-camera.mjs';

const frame = { halfHeight: 1.8, centerY: 1, tracking: { times: [0, 1, 3], centerY: [1, 9, 1] } };
test('measured framing follows ascent and descent without changing the character scale', () => {
  assert.equal(validMotionFrame(frame, 3), true);
  for (const [time, centerY] of [[-1, 1], [.5, 5], [1, 9], [2, 5], [4, 1]]) {
    assert.deepEqual(sampleMotionFrame(frame, time, 1), { halfHeight: 1.8, centerY });
  }
  assert.deepEqual(sampleMotionFrame(frame, 2, .5), { halfHeight: 3.6, centerY: 5 });
  assert.deepEqual(sampleMotionFrame({ halfHeight: 1.3, centerY: 1.1 }, 100, 1), { halfHeight: 1.3, centerY: 1.1 });
});

test('registry rejects incomplete or malformed camera tracking before rendering', () => {
  const entry = { id: 'meshy:501', sourceActionId: 501, label: 'fall', duration: 3, family: 'Acting', review: 'pending', ambient: false };
  for (const tracking of [null, {}, { times: [0, 1, 1], centerY: [1, 2, 3] },
    { times: [0, 3], centerY: [1] }, { times: [0, 3], centerY: [1, NaN] },
    { times: [0, 3], centerY: [1, 11] }, { times: [1, 3], centerY: [1, 2] },
    { times: [0, 2], centerY: [1, 2] }]) {
    assert.throws(() => parseMotionLibrary({ version: 1, motions: [{ ...entry, frame: { ...frame, tracking } }] }));
  }
  assert.doesNotThrow(() => parseMotionLibrary({ version: 1, motions: [{ ...entry, frame }] }));
});

test('untracked camera preserves legacy portrait framing and mixer rest weight', () => {
  for (const aspect of [.5, 1, 2]) {
    const actual = blendMotionFrames([{ action: 'Idle', time: 0, weight: 1 }], () => undefined, aspect);
    const expected = doreumiFrame('Idle', aspect);
    assert.equal(actual.halfHeight, expected.halfHeight);
    assert.equal(actual.centerY, expected.centerY);
    assert.equal(actual.tracking, false);
  }
  const mixed = blendMotionFrames([{ action: 'meshy:501', time: 1, weight: .25 }], name => name === 'meshy:501' ? frame : undefined, 1);
  assert.equal(mixed.centerY, 9 * .25 + 1.14 * .75);
  assert.equal(mixed.tracking, true);
});

test('ending a wide frame eases apparent scale even after a slow RAF', () => {
  const wide = { halfHeight: 1.853497592980042, centerY: 1.101355164852005, tracking: false };
  const idle = { halfHeight: 1.34, centerY: 1.14, tracking: false };
  for (const delta of [1 / 60, .05, .1736, .25]) {
    let current = wide;
    for (let index = 0; index < 150; index++) {
      const next = advanceMotionCamera(current, idle, delta);
      assert.ok(next.halfHeight >= idle.halfHeight && next.halfHeight <= current.halfHeight);
      assert.ok(current.halfHeight / next.halfHeight <= Math.exp(.6 * Math.min(delta, 1 / 30)) + 1e-10);
      current = next;
    }
    assert.ok(current.halfHeight - idle.halfHeight < .001);
    assert.equal(advanceMotionCamera(current, wide, delta).halfHeight, wide.halfHeight, 'Required expansion remains immediate');
  }
  assert.deepEqual(advanceMotionCamera(wide, idle, 0, true), idle);
});

test('actual tracked flights and interrupted mixer poses stay inside the camera', async context => {
  const masterFile = 'public/doreumi/doreumi-master.glb';
  const contract = JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json'));
  const library = parseMotionLibrary(JSON.parse(fs.readFileSync('public/doreumi/motions/registry.json')));
  const support = await createMasterSupport(masterFile, contract);
  const assets = await loadDoreumiAsset(masterFile), motion = new DoreumiMotion(assets.scene, assets.clips);
  const graph = targetGraph(contract), clips = new Map();
  for (const id of [501, 508]) {
    const clip = AnimationClip.parse(JSON.parse(fs.readFileSync(`public/doreumi/motions/meshy-${id}.json`)));
    motion.registerClip(clip); clips.set(`meshy:${id}`, clip);
  }
  const frameFor = name => library.motions.find(item => item.id === name)?.frame;
  const measure = () => {
    for (const node of graph.ordered) {
      const bone = assets.scene.getObjectByName(node.name);
      node.position.copy(bone.position); node.quaternion.copy(bone.quaternion); node.scale.copy(bone.scale); updateNode(node);
    }
    return support.measure(graph, true);
  };
  let samples = 0, worstOverflow = 0;
  const check = (camera, label, aspect = 1) => {
    const bounds = measure();
    const overflow = Math.max(0, bounds.maxY - camera.centerY - camera.halfHeight, camera.centerY - camera.halfHeight - bounds.minY,
      bounds.radius - camera.halfHeight * aspect);
    worstOverflow = Math.max(worstOverflow, overflow); samples++;
    assert.ok(overflow < .001, `${label}: actual skin exceeds the camera by ${overflow}`);
  };
  try {
    for (const id of [501, 508]) {
      const name = `meshy:${id}`, imported = frameFor(name), clip = clips.get(name);
      // Exercise the actual offline generator, not a hand-authored track.
      const rebuilt = buildTrackedCamera(AnimationClip.toJSON(clip), targetGraph(contract), support, updateNode);
      assert.deepEqual(rebuilt, imported);
      for (let index = 0; index <= Math.ceil(clip.duration * 60); index++) {
        motion.seek(name, Math.min(clip.duration, index / 60));
        check(blendMotionFrames(motion.inspect().framingSamples, frameFor, 1), `${name} flight ${index}`);
      }
      const peak = imported.tracking.centerY.indexOf(Math.max(...imported.tracking.centerY));
      for (const aspect of [.5, 1, 2]) for (const next of ['Think', 'Dragged', `meshy:${id === 501 ? 508 : 501}`]) {
        motion.seek(name, imported.tracking.times[peak]);
        let camera = blendMotionFrames(motion.inspect().framingSamples, frameFor, aspect);
        motion.setAction(next);
        // render(0) runs synchronously before the new action's first update.
        assert.deepEqual(blendMotionFrames(motion.inspect().framingSamples, frameFor, aspect), camera);
        for (let index = 0; index < 72; index++) {
          const delta = 1 / 120; motion.update(delta);
          const target = blendMotionFrames(motion.inspect().framingSamples, frameFor, aspect);
          camera = advanceMotionCamera(camera, target, delta);
          check(camera, `${name} -> ${next} at ${index / 120}, aspect ${aspect}`, aspect);
          if (index === 8) motion.setAction('Dragged'); // interrupt a live blend once more
        }
      }
      // Actual normal-speed browser capture had an initial .1736s RAF stall,
      // consuming the full .14s drag fade in one render. Fine-step tests alone
      // missed the outgoing tracking flag disappearing at that boundary.
      const measuredDeltas = [.1736, .0624, .0627, .0556, .0624, .0626, .0554, .0626];
      for (const deltas of [measuredDeltas, Array(16).fill(.05), Array(8).fill(.1), Array(4).fill(.25)]) {
        for (const rate of [1, .25]) for (const next of ['Think', 'Dragged']) {
          motion.seek(name, imported.tracking.times[peak]);
          let camera = blendMotionFrames(motion.inspect().framingSamples, frameFor, 1);
          motion.setAction(next);
          for (const delta of deltas) {
            motion.update(delta * rate);
            camera = advanceMotionCamera(camera, blendMotionFrames(motion.inspect().framingSamples, frameFor, 1), delta);
            check(camera, `${name} -> ${next} with RAF ${delta}s at rate ${rate}`);
          }
        }
      }
    }
  } finally { motion.dispose(); }
  context.diagnostic(JSON.stringify({ measuredSkinFrames: samples, worstOverflow }));
});
