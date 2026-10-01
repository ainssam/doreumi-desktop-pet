import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Vector3, VectorKeyframeTrack } from 'three';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { sampleSnowmanMotion } from '../src/lib/doreumi/motion-snowman.ts';
import { DOREUMI_LAP } from '../src/lib/doreumi/motion-lap.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(path) { const asset = await loadDoreumiAsset(path); return { ...asset, motion: new DoreumiMotion(asset.scene, asset.clips) }; }
const position = (scene, name) => scene.getObjectByName(name).getWorldPosition(new Vector3());

test('pose recovery is preserved at hold start and across the loop boundary', async () => {
  const { motion } = await fixture('public/doreumi/doreumi-master.glb');
  for (const action of ['Code', 'Read', 'Sit', 'Lie']) {
    for (const holdTime of [0, .05, .14, .16, 2.39, 2.45]) {
      motion.seek(action, 0); motion.resume();
      for (let frame = 0; motion.inspect().phase !== 'hold' && frame < 600; frame++) motion.update(1 / 60);
      assert.equal(motion.inspect().phase, 'hold', action);
      for (let elapsed = 0; elapsed < holdTime; elapsed += 1 / 60) motion.update(Math.min(1 / 60, holdTime - elapsed));
      motion.setAction('Idle');
      assert.equal(motion.inspect().recovering, true, `${action} hold ${holdTime}`);
      assert.equal(motion.inspect().phase, 'exit');
      for (let frame = 0; frame < 100; frame++) motion.update(1 / 60);
      assert.equal(motion.inspect().action, 'Idle');
      assert.equal(motion.inspect().recovering, false);
    }
  }
  motion.dispose();
});

test('master preserves original geometry, UVs, textures and neutral morph', async () => {
  const source = await loadDoreumiAsset(), master = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  for (const name of ['position', 'normal', 'uv']) assert.equal(hash(source.skinned[0].object.geometry.getAttribute(name).array), hash(master.skinned[0].object.geometry.getAttribute(name).array), name);
  for (const name of ['position', 'normal']) assert.equal(hash(source.skinned[0].object.geometry.morphAttributes[name][0].array), hash(master.skinned[0].object.geometry.morphAttributes[name][0].array), `neutral ${name}`);
  assert.deepEqual(source.document.getRoot().listTextures().map(t => hash(t.getImage())), master.document.getRoot().listTextures().map(t => hash(t.getImage())));
  const motion = new DoreumiMotion(master.scene, master.clips); assert.equal(motion.clips.length, 26); assert.ok(motion.rig.maxRestError < 1e-6); assert.equal(motion.rig.version, 3); motion.dispose();
  assert.deepEqual(motion.clips.map(clip => clip.tracks.map(track => hash(track.values))), master.clips.map(clip => clip.tracks.map(track => hash(track.values))), 'baked master must not be retargeted or grounded twice');
});

test('neck skin stays connected when head and torso rotate independently', async () => {
  const { scene, motion, skinned } = await fixture('public/doreumi/doreumi-master.glb'), mesh = skinned[0].object;
  motion.seek('Idle', 0); scene.updateMatrixWorld(true); mesh.skeleton.update();
  const count = mesh.geometry.getAttribute('position').count, before = [], groups = new Map();
  for (let i = 0; i < count; i++) {
    const point = mesh.getVertexPosition(i, new Vector3()); before.push(point);
    const key = point.toArray().map(value => Math.round(value * 1e5)).join(',');
    const group = groups.get(key); if (group) group.push(i); else groups.set(key, [i]);
  }
  scene.getObjectByName('head').rotation.set(.30, .65, .12); scene.getObjectByName('torso').rotation.set(-.10, -.15, -.05);
  scene.updateMatrixWorld(true); mesh.skeleton.update(); const after = before.map((_, i) => mesh.getVertexPosition(i, new Vector3()));
  let seamGap = 0, edgeGap = 0, checked = 0;
  for (const group of groups.values()) for (const vertex of group.slice(1)) seamGap = Math.max(seamGap, after[group[0]].distanceTo(after[vertex]));
  const indices = mesh.geometry.index;
  for (let i = 0; i < indices.count; i += 3) for (let corner = 0; corner < 3; corner++) {
    const a = indices.getX(i + corner), b = indices.getX(i + (corner + 1) % 3);
    if (before[a].y < .94 || before[a].y > 1.38 || before[b].y < .94 || before[b].y > 1.38 || before[a].distanceTo(before[b]) > .025) continue;
    edgeGap = Math.max(edgeGap, after[a].distanceTo(after[b])); checked++;
  }
  assert.ok(checked > 1000); assert.ok(seamGap < .0001, `duplicated skin seam split ${seamGap}`); assert.ok(edgeGap < .055, `neck edge tore ${edgeGap}`);
  console.log(JSON.stringify({ neckEdgesChecked: checked, neckMaximumEdge: edgeGap, weldedMaximumGap: seamGap })); motion.dispose();
});

test('seated and lying holds keep their body on the floor and recover continuously', async () => {
  const { scene, motion, skinned } = await fixture('public/doreumi/doreumi-master.glb'), mesh = skinned[0].object; let floorError = 0;
  for (const action of ['Sit', 'Lie', 'Roll', 'NewYearBow']) {
    for (let i = 1; i <= 18; i++) {
      motion.seek(action, motion.clips.find(clip => clip.name === action).duration * i / 18); scene.updateMatrixWorld(true); mesh.skeleton.update(); mesh.computeBoundingBox();
      floorError = Math.max(floorError, Math.abs(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld).min.y));
    }
  }
  for (const action of ['Sit', 'Lie']) {
    motion.seek(action, 0); motion.resume(); for (let i = 0; i < 8 * 60; i++) motion.update(1 / 60);
    assert.equal(motion.inspect().phase, 'hold'); assert.equal(motion.inspect().action, action);
    motion.setAction('Run'); for (let i = 0; i < 90; i++) motion.update(1 / 60); assert.equal(motion.inspect().action, 'Run');
  }
  assert.ok(floorError < .015, `floor contact drifted ${floorError}`); console.log(JSON.stringify({ restingBodyMaximumFloorError: floorError })); motion.dispose();
});

test('elbows and knees are connected parents and rotate distal hands and feet', async () => {
  const { scene, motion } = await fixture(); motion.seek('Idle', 0); scene.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    assert.equal(scene.getObjectByName(`arm${side}`).parent.name, `shoulder${side}`);
    assert.equal(scene.getObjectByName(`wrist${side}`).parent.name, `elbow${side}`);
    assert.equal(scene.getObjectByName(`shin${side}`).parent.name, `knee${side}`);
    const foot = position(scene, `foot${side}`), head = position(scene, 'head');
    scene.getObjectByName(`knee${side}`).rotateX(.7); scene.updateMatrixWorld(true);
    assert.ok(position(scene, `foot${side}`).distanceTo(foot) > .08, 'knee must move its foot');
    assert.ok(position(scene, 'head').distanceTo(head) < 1e-8, 'knee must not move the upper body');
    const hand = position(scene, `palm${side}`); scene.getObjectByName(`elbow${side}`).rotateX(.7); scene.updateMatrixWorld(true);
    assert.ok(position(scene, `palm${side}`).distanceTo(hand) > .06, 'elbow must move its hand');
  }
  motion.dispose();
});

test('seated work keeps both palm contacts on the keyboard and keeps moving after entry', async () => {
  const { scene, motion } = await fixture(); let worst = 0, greatestStep = 0;
  for (const name of ['Code', 'Read']) {
    for (let i = 0; i <= 90; i++) {
      motion.seek(name, 1.2 + 4.8 * i / 90); scene.updateMatrixWorld(true);
      for (const side of ['L', 'R']) {
        const local = new Vector3((side === 'L' ? 1 : -1) * DOREUMI_LAP.handWidth, DOREUMI_LAP.handHeight[name], DOREUMI_LAP.handDepth[name]);
        if (name === 'Read') local.sub(new Vector3(0, 0, DOREUMI_LAP.bookHingeZ)).applyAxisAngle(new Vector3(1, 0, 0), -DOREUMI_LAP.bookTilt).add(new Vector3(0, 0, DOREUMI_LAP.bookHingeZ));
        const expected = scene.getObjectByName('lap').localToWorld(local);
        worst = Math.max(worst, position(scene, `palm${side}`).distanceTo(expected));
      }
    }
    motion.seek(name, 0); motion.resume(); let previous = null, movement = 0;
    for (let i = 0; i < 15 * 60; i++) {
      motion.update(1 / 60);
      if (i > 7 * 60) { const current = position(scene, 'palmL'); if (previous) { greatestStep = Math.max(greatestStep, current.distanceTo(previous)); movement += current.distanceTo(previous); } previous = current; }
    }
    assert.equal(motion.inspect().action, name); assert.equal(motion.inspect().phase, 'hold'); assert.ok(movement > .02, `${name} must not freeze after entry`);
    motion.setAction('Run'); for (let i = 0; i < 90; i++) motion.update(1 / 60); assert.equal(motion.inspect().action, 'Run'); assert.equal(motion.inspect().recovering, false);
  }
  assert.ok(worst <= .02, `palm to keyboard max distance ${worst}`); assert.ok(greatestStep < .012, `hold seam jumped ${greatestStep}`);
  console.log(JSON.stringify({ palmKeyboardMaxDistance: worst, holdMaxFrameStep: greatestStep })); motion.dispose();
});

test('walk and run plant support feet and preserve segment lengths', async () => {
  const { scene, motion, skinned } = await fixture(); const mesh = skinned[0].object, attr = mesh.geometry.getAttribute('position');
  const soles = Object.fromEntries(['L', 'R'].map(side => [side, Array.from({ length: attr.count }, (_, i) => i).filter(i => attr.getY(i) < -.95 && attr.getX(i) * (side === 'L' ? 1 : -1) > .09)]));
  const metrics = [];
  for (const [action, cycle, duty, stride] of [['Walk', 1.15, .64, .145], ['Run', .45, .48, .19]]) {
    let worstFloor = 0, worstTravel = 0, worstLength = 0; const old = {};
    for (let i = 0; i < 100; i++) {
      const t = cycle * i / 100; motion.seek(action, t); scene.updateMatrixWorld(true); mesh.skeleton.update();
      for (const side of ['L', 'R']) {
        const u = (t / cycle + (side === 'R' ? .5 : 0)) % 1;
        const thigh = position(scene, `thigh${side}`), knee = position(scene, `knee${side}`), foot = position(scene, `foot${side}`);
        worstLength = Math.max(worstLength, Math.abs(thigh.distanceTo(knee) - Math.hypot(.17, .015)), Math.abs(knee.distanceTo(foot) - Math.hypot(.155, .05)));
        if (u > .035 && u < duty - .035) {
          let floor = Infinity; for (const vertex of soles[side]) floor = Math.min(floor, mesh.localToWorld(mesh.getVertexPosition(vertex, new Vector3())).y);
          worstFloor = Math.max(worstFloor, Math.abs(floor));
          if (old[side]?.stance) worstTravel = Math.max(worstTravel, Math.abs((foot.z - old[side].z) / (cycle / 100) + stride / (cycle * duty)));
          old[side] = { stance: true, z: foot.z };
        } else old[side] = { stance: false, z: foot.z };
      }
    }
    assert.ok(worstLength < 1e-5, `${action} stretched a leg: ${worstLength}`);
    assert.ok(worstFloor <= .02, `${action} support foot lifted/penetrated ${worstFloor}`);
    assert.ok(worstTravel < .035, `${action} support foot slid at ${worstTravel} model units/s`);
    metrics.push({ action, supportFloorMaxError: worstFloor, stanceSpeedMaxError: worstTravel, legLengthMaxError: worstLength });
  }
  console.log(JSON.stringify(metrics)); motion.dispose();
});

test('snowman palm follows the visible snow and landing compresses with planted feet', async () => {
  const { scene, motion, skinned } = await fixture('public/doreumi/doreumi-master.glb'), mesh = skinned[0].object;
  let snowContact = 0, landingFloor = 0;
  for (let i = 0; i <= 100; i++) {
    const t = .75 + 4.8 * i / 100; motion.seek('Snowman', t); scene.updateMatrixWorld(true);
    snowContact = Math.max(snowContact, position(scene, 'palmR').distanceTo(new Vector3().fromArray(sampleSnowmanMotion(t).handPosition)));
  }
  motion.seek('Landing', 0); const standing = position(scene, 'body').y; let lowest = standing;
  for (let i = 0; i <= 40; i++) {
    motion.seek('Landing', .65 * i / 40); scene.updateMatrixWorld(true); mesh.skeleton.update(); mesh.computeBoundingBox();
    lowest = Math.min(lowest, position(scene, 'body').y); landingFloor = Math.max(landingFloor, Math.abs(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld).min.y));
  }
  assert.ok(snowContact < .02, `snowman palm drifted ${snowContact}`); assert.ok(standing - lowest > .07, 'landing must absorb the impact in its joints'); assert.ok(landingFloor < .015, `landing feet left floor ${landingFloor}`);
  for (const name of ['Dragged', 'Falling']) for (const track of motion.clips.find(clip => clip.name === name).tracks) {
    const size = track.getValueSize(); assert.ok(Array.from(track.values.slice(0, size)).every((value, i) => Math.abs(value - track.values[track.values.length - size + i]) < 1e-5), `${name} loop seam: ${track.name}`);
  }
  console.log(JSON.stringify({ snowmanPalmMaxDistance: snowContact, landingBodyCompression: standing - lowest, landingFloorMaxError: landingFloor })); motion.dispose();
});

test('imported clips are registered lazily and eviction preserves the active action', async () => {
  const { motion } = await fixture();
  // Authored seated clips key the lap socket; imported Meshy clips never do.
  for (const clip of motion.clips) clip.tracks = clip.tracks.filter(track => !track.name.startsWith('lap.'));
  for (let i = 1; i <= 12; i++) { const clip = motion.clips.find(c => c.name === 'Wave').clone(); clip.name = `meshy:${i}`; motion.registerClip(clip); }
  motion.setAction('meshy:1'); motion.update(.05);
  for (let i = 13; i <= 30; i++) { const clip = motion.clips[0].clone(); clip.name = `meshy:${i}`; motion.registerClip(clip); }
  assert.equal(motion.inspect().action, 'meshy:1'); assert.equal(motion.hasClip('meshy:1'), true); assert.ok(motion.inspect().importedClips <= 12); assert.equal(motion.hasClip('meshy:2'), false);
  const invalid = motion.clips[0].clone(); invalid.name = 'meshy:999'; invalid.tracks[0].values[0] = NaN; assert.throws(() => motion.registerClip(invalid), /Invalid imported track/);
  const malformed = motion.clips[0].clone(); malformed.name = 'meshy:998'; malformed.tracks[0].values = malformed.tracks[0].values.slice(1); assert.throws(() => motion.registerClip(malformed), /Invalid imported track/);
  for (let i = 40; i < 70; i++) { const clip = motion.clips[0].clone(); clip.name = `meshy:${i}`; motion.registerClip(clip); motion.setAction(clip.name); motion.update(.001); assert.ok(motion.inspect().activeActions <= 5); assert.ok(motion.inspect().importedClips <= 12); }
  motion.dispose();
});

test('stationary support compensation requires a bounded contract and returns to the origin', async () => {
  const { motion } = await fixture('public/doreumi/doreumi-master.glb');
  const clip = motion.clips[0].clone(); clip.name = 'meshy:901';
  clip.tracks = clip.tracks.filter(track => track.name !== 'DoreumiRig.position' && !track.name.startsWith('lap.'));
  clip.tracks.push(new VectorKeyframeTrack('DoreumiRig.position', [0, clip.duration / 2, clip.duration], [0,0,0, .1,0,.1, 0,0,0]));
  assert.throws(() => motion.registerClip(clip), /support contract/);
  assert.throws(() => motion.registerClip(clip, { planarSupportMaxOffset: .1 }), /support contract/);
  assert.throws(() => motion.registerClip(clip, { planarSupportMaxOffset: 3 }), /Invalid bounded/);
  motion.registerClip(clip, { planarSupportMaxOffset: .15 });
  assert.equal(motion.hasClip('meshy:901'), true);
  const unrecovered = clip.clone(); unrecovered.name = 'meshy:902';
  unrecovered.tracks.at(-1).values[6] = .1;
  assert.throws(() => motion.registerClip(unrecovered, { planarSupportMaxOffset: .15 }), /resting origin/);
  motion.dispose();
});
