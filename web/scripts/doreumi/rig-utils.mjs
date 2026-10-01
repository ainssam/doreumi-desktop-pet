import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';

export async function loadDoreumiAsset(path = 'public/doreumi/doreumi.glb') {
const glb = await readFile(path);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.readBinary(glb);
const nodes = document.getRoot().listNodes();
const joints = new Set(document.getRoot().listSkins().flatMap(skin => skin.listJoints()));
const objects = new Map(nodes.map(node => [node, joints.has(node) ? new THREE.Bone() : new THREE.Group()]));
const skinned = [];
for (const node of nodes) {
  let object = objects.get(node);
  const primitive = node.getMesh()?.listPrimitives()[0];
  if (primitive) {
    const geometry = new THREE.BufferGeometry();
    const map = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' };
    for (const [semantic, attribute] of Object.entries(map)) {
      const accessor = primitive.getAttribute(semantic);
      if (accessor) geometry.setAttribute(attribute, new THREE.BufferAttribute(accessor.getArray(), accessor.getElementSize(), accessor.getNormalized()));
    }
    geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray(), 1));
    for (const target of primitive.listTargets()) for (const semantic of ['POSITION', 'NORMAL']) {
      const accessor = target.getAttribute(semantic); if (!accessor) continue;
      (geometry.morphAttributes[semantic.toLowerCase()] ??= []).push(new THREE.BufferAttribute(accessor.getArray(), 3));
    }
    geometry.morphTargetsRelative = true;
    object = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    object.morphTargetInfluences[0] = 1;
    objects.set(node, object); skinned.push({ node, object });
  }
  object.name = THREE.PropertyBinding.sanitizeNodeName(node.getName());
  object.userData = { ...node.getExtras() };
  object.position.fromArray(node.getTranslation()); object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale());
}
const scene = new THREE.Group();
scene.userData = { ...document.getRoot().listScenes()[0].getExtras() };
for (const node of nodes) for (const child of node.listChildren()) objects.get(node).add(objects.get(child));
for (const node of document.getRoot().listScenes()[0].listChildren()) scene.add(objects.get(node));
scene.updateMatrixWorld(true);
for (const { node, object } of skinned) {
  const skin = node.getSkin(), matrices = skin.getInverseBindMatrices().getArray();
  const bones = skin.listJoints().map(joint => objects.get(joint));
  object.bind(new THREE.Skeleton(bones, bones.map((_, i) => new THREE.Matrix4().fromArray(matrices, i * 16))), new THREE.Matrix4());
}
const clips = document.getRoot().listAnimations().map(animation => new THREE.AnimationClip(animation.getName(), -1, animation.listChannels().map(channel => {
  const sampler = channel.getSampler(), target = channel.getTargetNode();
  const property = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[channel.getTargetPath()];
  assert.ok(property, 'Unexpected animated property');
  const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
  return new Track(`${objects.get(target).name}.${property}`, sampler.getInput().getArray(), sampler.getOutput().getArray());
})));

return { document, scene, clips, skinned, nodes, objects };
}
