import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnimationClip, Bone, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';
import { DoreumiMotion } from '../src/lib/doreumi/motion.ts';
import { createSkinProbeReader } from '../src/lib/doreumi/motion-skin-probes.ts';

test('cached bone products preserve actual skin points across chair poses and changing morph/holder transforms', async () => {
  const { scene, clips, skinned } = await loadDoreumiAsset('public/doreumi/doreumi-master.glb');
  const holder = new Group(); holder.add(scene);
  const motion = new DoreumiMotion(scene, clips), meshes = skinned.map(item => item.object);
  const reader = createSkinProbeReader(meshes), expected = new Vector3(), actual = new Vector3();
  let checked = 0;
  for (const id of [272, 32, 33, 364]) {
    const clip = AnimationClip.parse(JSON.parse(fs.readFileSync(`public/doreumi/motions/meshy-${id}.json`)));
    motion.registerClip(clip);
    for (const fraction of [0, .05, .2, .5, .8, .95, 1]) {
      motion.seek(clip.name, clip.duration * fraction);
      holder.rotation.y = fraction * 1.1; holder.scale.setScalar(.8 + fraction * .3);
      holder.position.set(fraction * .2, -.1, .3);
      holder.updateMatrixWorld(true); reader.refresh();
      for (const mesh of meshes) {
        for (let index = 0; index < mesh.geometry.attributes.position.count; index += fraction === 0 ? 1 : 37) {
          mesh.getVertexPosition(index, expected); reader.read(mesh, index, actual);
          assert.deepEqual(actual.toArray(), expected.toArray(), `${id}/${fraction}/${index}`); checked++;
        }
        if (mesh.morphTargetInfluences?.length) {
          const original = mesh.morphTargetInfluences[0]; mesh.morphTargetInfluences[0] = fraction;
          mesh.getVertexPosition(400, expected); reader.read(mesh, 400, actual);
          assert.deepEqual(actual.toArray(), expected.toArray(), 'Morph changes must not reuse a frozen rest point');
          mesh.morphTargetInfluences[0] = original;
        }
      }
    }
  }
  assert.ok(checked > 350000);
  const fallback = createSkinProbeReader([]);
  meshes[0].getVertexPosition(0, expected); fallback.read(meshes[0], 0, actual);
  assert.deepEqual(actual.toArray(), expected.toArray());
  motion.dispose();
});

test('skin readers isolate instances while keeping shared-skeleton bind and vertex data live', () => {
  const create = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([.2, .3, .4], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 1, 0, 0], 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([.4, .6, 0, 0], 4));
    const bones = [new Bone(), new Bone()];
    const skeleton = new Skeleton(bones, [new Matrix4(), new Matrix4()]);
    const mesh = new SkinnedMesh(geometry); mesh.skeleton = skeleton;
    return { mesh, bones, skeleton };
  };
  const a = create(), b = create();
  const shared = new SkinnedMesh(a.mesh.geometry.clone()); shared.skeleton = a.skeleton;
  shared.bindMatrix.makeTranslation(.3, -.2, .1); shared.bindMatrixInverse.copy(shared.bindMatrix).invert();
  const first = createSkinProbeReader([a.mesh, shared]), second = createSkinProbeReader([b.mesh]);
  const compare = (reader, mesh) => {
    const expected = mesh.getVertexPosition(0, new Vector3()), actual = reader.read(mesh, 0, new Vector3());
    assert.deepEqual(actual.toArray(), expected.toArray());
  };
  for (let index = 0; index < 4; index++) {
    a.bones[0].position.x = index * .13; a.bones[1].rotation.z = index * .2;
    b.bones[0].position.y = -index * .27; b.bones[1].rotation.x = -index * .4;
    [...a.bones, ...b.bones].forEach(bone => bone.updateMatrixWorld(true));
    first.refresh(); second.refresh();
    compare(first, a.mesh); compare(second, b.mesh); compare(first, shared);
    // These values do not require a new skeleton pose. A refresh-only vertex
    // cache would miss each change, while caching only bone products is exact.
    shared.bindMatrix.makeTranslation(index * .2, .1, -.2); shared.bindMatrixInverse.copy(shared.bindMatrix).invert();
    shared.geometry.attributes.position.setXYZ(0, .5, index * .17, -.3);
    shared.geometry.attributes.skinWeight.setXYZW(0, .8, .2, 0, 0);
    compare(first, shared); compare(second, b.mesh); compare(first, a.mesh);
  }
  a.mesh.geometry.dispose(); b.mesh.geometry.dispose(); shared.geometry.dispose();
  a.mesh.material.dispose(); b.mesh.material.dispose(); shared.material.dispose();
});
