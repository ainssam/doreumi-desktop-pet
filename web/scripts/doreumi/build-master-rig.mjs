/** Builds the neutral-preserving master and clips offline, with the same rig
 * constructor used by the renderer. The pinned original GLB is read-only. */
import assert from 'node:assert/strict';
import { writeFile, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { Bone, PropertyBinding } from 'three';
import { articulateDoreumiRig, doreumiRigData } from '../../src/lib/doreumi/motion-rig.ts';
import { prepareDoreumiClips } from '../../src/lib/doreumi/motion.ts';
import { DOREUMI_GAIT } from '../../src/lib/doreumi/motion-gait.ts';
import { loadDoreumiAsset } from './rig-utils.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'public/doreumi/doreumi.glb', output = 'public/doreumi/doreumi-master.glb';
const { document, scene, clips, skinned, nodes } = await loadDoreumiAsset(source);
const protectedAttributes = document.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives().flatMap(p => [
  ...['POSITION', 'NORMAL', 'TEXCOORD_0'].map(name => [name, sha(p.getAttribute(name).getArray())]),
  ...p.listTargets().flatMap((t, i) => t.listSemantics().map(name => [`morph:${i}:${name}`, sha(t.getAttribute(name).getArray())])),
]));
const textures = document.getRoot().listTextures().map(t => sha(t.getImage()));
const inspection = articulateDoreumiRig(scene); assert.ok(inspection.maxRestError < 1e-6);
const rig = doreumiRigData(scene), neutralRoot = clips.find(c => c.name === 'Idle').tracks.find(t => t.name === 'DoreumiRig.position').values[1];
const boneRows = []; scene.updateMatrixWorld(true);
scene.traverse(object => { if (object instanceof Bone || object.name === 'DoreumiRig') boneRows.push({ name: object.name, parent: object.parent?.name ?? null, restLocalPosition: object.position.toArray(), restLocalQuaternion: object.quaternion.toArray(), restLocalScale: object.scale.toArray(), restWorldMatrix: object.matrixWorld.toArray() }); });
const signature = sha(JSON.stringify(boneRows));
const contract = { version: 3, rigSignature: signature, sourceHash: sha(await readFile(source)), height: 2.14, runtimeRootTranslation: [0, neutralRoot, 0], forward: '+Z', up: '+Y', bones: boneRows, gait: DOREUMI_GAIT, sockets: { lap: { parent: 'body', position: [0, .17, .265] }, palmL: { parent: 'wristL', position: [.028, -.035, .02] }, palmR: { parent: 'wristR', position: [-.028, -.035, .02] } }, inspection };
const prepared = prepareDoreumiClips(clips, true, scene);
const byName = new Map(nodes.map(node => [PropertyBinding.sanitizeNodeName(node.getName()), node]));
const objectsByName = new Map(); scene.traverse(o => objectsByName.set(o.name, o));
for (const [name, object] of objectsByName) {
  if (!name || object.isSkinnedMesh) continue;
  let node = byName.get(name); if (!node) { node = document.createNode(name); byName.set(name, node); }
  node.setName(name).setTranslation(object.position.toArray()).setRotation(object.quaternion.toArray()).setScale(object.scale.toArray());
}
for (const [name, object] of objectsByName) {
  const node = byName.get(name), parent = byName.get(object.parent?.name); if (!node || !parent || object.isSkinnedMesh) continue;
  const old = node.getParentNode(); if (old && old !== parent) old.removeChild(node); if (node.getParentNode() !== parent) parent.addChild(node);
}
const buffer = document.getRoot().listBuffers()[0];
for (const { node, object } of skinned) {
  const skin = node.getSkin(); for (const joint of skin.listJoints()) skin.removeJoint(joint);
  for (const bone of object.skeleton.bones) skin.addJoint(byName.get(bone.name));
  skin.getInverseBindMatrices().setArray(new Float32Array(object.skeleton.boneInverses.flatMap(m => m.toArray())));
  const primitive = node.getMesh().listPrimitives()[0];
  for (const [semantic, name] of [['JOINTS_0', 'skinIndex'], ['WEIGHTS_0', 'skinWeight']]) primitive.getAttribute(semantic).setArray(object.geometry.getAttribute(name).array);
}
for (const animation of document.getRoot().listAnimations()) animation.dispose();
for (const clip of prepared) {
  const animation = document.createAnimation(clip.name);
  for (const track of clip.tracks) {
    const split = track.name.lastIndexOf('.'), target = byName.get(track.name.slice(0, split)), path = { position: 'translation', quaternion: 'rotation', scale: 'scale' }[track.name.slice(split + 1)];
    assert.ok(target && path);
    const input = document.createAccessor().setType('SCALAR').setArray(track.times).setBuffer(buffer), output = document.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(track.values).setBuffer(buffer);
    const sampler = document.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler));
  }
}
const targetScene = document.getRoot().listScenes()[0]; targetScene.setExtras({ ...targetScene.getExtras(), doreumiMasterRig: rig, doreumiClipsVersion: 3, doreumiRigSignature: signature });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const bytes = await io.writeBinary(document), decoded = await io.readBinary(bytes);
const attributesAfter = decoded.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives().flatMap(p => [
  ...['POSITION', 'NORMAL', 'TEXCOORD_0'].map(name => [name, sha(p.getAttribute(name).getArray())]),
  ...p.listTargets().flatMap((t, i) => t.listSemantics().map(name => [`morph:${i}:${name}`, sha(t.getAttribute(name).getArray())])),
]));
assert.deepEqual(attributesAfter, protectedAttributes, 'Master must preserve exact source geometry, UV and neutral morph');
assert.deepEqual(decoded.getRoot().listTextures().map(t => sha(t.getImage())), textures, 'Master must preserve embedded texture bytes');
await writeFile(`${output}.tmp`, bytes); await rename(`${output}.tmp`, output);
await writeFile('public/doreumi/rig-contract.json.tmp', JSON.stringify(contract, null, 2) + '\n');
await rename('public/doreumi/rig-contract.json.tmp', 'public/doreumi/rig-contract.json');
console.log(JSON.stringify({ output, bytes: bytes.length, actions: prepared.length, rigSignature: signature, ...inspection }));
