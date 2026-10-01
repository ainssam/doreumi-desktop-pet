import test from 'node:test';
import assert from 'node:assert/strict';
import { checkItemGlb, checkPreviewWebp, imageSize } from '../src/lib/doreumi/itemFile.ts';

/** Builds a minimal GLB: one triangle mesh, optional extras merged into the JSON. */
function glb(json: Record<string, unknown>, bin = new Uint8Array(36)) {
  const base = { asset: { version: '2.0' }, buffers: [{ byteLength: bin.byteLength }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'hat', mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...json };
  let text = JSON.stringify(base); while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const out = new Uint8Array(12 + 8 + jsonBytes.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, jsonBytes.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20);
  v.setUint32(20 + jsonBytes.length, bin.length, true); v.setUint32(24 + jsonBytes.length, 0x004e4942, true); out.set(bin, 28 + jsonBytes.length);
  return out;
}
const rigid = { rigged: false, bone: 'headAccessory' };

test('a plain rigid item passes', () => assert.equal(checkItemGlb(glb({}), rigid).ok, true));
test('undeclared object-level extensions are refused', () => {
  const r = checkItemGlb(glb({ nodes: [{ name: 'hat', mesh: 0, extensions: { KHR_lights_punctual: { light: 0 } } }] }), rigid);
  assert.equal(r.ok, false);
});
test('allowed extensions must also be declared', () => {
  const materials = [{ extensions: { KHR_materials_unlit: {} } }];
  assert.equal(checkItemGlb(glb({ materials }), rigid).ok, false);
  assert.equal(checkItemGlb(glb({ materials, extensionsUsed: ['KHR_materials_unlit'] }), rigid).ok, true);
});
test('triangles are counted per instance', () => {
  const nodes = Array.from({ length: 150 }, (_, i) => ({ name: `n${i}`, mesh: 0 }));
  const accessors = [{ bufferView: 0, componentType: 5126, count: 900, type: 'VEC3' }];
  assert.equal(checkItemGlb(glb({ nodes, accessors }), rigid).ok, false, '150 x 300 triangles is over 40k');
});
test('morph targets are refused', () => {
  assert.equal(checkItemGlb(glb({ meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 0 }] }] }] }), rigid).ok, false);
});
test('rigid items cannot use Doreumi bone or attach names', () => {
  assert.equal(checkItemGlb(glb({ nodes: [{ name: 'headAccessory', mesh: 0 }] }), rigid).ok, false);
  assert.equal(checkItemGlb(glb({ nodes: [{ name: 'DoreumiRig', mesh: 0 }] }), rigid).ok, false);
  assert.equal(checkItemGlb(glb({ nodes: [{ name: 'DoreumiItem' }, { name: 'hat', mesh: 0 }] }), rigid).ok, true, 'the kit wrapper name is fine');
});
test('image headers give the size without decoding', () => {
  const png = new Uint8Array(33); const v = new DataView(png.buffer); v.setUint32(0, 0x89504e47); v.setUint32(16, 4096); v.setUint32(20, 16);
  assert.deepEqual(imageSize(png), { width: 4096, height: 16 });
  assert.equal(imageSize(new Uint8Array(40)), null);
});
test('preview must be a small WebP', () => {
  const webp = new TextEncoder().encode('RIFF____WEBPVP8 ________________');
  assert.equal(checkPreviewWebp(webp), null);
  assert.ok(checkPreviewWebp(new Uint8Array(20)));
});
test('inlined rig names and signature match rig-contract.json', async () => {
  const fs = await import('node:fs');
  const { RIG_BONE_NAMES, RIG_SIGNATURE } = await import('../src/lib/doreumi/itemFile.ts');
  const rig = JSON.parse(fs.readFileSync(new URL('../public/doreumi/rig-contract.json', import.meta.url), 'utf8'));
  assert.deepEqual([...RIG_BONE_NAMES], rig.bones.map((b: { name: string }) => b.name).filter((n: string) => n !== 'DoreumiRig'));
  assert.equal(RIG_SIGNATURE, rig.rigSignature);
});
test('rigged garments cannot carry non-joint parts named like Doreumi bones', () => {
  const nodes = [{ name: 'shirt', mesh: 0, skin: 0 }, { name: 'head' }, { name: 'head', mesh: 0 }];
  const r = checkItemGlb(glb({ nodes, skins: [{ joints: [1] }] }), { rigged: true, bone: null });
  assert.equal(r.ok, false);
  const ok = checkItemGlb(glb({ nodes: nodes.slice(0, 2), skins: [{ joints: [1] }] }), { rigged: true, bone: null });
  assert.equal(ok.ok, true, JSON.stringify(ok));
});
