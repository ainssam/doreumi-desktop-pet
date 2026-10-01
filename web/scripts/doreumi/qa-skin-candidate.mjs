/** Isolated visual previews may change weights only, with decoded proof against
 * the current public master. This never authorizes a registry or asset write. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const accessor = value => value ? { type: value.getType(), componentType: value.getComponentType(), normalized: value.getNormalized(), count: value.getCount(), sha256: sha(value.getArray()) } : null;
function protectedExtensions(bytes) {
  // An unregistered optional extension is discarded by NodeIO, but Three may
  // still render it. Compare raw declarations and payloads before decoding.
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(data.byteLength >= 20 && data.getUint32(0, true) === 0x46546c67 && data.getUint32(4, true) === 2
    && data.getUint32(8, true) === data.byteLength && data.getUint32(16, true) === 0x4e4f534a, 'Skin candidate requires a valid binary glTF');
  const jsonLength = data.getUint32(12, true);
  assert(20 + jsonLength <= data.byteLength, 'Skin candidate binary glTF JSON is truncated');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const payloads = [];
  function visit(value, pointer) {
    if (!value || typeof value !== 'object') return;
    for (const [name, payload] of Object.entries(value.extensions ?? {})) {
      // Compressed buffer offsets and byte lengths change when weights are
      // re-encoded. Their decoded accessor semantics are protected separately.
      if (name === 'EXT_meshopt_compression' && /^\/bufferViews\/\d+$/.test(pointer)) continue;
      payloads.push({ pointer, name, payload });
    }
    for (const [key, child] of Object.entries(value)) if (key !== 'extensions') visit(child, `${pointer}/${key}`);
  }
  visit(json, '');
  return { used: [...(json.extensionsUsed ?? [])].sort(), required: [...(json.extensionsRequired ?? [])].sort(), payloads };
}
function vertexCount(document) {
  const primitives = document.getRoot().listNodes().filter(node => node.getSkin() && node.getMesh()).flatMap(node => node.getMesh().listPrimitives());
  assert(primitives.length === 1, 'Skin candidate contact vertex namespace requires one actual skinned primitive');
  const count = primitives[0].getAttribute('POSITION')?.getCount();
  assert(Number.isSafeInteger(count) && count > 0, 'Skin candidate vertex count is invalid');
  return count;
}
function protectedModel(document, json) {
  const root = document.getRoot(), nodes = root.listNodes(), meshes = root.listMeshes(), skins = root.listSkins(), materials = root.listMaterials();
  return {
    meshes: meshes.map(mesh => ({ name: mesh.getName(), weights: mesh.getWeights(), extras: mesh.getExtras(), primitives: mesh.listPrimitives().map(primitive => ({
      mode: primitive.getMode(), material: materials.indexOf(primitive.getMaterial()), extras: primitive.getExtras(), indices: accessor(primitive.getIndices()),
      attributes: Object.fromEntries(primitive.listSemantics().filter(name => !['JOINTS_0', 'WEIGHTS_0'].includes(name)).sort().map(name => [name, accessor(primitive.getAttribute(name))])),
      skinLayout: Object.fromEntries(['JOINTS_0', 'WEIGHTS_0'].map(name => {
        const { sha256, ...layout } = accessor(primitive.getAttribute(name)) ?? {};
        return [name, layout];
      })),
      morphs: primitive.listTargets().map(target => Object.fromEntries(target.listSemantics().sort().map(name => [name, accessor(target.getAttribute(name))]))),
    })) })),
    nodes: nodes.map(node => ({ name: node.getName(), position: node.getTranslation(), quaternion: node.getRotation(), scale: node.getScale(), weights: node.getWeights(),
      mesh: meshes.indexOf(node.getMesh()), skin: skins.indexOf(node.getSkin()), children: node.listChildren().map(child => nodes.indexOf(child)), extras: node.getExtras() })),
    skins: skins.map(skin => ({ name: skin.getName(), skeleton: nodes.indexOf(skin.getSkeleton()), joints: skin.listJoints().map(joint => nodes.indexOf(joint)), inverse: accessor(skin.getInverseBindMatrices()), extras: skin.getExtras() })),
    animations: root.listAnimations().map(animation => ({ name: animation.getName(), extras: animation.getExtras(), channels: animation.listChannels().map(channel => ({
      node: nodes.indexOf(channel.getTargetNode()), path: channel.getTargetPath(), interpolation: channel.getSampler().getInterpolation(), input: accessor(channel.getSampler().getInput()), output: accessor(channel.getSampler().getOutput()),
    })) })),
    scenes: root.listScenes().map(scene => { const { doreumiSkinCandidate, ...extras } = scene.getExtras(); return { name: scene.getName(), children: scene.listChildren().map(child => nodes.indexOf(child)), extras }; }),
    textures: root.listTextures().map(texture => ({ name: texture.getName(), mimeType: texture.getMimeType(), extras: texture.getExtras(), sha256: sha(texture.getImage()) })),
    materials: json.materials, textureBindings: json.textures, samplers: json.samplers,
  };
}
function neutralSurface(document) {
  const surfaces = [], point = new Vector3(), result = new Vector3(), transformed = new Vector3();
  for (const node of document.getRoot().listNodes()) {
    const skin = node.getSkin(); if (!skin || !node.getMesh()) continue;
    const matrices = skin.listJoints().map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices().getArray(), index * 16)));
    const meshWorld = new Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh().listPrimitives()) {
      const position = primitive.getAttribute('POSITION'), joints = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
      assert(joints && weights && joints.getCount() === position.getCount() && weights.getCount() === position.getCount(), 'Candidate skin attribute counts changed');
      assert(joints.getElementSize() === 4 && weights.getElementSize() === 4, 'Candidate skin must have four normalized influences');
      const positions = position.getArray(), jointValues = joints.getArray(), weightValues = weights.getArray(), values = new Float64Array(position.getCount() * 3);
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        point.fromArray(positions, vertex * 3);
        // Production master keeps its original neutral facial morph at weight1.
        for (const target of primitive.listTargets()) { const morph = target.getAttribute('POSITION'); if (morph) point.add(transformed.fromArray(morph.getArray(), vertex * 3)); }
        result.set(0, 0, 0); let total = 0;
        for (let component = 0; component < 4; component++) {
          const joint = jointValues[vertex * 4 + component], weight = weightValues[vertex * 4 + component];
          assert(Number.isInteger(joint) && joint >= 0 && joint < matrices.length && Number.isFinite(weight) && weight >= 0 && weight <= 1, 'Candidate skin contains invalid influences');
          total += weight; result.addScaledVector(transformed.copy(point).applyMatrix4(matrices[joint]), weight);
        }
        assert(Math.abs(total - 1) < 1e-6, 'Candidate skin weights must be normalized');
        result.applyMatrix4(meshWorld).toArray(values, vertex * 3);
      }
      surfaces.push(values);
    }
  }
  assert(surfaces.length > 0, 'Candidate must preserve a skinned master');
  return surfaces;
}
export async function validateSkinCandidateModel(parentBytes, candidateBytes, expected) {
  const parentSha256 = sha(parentBytes), candidateSha256 = sha(candidateBytes);
  assert(parentSha256 === expected.parentMasterSha256 && candidateSha256 === expected.masterSha256 && parentSha256 !== candidateSha256, 'Skin candidate parent/master SHA mismatch');
  assert.deepEqual(protectedExtensions(candidateBytes), protectedExtensions(parentBytes), 'Skin candidate changed protected glTF extensions');
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const parent = await io.readBinary(parentBytes), candidate = await io.readBinary(candidateBytes);
  const extras = candidate.getRoot().listScenes()[0]?.getExtras(), proof = extras?.doreumiSkinCandidate;
  assert(proof?.parentMasterSha256 === parentSha256 && extras?.doreumiRigSignature === expected.rigSignature, 'Skin candidate embedded provenance mismatch');
  const before = protectedModel(parent, (await io.writeJSON(parent)).json), after = protectedModel(candidate, (await io.writeJSON(candidate)).json);
  assert.deepEqual(after, before, 'Skin candidate changed protected geometry, UV, textures, materials, bones, morphs or animations');
  const a = neutralSurface(parent), b = neutralSurface(candidate); assert.equal(a.length, b.length);
  let maximumNeutralError = 0;
  for (let mesh = 0; mesh < a.length; mesh++) {
    assert.equal(a[mesh].length, b[mesh].length);
    for (let index = 0; index < a[mesh].length; index += 3) maximumNeutralError = Math.max(maximumNeutralError, Math.hypot(a[mesh][index] - b[mesh][index], a[mesh][index + 1] - b[mesh][index + 1], a[mesh][index + 2] - b[mesh][index + 2]));
  }
  assert(maximumNeutralError < 1e-6, 'Skin candidate changed the neutral surface');
  return { version: 1, parentMasterSha256: parentSha256, masterSha256: candidateSha256, protectedDecodedSha256: sha(JSON.stringify(before)), maximumNeutralError, targetVertexCount: vertexCount(candidate) };
}

export async function validateSkinCandidateSource(sourceBytes, sourceSha256) {
  assert(/^[a-f0-9]{64}$/.test(sourceSha256) && sha(sourceBytes) === sourceSha256, 'Skin candidate actual donor SHA mismatch');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return { sourceSha256, sourceVertexCount: vertexCount(await io.readBinary(sourceBytes)) };
}

/** The only current combined skin/clip previews are the two re-solved palm
 * adaptations. All source contacts remain explicit, including early release. */
export function validateSkinCandidateContact(imported, contact, clip, contract, vertexDomain) {
  const id = imported.actionId, evidence = imported.retargetEvidence, palm = contact.palmSupport;
  const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  assert([406, 451].includes(id) && evidence.acrobatics?.version === 1 && evidence.acrobatics.localTranslationsAndScalesPreserved === true,
    'Skin candidate contact adaptation is outside the measured scope');
  assert(contact.masterSha256 === evidence.masterSha256 && contact.fps === 120 && contact.runtimeRegistration === 'passed'
    && finite(contact.bounds?.minY, -.002, .01) && finite(contact.bounds?.maxY, .1, 10)
    && finite(contact.maximumBoneLengthError, 0, 1e-6) && finite(contract.height, .1, 10)
    && Object.keys(contact.joints ?? {}).length === contract.bones.length
    && contract.bones.every(bone => finite(contact.joints[bone.name]?.maximumLocal, 0, 180) && finite(contact.joints[bone.name]?.maximumWorld, 0, 180)),
  'Skin candidate requires a complete actual-skin and all-joint audit');
  assert(vertexDomain?.sourceSha256 === imported.sourceSha256 && contact.sourceSha256 === imported.sourceSha256
    && Number.isSafeInteger(vertexDomain.targetVertexCount) && vertexDomain.targetVertexCount > 0
    && Number.isSafeInteger(vertexDomain.sourceVertexCount) && vertexDomain.sourceVertexCount > 0
    && palm?.side === 'R' && palm.fps === 120 && Number.isSafeInteger(palm.targetVertex) && palm.targetVertex >= 0 && palm.targetVertex < vertexDomain.targetVertexCount
    && Number.isSafeInteger(palm.sourceVertex) && palm.sourceVertex >= 0 && palm.sourceVertex < vertexDomain.sourceVertexCount && Array.isArray(palm.sourceInterval) && palm.sourceInterval.length === 2
    && finite(palm.sourceInterval[0], 0, evidence.sourceDuration) && finite(palm.sourceInterval[1], palm.sourceInterval[0] + .001, evidence.sourceDuration)
    && Number.isSafeInteger(palm.samples) && palm.samples >= Math.ceil((palm.sourceInterval[1] - palm.sourceInterval[0]) * 120)
    && finite(palm.minimumPointY, -.001, .02) && finite(palm.maximumPointY, palm.minimumPointY, .02)
    && finite(palm.minimumSurfaceY, -.001, .02) && finite(palm.maximumSurfaceY, palm.minimumSurfaceY, .02)
    && finite(palm.maximumDeltaXZ, 0, contract.height * .01), 'Skin candidate palm material-point evidence is invalid');
  if (id === 406) {
    assert(evidence.acrobatics.sourceBodyAndLegRotationsPreserved === true && finite(contact.maximumPreservedBodyLegError, 0, .001)
      && palm.basis === 'fixed-material-point-source-scaled-early-palm-support'
      && finite(palm.maximumSourceScaledResidualXZ, 0, contract.height * .01)
      && finite(palm.originalSourceContactEnd, palm.sourceInterval[1], evidence.sourceDuration)
      && JSON.stringify(palm.sourceInterval) === JSON.stringify(evidence.acrobatics.palmPlanarSupport?.sourceInterval), 'Skin candidate flair source support differs');
  } else {
    const root = clip.tracks.find(track => track.name === 'DoreumiRig.position');
    assert(palm.basis === 'fixed-material-point-one-palm-and-hip-adaptation' && finite(palm.maximumTotalXZ, 0, contract.height * .01)
      && JSON.stringify(palm.sourceInterval) === JSON.stringify(evidence.acrobatics.handSupportSourceInterval)
      && root && root.values.every((value, index) => Number.isFinite(value) && (index % 3 === 1 || Math.abs(value) <= 1e-8)), 'Skin candidate seated palm support differs');
  }
}
