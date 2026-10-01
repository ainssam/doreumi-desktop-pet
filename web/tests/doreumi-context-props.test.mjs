import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { DOREUMI_CONTEXT_ACTIONS, contextPropsSupport } from '../src/lib/doreumi/motion-context-capabilities.ts';
import { createDoreumiContextProps } from '../src/lib/doreumi/motion-context-props.ts';
import { auditMotionContext } from '../scripts/doreumi/meshy-context-audit.mjs';
import { motionSemantics } from '../scripts/doreumi/meshy-adaptation.mjs';
import { sampleDoreumiTravel } from '../src/lib/doreumi/motion-travel.ts';

const manifest = JSON.parse(await readFile('public/doreumi/motions/meshy-source-manifest.json', 'utf8'));
if (process.env.DOREUMI_CONTEXT_MANIFEST) {
  const overrides = JSON.parse(await readFile(process.env.DOREUMI_CONTEXT_MANIFEST, 'utf8'));
  for (const item of overrides.motions) {
    const index = manifest.motions.findIndex(entry => entry.actionId === item.actionId);
    assert.ok(index >= 0 && overrides.candidate === true, 'context override must name an existing local candidate');
    manifest.motions[index] = item;
  }
}
const clips = new Map(await Promise.all(Object.values(DOREUMI_CONTEXT_ACTIONS).flat().map(async id => [id,
  THREE.AnimationClip.parse(JSON.parse(await readFile(`public/${manifest.motions.find(item => item.actionId === id).url}`, 'utf8')))])));

async function fixture() {
  const asset = await loadDoreumiAsset(process.env.DOREUMI_TEST_MASTER ?? 'public/doreumi/doreumi-master.glb');
  const holder = new THREE.Group(); holder.add(asset.scene);
  const mixer = new THREE.AnimationMixer(asset.scene), props = createDoreumiContextProps({ model: asset.scene, parent: holder });
  return { ...asset, holder, mixer, props };
}
function select(fixture, id) {
  fixture.mixer.stopAllAction(); const clip = clips.get(id);
  const action = fixture.mixer.clipAction(clip).reset().play(); action.setLoop(THREE.LoopOnce, 0); action.clampWhenFinished = true;
  const item = manifest.motions.find(item => item.actionId === id);
  fixture.props.setMotion({ sourceActionId: id, props: item.retargetEvidence.semantics.requiresProps,
    entryDuration: item.retargetEvidence.entryDuration, exitDuration: item.retargetEvidence.exitDuration, travel: item.retargetEvidence.semantics.travel });
  return clip;
}
function pose(fixture, time, duration) {
  fixture.mixer.setTime(time); fixture.holder.updateMatrixWorld(true);
  fixture.skinned.forEach(({ object }) => object.skeleton.update());
  fixture.props.update({ time, duration }); return fixture.props.inspect();
}

test('context capabilities are lightweight, exact, and never approve a different action or unsafe context', () => {
  assert.equal(new Set(Object.values(DOREUMI_CONTEXT_ACTIONS).flat()).size, 51);
  for (const [kind, ids] of Object.entries(DOREUMI_CONTEXT_ACTIONS)) for (const id of ids) assert.equal(contextPropsSupport(id === 343 ? ['cup', 'seating-surface'] : [kind], id).supported, true);
  assert.equal(contextPropsSupport(['cup'], 343).supported, false);
  assert.equal(contextPropsSupport(['seating-surface'], 343).supported, false);
  assert.equal(contextPropsSupport(['bag'], 43).supported, true);
  assert.equal(contextPropsSupport(['bag'], 0).supported, false);
  for (const prop of ['weapon', 'cannon', 'door', 'mirror']) assert.equal(contextPropsSupport([prop], 46).supported, false);
  assert.equal(contextPropsSupport(['phone', 'chair'], 29).supported, false);
  assert.equal(contextPropsSupport(['phone'], NaN).supported, false);
  assert.equal(contextPropsSupport([], 0).supported, true);
});

test('the full source catalog has explicit context gates, including omissions outside prop-name regexes', () => {
  assert.equal(manifest.motions.length, 524);
  assert.ok(manifest.motions.every(item => item.retargetEvidence.semantics.contextAudit?.catalogLabelReviewed));
  for (const [id, prop] of [[46, 'jump-rope'], [48, 'mirror'], [263, 'desk'], [342, 'cup'], [441, 'stairs'], [567, 'walker'], [568, 'water']]) {
    assert.ok(auditMotionContext({ actionId: id }).dependencies.includes(prop));
  }
  assert.equal(auditMotionContext({ actionId: 411 }).status, 'inappropriate-ambient-context');
  assert.ok(auditMotionContext({ actionId: 545 }).dependencies.includes('weapon'));
  for (const id of [39, 40, 43, 62, 109, 339, 341, 635]) {
    const item = manifest.motions.find(item => item.actionId === id);
    const semantics = motionSemantics(item, [[0, 0, 0], [0, 0, 1]], 3, .37);
    assert.equal(semantics.kind, 'locomotion');
    assert.equal(item.retargetEvidence.semantics.travel.source, 'target-stance');
    assert.ok(item.retargetEvidence.semantics.travel.times.every((time, index, times) => !index || time > times[index - 1]));
  }
  assert.deepEqual(auditMotionContext({ actionId: 75 }).dependencies, [], 'Indoor_Swing dance is not a door or a playground swing');
  assert.deepEqual(auditMotionContext({ actionId: 385 }).dependencies, [], 'Boxing_Warmup does not imply a carried box');
});

test('all 51 context clips preserve the model and follow actual skin or their explicit ground/release event', async context => {
  const f = await fixture(), originals = f.skinned.map(({ object }) => new Float32Array(object.geometry.attributes.position.array));
  let samples = 0, maximumContactGap = 0, minimumFloorClearance = Infinity;
  for (const id of clips.keys()) {
    const clip = select(f, id);
    for (const fraction of [.25, .5, .75]) {
      f.mixer.setTime(clip.duration * fraction); f.holder.updateMatrixWorld(true);
      const before = [];
      f.scene.traverse(object => { if (object instanceof THREE.Bone || object.name === 'DoreumiRig') before.push([object, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()]); });
      f.props.update({ time: clip.duration * fraction, duration: clip.duration });
      const state = f.props.inspect(); assert.equal(state.visible, true, `${id}@${fraction}`); assert.equal(state.finite, true);
      assert.ok((state.bounds && state.floorClearance >= -.003) || (state.interactionPhase === 'released' && !state.bounds), `${id} prop below floor: ${state.floorClearance}`);
      if (state.interactionPhase === 'held') assert.ok(state.contacts.length > 0, `${id} missing held contact`);
      for (const contact of state.contacts) {
        maximumContactGap = Math.max(maximumContactGap, contact.distance);
        assert.ok(contact.distance <= .0214, `${id} ${contact.target} gap ${contact.distance}`);
      }
      minimumFloorClearance = Math.min(minimumFloorClearance, state.floorClearance);
      for (const [object, position, quaternion, scale] of before) {
        assert.deepEqual(object.position.toArray(), position, `${id} moved ${object.name}`);
        assert.deepEqual(object.quaternion.toArray(), quaternion, `${id} rotated ${object.name}`);
        assert.deepEqual(object.scale.toArray(), scale, `${id} stretched ${object.name}`);
      }
      samples++;
    }
  }
  f.skinned.forEach(({ object }, index) => assert.deepEqual(object.geometry.attributes.position.array, originals[index]));
  context.diagnostic(JSON.stringify({ clips: clips.size, samples, maximumContactGap, minimumFloorClearance }));
  f.props.dispose();
});

test('walker wheels stay grounded and roll along actual grip plus host travel without resizing the frame', async context => {
  const f = await fixture(); let samples = 0, maximumGap = 0, maximumRollingError = 0;
  for (const id of [567, 696]) {
    const clip = select(f, id), motion = manifest.motions.find(item => item.actionId === id);
    let previous, scales;
    for (let index = 0; index <= Math.ceil(clip.duration * 30); index++) {
      const time = Math.min(index / 30, clip.duration), state = pose(f, time, clip.duration);
      if (!state.visible) continue;
      let group; f.props.root.traverse(object => { if (object.name === 'Doreumi_portable_walker' && object.visible) group = object; });
      assert.ok(group); assert.equal(state.interactionPhase, 'supported'); assert.equal(state.contacts.length, 2);
      assert.ok(state.floorClearance >= -1e-7 && state.floorClearance < .001, 'actual wheel vertices must touch the floor');
      for (const contact of state.contacts) { maximumGap = Math.max(maximumGap, contact.distance); assert.ok(contact.distance < .0214); }
      if (!scales) { scales = []; group.traverse(object => scales.push([object, object.scale.toArray()])); }
      for (const [object, scale] of scales) assert.deepEqual(object.scale.toArray(), scale, 'walker frame resized to follow the hands');
      const travel = sampleDoreumiTravel(motion.retargetEvidence.semantics.travel, time), wheels = [];
      group.traverse(object => {
        if (object.name !== 'Doreumi_walker_wheel') return;
        const position = object.getWorldPosition(new THREE.Vector3()); position.x += travel[0]; position.z += travel[1];
        const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(object.parent.getWorldQuaternion(new THREE.Quaternion()));
        wheels.push({ position, direction, angle: object.rotation.x });
      });
      assert.equal(wheels.length, 4);
      if (previous) for (let side = 0; side < 4; side++) {
        const current = wheels[side], before = previous[side], distance = (current.angle - before.angle) * .085;
        const actual = current.position.clone().sub(before.position), rolling = current.direction.clone().multiplyScalar(distance);
        maximumRollingError = Math.max(maximumRollingError, actual.distanceTo(rolling));
        assert.ok(actual.distanceTo(rolling) < 1e-7, 'wheel surface speed differs from its ground path');
      }
      previous = wheels; samples++;
    }
  }
  context.diagnostic(JSON.stringify({ samples, maximumGap, maximumRollingError })); f.props.dispose();
});

test('clapping cushions support butt skin and stay on the floor during stand-up', async context => {
  const f = await fixture();
  let minimumSkinRadiusSquared = Infinity, maximumGap = 0, contactSamples = 0, worst;
  for (const id of [299, 354]) {
    const clip = select(f, id), item = manifest.motions.find(item => item.actionId === id);
    let center, idMinimum=Infinity;
    const sampleCount = Math.ceil(item.retargetEvidence.sourceDuration * 30);
    for (let index = 0; index <= sampleCount; index++) {
      const sourceTime = item.retargetEvidence.sourceDuration * index / sampleCount;
      const state = pose(f, item.retargetEvidence.entryDuration + sourceTime, clip.duration);
      let group;
      const findVisible = object => { if (!object.visible) return; if (object.name === 'Doreumi_portable_seating-surface') group = object; object.children.forEach(findVisible); };
      findVisible(f.props.root);
      assert.ok(group);
      let cushion;
      group.traverse(object => { if (object instanceof THREE.Mesh && object.geometry.type === 'SphereGeometry') cushion = object; });
      assert.ok(cushion);
      const worldCenter = cushion.getWorldPosition(new THREE.Vector3());
      if (center) assert.ok(Math.hypot(worldCenter.x - center.x, worldCenter.z - center.z) < 1e-8, 'the seat follows the standing body');
      center = worldCenter;
      for (const contact of state.contacts.filter(contact => contact.target === 'butt-skin')) {
        const skin = new THREE.Vector3(...contact.targetPoint);
        const hit = new THREE.Raycaster(skin.clone().add(new THREE.Vector3(0, .1, 0)), new THREE.Vector3(0, -1, 0)).intersectObject(cushion)[0];
        assert.ok(hit, 'the real cushion triangles must be directly below the butt skin');
        const gap = skin.y - hit.point.y;
        assert.ok(gap >= 0 && gap < .0214, `butt-to-cushion triangle gap: ${JSON.stringify({id,sourceTime,gap,skin:skin.toArray(),hit:hit.point.toArray(),center:cushion.position.toArray(),scale:cushion.scale.toArray()})}`);
        maximumGap = Math.max(maximumGap, gap); contactSamples++;
      }
      if (id === 354 || sourceTime < .01 || sourceTime > 3.7) assert.ok(state.contacts.some(contact => contact.target === 'butt-skin'), `${id}@${sourceTime} has no seat contact`);
      if (id === 299 && sourceTime > 1 && sourceTime < 2.7) assert.equal(state.interactionPhase, 'ground');
      const inverse = cushion.matrixWorld.clone().invert();
      for (const { object } of f.skinned) for (let vertex = 0; vertex < object.geometry.attributes.position.count; vertex++) {
        const point = object.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
        const t=Math.max(0,Math.min(1,(-point.z+.2)/1.2)),width=.25+.75*t*t*(3-2*t);
        const radiusSquared=(point.x/width)**2+point.y**2+point.z**2;
        if(radiusSquared<minimumSkinRadiusSquared){minimumSkinRadiusSquared=radiusSquared;worst={id,sourceTime,vertex,point:point.toArray(),world:point.clone().applyMatrix4(cushion.matrixWorld).toArray()};}
        idMinimum=Math.min(idMinimum,radiusSquared);
      }
    }
    context.diagnostic(JSON.stringify({id,idMinimum}));
  }
  context.diagnostic(JSON.stringify({ contactSamples, maximumGap, minimumSkinRadiusSquared, worst }));
  assert.ok(contactSamples >= 15 && maximumGap < .0214);
  assert.ok(minimumSkinRadiusSquared >= 1, 'actual character skin enters the cushion ellipsoid');
  f.props.dispose();
});

test('torch flame bounds clear actual skin triangles and the left-hand probe touches the visible shaft', async context => {
  const f = await fixture(); let samples = 0, minimumFlameBoxGap = Infinity, flameTriangleIntersections = 0, maximumGripError = 0, shaftIntrusions = 0, intrusionY = [Infinity, -Infinity];
  for (const id of DOREUMI_CONTEXT_ACTIONS.torch) {
    const clip = select(f, id), frames = Math.ceil(clip.duration * 30);
    for (let frame = 0; frame <= frames; frame++) {
      const state = pose(f, clip.duration * frame / frames, clip.duration);
      if (!state.visible) continue;
      let group;
      const visit = object => { if (!object.visible) return; if (object.name === 'Doreumi_portable_torch') group = object; object.children.forEach(visit); };
      visit(f.props.root); assert.ok(group);
      let shaft;
      group.traverse(object => { if (object instanceof THREE.Mesh && object.geometry.type === 'CylinderGeometry' && object.geometry.parameters.radiusTop === .022) shaft = object; });
      assert.ok(shaft);
      const body = shaft.parent, inverse = body.matrixWorld.clone().invert(), contact = state.contacts.find(value => value.target === 'palmL-skin');
      const flame = group.getObjectByName('Doreumi_torch_flame'), flameBounds = new THREE.Box3();
      assert.ok(flame);
      flame.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const positions = object.geometry.getAttribute('position');
        for (let vertex = 0; vertex < positions.count; vertex++) flameBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld).applyMatrix4(inverse));
      });
      assert.ok(flameBounds.max.y - flameBounds.min.y >= .369, 'the pointed flame must remain visible without lengthening the handle');
      assert.ok(contact);
      const grip = new THREE.Vector3(...contact.targetPoint).applyMatrix4(inverse);
      const error = Math.abs(Math.hypot(grip.x, grip.z) - .022); maximumGripError = Math.max(maximumGripError, error);
      assert.ok(error < 1e-6 && grip.y >= -.04 && grip.y <= .22);
      for (const { object } of f.skinned) {
        const skinIndex = object.geometry.getAttribute('skinIndex'), skinWeight = object.geometry.getAttribute('skinWeight');
        const localSkin = new Float64Array(object.geometry.attributes.position.count * 3);
        for (let vertex = 0; vertex < object.geometry.attributes.position.count; vertex++) {
          const p = object.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
          p.toArray(localSkin, vertex * 3);
          minimumFlameBoxGap = Math.min(minimumFlameBoxGap, flameBounds.distanceToPoint(p));
          if (p.y > -.04 && p.y < .22 && Math.hypot(p.x, p.z) < .019) {
            let gripWeight = 0;
            for (let component = 0; component < 4; component++) if (object.skeleton.bones[skinIndex.getComponent(vertex, component)].name === 'wristL') gripWeight += skinWeight.getComponent(vertex, component);
            if (gripWeight < .55) { shaftIntrusions++; intrusionY[0] = Math.min(intrusionY[0], p.y); intrusionY[1] = Math.max(intrusionY[1], p.y); }
          }
        }
        // All flame triangles are inside this box. Reject intersection by any
        // actual skinned triangle, including a face whose vertices stay outside.
        const indices = object.geometry.index?.array, triangle = new THREE.Triangle();
        const count = indices?.length ?? object.geometry.attributes.position.count;
        for (let index = 0; index < count; index += 3) {
          triangle.a.fromArray(localSkin, (indices?.[index] ?? index) * 3);
          triangle.b.fromArray(localSkin, (indices?.[index + 1] ?? index + 1) * 3);
          triangle.c.fromArray(localSkin, (indices?.[index + 2] ?? index + 2) * 3);
          if (flameBounds.intersectsTriangle(triangle)) flameTriangleIntersections++;
        }
      }
      samples++;
    }
  }
  context.diagnostic(JSON.stringify({samples,minimumFlameBoxGap,flameTriangleIntersections,maximumGripError,shaftIntrusions,intrusionY}));
  assert.ok(minimumFlameBoxGap > .005, 'a torch flame enters the character skin');
  assert.equal(flameTriangleIntersections, 0, 'the flame bounding volume crosses a character skin triangle');
  assert.equal(shaftIntrusions, 0, 'the shaft crosses the body outside the holding hand');
  f.props.dispose();
});

test('pickup parcel stays on the floor until the real hand reaches it and then follows the same hand', async () => {
  const f = await fixture(), clip = select(f, 284);
  const a = pose(f, 1, clip.duration), b = pose(f, 3, clip.duration);
  assert.equal(a.interactionPhase, 'ground'); assert.equal(b.interactionPhase, 'ground');
  assert.deepEqual(a.bounds, b.bounds, 'the parcel must not chase the approaching hand');
  assert.ok(Math.abs(a.floorClearance) < .003); assert.equal(a.contacts.length, 0);
  const before = pose(f, 4.1 - 1e-5, clip.duration), after = pose(f, 4.1 + 1e-5, clip.duration);
  assert.equal(after.interactionPhase, 'held'); assert.equal(after.contacts.length, 1);
  const beforeCenter = new THREE.Vector3(...before.bounds.min).add(new THREE.Vector3(...before.bounds.max)).multiplyScalar(.5);
  const afterCenter = new THREE.Vector3(...after.bounds.min).add(new THREE.Vector3(...after.bounds.max)).multiplyScalar(.5);
  assert.ok(beforeCenter.distanceTo(afterCenter) < .0214, 'pickup must not teleport at attachment');
  const lifted = pose(f, 5.8, clip.duration); assert.ok(lifted.floorClearance > .1);
  f.props.dispose();
});

test('drinking uses the actual mouth skin and the seated cushion supports the actual butt surface', async context => {
  const f = await fixture(), mesh = f.skinned[0].object;
  const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight'), buttVertices = [];
  for (let index = 0; index < positions.count; index++) {
    let bodyWeight = 0;
    for (let component = 0; component < 4; component++) if (mesh.skeleton.bones[indices.getComponent(index, component)]?.name === 'body') bodyWeight += weights.getComponent(index, component);
    if (bodyWeight > .6 && Math.abs(positions.getX(index)) < .14 && positions.getY(index) < -.62 && positions.getZ(index) < .1) buttVertices.push(index);
  }
  let mouthSamples = 0, maximumMouthGap = 0, maximumButtGap = 0, minimumThickness = Infinity;
  for (const id of [342, 343]) {
    const clip = select(f, id), evidence = manifest.motions.find(item => item.actionId === id).retargetEvidence;
    let seat;
    if (id === 343) f.props.root.traverse(object => { if (object instanceof THREE.Mesh && Math.abs(object.scale.x - .48) < 1e-8 && Math.abs(object.scale.z - .42) < 1e-8) seat = object; });
    for (let frame = 0; frame <= 120; frame++) {
      const time = evidence.entryDuration + evidence.sourceDuration * frame / 120, state = pose(f, time, clip.duration);
      for (const contact of state.contacts.filter(contact => contact.target === 'mouth')) { mouthSamples++; maximumMouthGap = Math.max(maximumMouthGap, contact.distance); }
      if (!seat) continue;
      const butt = buttVertices.map(index => mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3()))).reduce((lowest, point) => point.y < lowest.y ? point : lowest);
      const hit = new THREE.Raycaster(butt.clone().add(new THREE.Vector3(0, .1, 0)), new THREE.Vector3(0, -1, 0)).intersectObject(seat)[0];
      assert.ok(hit, 'the actual butt must be over the visible cushion');
      const gap = butt.y - hit.point.y;
      assert.ok(gap >= -.002, `cushion penetrates the butt: ${gap}`);
      maximumButtGap = Math.max(maximumButtGap, gap); minimumThickness = Math.min(minimumThickness, seat.scale.y * 2);
    }
  }
  assert.ok(mouthSamples > 40, 'mouth contact must be measured throughout both original sip phases');
  assert.ok(maximumMouthGap < .0214, `cup rim misses the mouth: ${maximumMouthGap}`);
  assert.ok(maximumButtGap < .0214, `cushion leaves the butt floating: ${maximumButtGap}`);
  assert.ok(minimumThickness > .15, `seated cushion must have visible supporting thickness: ${minimumThickness}`);
  context.diagnostic(JSON.stringify({ mouthSamples, maximumMouthGap, buttVertices: buttVertices.length, maximumButtGap, minimumThickness }));
  f.props.dispose();
});

test('holder yaw preserves contacts, unsupported contexts stay absent, and disposal releases only prop resources', async () => {
  const f = await fixture(), clip = select(f, 552); f.holder.rotation.y = Math.PI * .73;
  const state = pose(f, clip.duration / 2, clip.duration);
  assert.equal(state.contacts.length, 2); assert.ok(state.contacts.every(contact => contact.distance < 1e-7));
  f.props.setMotion({ sourceActionId: 101, props: ['weapon'] });
  assert.equal(f.props.inspect().visible, false); assert.equal(f.props.inspect().supported, false);
  const geometries = new Set(); let disposedProps = 0, disposedModel = 0;
  f.props.root.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
  geometries.forEach(geometry => geometry.addEventListener('dispose', () => disposedProps++));
  f.skinned.forEach(({ object }) => object.geometry.addEventListener('dispose', () => disposedModel++));
  f.props.dispose(); f.props.dispose();
  assert.equal(f.props.root.parent, null); assert.equal(disposedProps, geometries.size); assert.equal(disposedModel, 0);
});
