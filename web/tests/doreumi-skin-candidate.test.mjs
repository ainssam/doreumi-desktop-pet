import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { validateSkinCandidateModel, validateSkinCandidateSource, validateSkinCandidateContact } from '../scripts/doreumi/qa-skin-candidate.mjs';
const parent = fs.readFileSync(new URL('../public/doreumi/doreumi-master.glb', import.meta.url));
const contract = JSON.parse(fs.readFileSync(new URL('../public/doreumi/rig-contract.json', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
async function candidate(change) {
  const document = await io.readBinary(parent), scene = document.getRoot().listScenes()[0];
  scene.setExtras({ ...scene.getExtras(), doreumiSkinCandidate: { parentMasterSha256: sha(parent), method: 'test-weight-preview' } });
  change?.(document); return io.writeBinary(document);
}
const expected = bytes => ({ parentMasterSha256: sha(parent), masterSha256: sha(bytes), rigSignature: contract.rigSignature });
function editRawJSON(bytes, change) {
  const input = Buffer.from(bytes), length = input.readUInt32LE(12), json = JSON.parse(input.subarray(20, 20 + length).toString());
  change(json);
  const encoded = Buffer.from(JSON.stringify(json)), padding = (4 - encoded.length % 4) % 4;
  const body = Buffer.concat([encoded, Buffer.alloc(padding, 32)]), header = Buffer.from(input.subarray(0, 20)), remainder = input.subarray(20 + length);
  header.writeUInt32LE(20 + body.length + remainder.length, 8); header.writeUInt32LE(body.length, 12);
  return Buffer.concat([header, body, remainder]);
}
test('decoded candidate proof preserves the actual master, all 26 clips and neutral shape', async () => {
  const bytes = await candidate(), proof = await validateSkinCandidateModel(parent, bytes, expected(bytes));
  assert.equal(proof.parentMasterSha256, sha(parent)); assert.equal(proof.maximumNeutralError, 0);
  assert.match(proof.protectedDecodedSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(validateSkinCandidateModel(parent, bytes, { ...expected(bytes), parentMasterSha256: 'a'.repeat(64) }), /parent\/master SHA/);
  await assert.rejects(validateSkinCandidateModel(parent, bytes, { ...expected(bytes), rigSignature: 'another-rig' }), /embedded provenance/);
});
test('new master preview rejects geometry, UV, morph, texture, material, bone and animation edits', async () => {
  for (const change of [
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getArray()[0] += .001; },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_0').getArray()[0] += .001; },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].listTargets()[0].getAttribute('POSITION').getArray()[0] += .001; },
    doc => { const texture = doc.getRoot().listTextures()[0], image = texture.getImage().slice(); image[image.length - 1] ^= 1; texture.setImage(image); },
    doc => { doc.getRoot().listMaterials()[0].setDoubleSided(false); },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('JOINTS_0').setNormalized(true); },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('WEIGHTS_0').setNormalized(true); },
    doc => { const bone = doc.getRoot().listSkins()[0].listJoints()[1], position = bone.getTranslation(); position[0] += .001; bone.setTranslation(position); },
    doc => { doc.getRoot().listAnimations()[0].listChannels()[0].getSampler().getOutput().getArray()[0] += .001; },
  ]) { const bytes = await candidate(change); await assert.rejects(validateSkinCandidateModel(parent, bytes, expected(bytes)), /protected geometry/); }
});
test('candidate weights cannot become negative, unnormalized or point outside the skeleton', async () => {
  for (const change of [
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('WEIGHTS_0').getArray()[0] = -.1; },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('WEIGHTS_0').getArray()[0] = .5; },
    doc => { doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('JOINTS_0').getArray()[0] = 65535; },
  ]) { const bytes = await candidate(change); await assert.rejects(validateSkinCandidateModel(parent, bytes, expected(bytes)), /skin contains invalid|weights must be normalized/); }
});
test('raw optional or undeclared extensions cannot bypass the decoded protection', async () => {
  const bytes = await candidate();
  for (const change of [
    json => { json.extensionsUsed.push('KHR_materials_unlit'); json.materials[0].extensions = { KHR_materials_unlit: {} }; },
    json => { json.materials[0].extensions = { KHR_materials_unlit: {} }; },
    json => { json.nodes[0].extensions = { EXT_meshopt_compression: { enabled: true } }; },
  ]) {
    const modified = editRawJSON(bytes, change);
    await assert.rejects(validateSkinCandidateModel(parent, modified, expected(modified)), /protected glTF extensions/);
  }
});
test('an already declared extension keeps its exact raw payload', async () => {
  const addExtension = json => {
    json.extensionsUsed.push('KHR_materials_emissive_strength');
    json.materials[0].extensions = { KHR_materials_emissive_strength: { emissiveStrength: 1 } };
  };
  const withExtension = editRawJSON(parent, addExtension);
  const bytes = editRawJSON(await candidate(), json => {
    addExtension(json); json.scenes[0].extras.doreumiSkinCandidate.parentMasterSha256 = sha(withExtension);
  });
  const input = value => ({ ...expected(value), parentMasterSha256: sha(withExtension) });
  await validateSkinCandidateModel(withExtension, bytes, input(bytes));
  const modified = editRawJSON(bytes, json => { json.materials[0].extensions.KHR_materials_emissive_strength.emissiveStrength = 2; });
  await assert.rejects(validateSkinCandidateModel(withExtension, modified, input(modified)), /protected glTF extensions/);
});
function measuredPalm() {
  const imported = { actionId: 451, sourceSha256: 'a'.repeat(64), retargetEvidence: { masterSha256: 'master', sourceDuration: 3, acrobatics: { version: 1, localTranslationsAndScalesPreserved: true, handSupportSourceInterval: [1, 2] } } };
  const clip = { tracks: [{ name: 'DoreumiRig.position', values: [0, 0, 0, 0, .5, 0] }] };
  const contact = { masterSha256: 'master', sourceSha256: imported.sourceSha256, fps: 120, runtimeRegistration: 'passed', bounds: { minY: .002, maxY: 2 }, maximumBoneLengthError: 0,
    joints: Object.fromEntries(contract.bones.map(bone => [bone.name, { maximumLocal: 5, maximumWorld: 7 }])),
    palmSupport: { side: 'R', fps: 120, targetVertex: 1, sourceVertex: 2, sourceInterval: [1, 2], samples: 121,
      minimumPointY: .003, maximumPointY: .004, minimumSurfaceY: .003, maximumSurfaceY: .004,
      maximumDeltaXZ: .001, maximumTotalXZ: .002, basis: 'fixed-material-point-one-palm-and-hip-adaptation' } };
  return { imported, contact, clip, domain: { sourceSha256: imported.sourceSha256, targetVertexCount: 10, sourceVertexCount: 20 } };
}
test('combined skin preview requires complete contact evidence at actual skin material points', () => {
  const valid = measuredPalm(); validateSkinCandidateContact(valid.imported, valid.contact, valid.clip, contract, valid.domain);
  for (const change of [
    data => { data.imported.actionId = 22; }, data => { data.contact.masterSha256 = 'stale'; },
    data => { data.contact.bounds.minY = -.1; }, data => { delete data.contact.joints.head; },
    data => { data.contact.palmSupport.samples = 2; }, data => { data.contact.palmSupport.sourceInterval = [2, 1]; },
    data => { data.contact.palmSupport.maximumTotalXZ = 1; }, data => { data.contact.palmSupport.maximumPointY = .5; },
    data => { data.clip.tracks[0].values[0] = .1; }, data => { data.contact.palmSupport.targetVertex = Number.MAX_SAFE_INTEGER; },
    data => { data.contact.palmSupport.sourceVertex = Number.MAX_SAFE_INTEGER; }, data => { delete data.contact.sourceSha256; },
  ]) { const data = measuredPalm(); change(data); assert.throws(() => validateSkinCandidateContact(data.imported, data.contact, data.clip, contract, data.domain)); }
});

test('actual decoded donor SHA binds the contact vertex namespace', async () => {
  const proof = await validateSkinCandidateSource(parent, sha(parent));
  assert.equal(proof.sourceSha256, sha(parent)); assert.equal(proof.sourceVertexCount, 78799);
  await assert.rejects(validateSkinCandidateSource(parent, 'a'.repeat(64)), /actual donor SHA/);
});
