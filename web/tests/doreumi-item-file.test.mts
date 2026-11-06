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

test('optional item lights pass only on valid meshes with bounded settings', () => {
  const light = { kind: 'spot', color: '#ffd080' };
  const node = { name: 'bulb', mesh: 0, extras: { doreumiLight: light } };
  assert.equal(checkItemGlb(glb({ nodes: [node] }), rigid).ok, true);
  for (const bad of [null, [], {}, { ...light, kind: 'directional' }, { ...light, intensity: 19 }, { ...light, distance: 0 }, { ...light, angle: 61 }, { ...light, position: [4, 0, 0] }, { ...light, direction: [0, 0, 0] }, { ...light, bone: 'head' }, { ...light, castShadow: true }]) {
    assert.equal(checkItemGlb(glb({ nodes: [{ ...node, extras: { doreumiLight: bad } }] }), rigid).ok, false, JSON.stringify(bad));
  }
  assert.equal(checkItemGlb(glb({ nodes: [node, { ...node, name: 'second' }] }), rigid).ok, false);
  assert.equal(checkItemGlb(glb({ nodes: [{ name: 'empty', extras: node.extras }] }), rigid).ok, false);
  assert.equal(checkItemGlb(glb({ nodes: [{ ...node, mesh: 9 }] }), rigid).ok, false);
});

test('rigged light needs a skinned carrier and explicit known bone', () => {
  const meta = { rigged: true, bone: null };
  const garment = { name: 'shirt', mesh: 0, skin: 0, extras: { doreumiLight: { kind: 'point', color: '#abcdef', bone: 'torso' } } };
  const fixture = { nodes: [{ name: 'torso' }, garment], skins: [{ joints: [0] }] };
  assert.equal(checkItemGlb(glb(fixture), meta).ok, true);
  for (const bone of [undefined, '', 'tail']) {
    const nodes = [{ name: 'torso' }, { ...garment, extras: { doreumiLight: { ...garment.extras.doreumiLight, bone } } }];
    assert.equal(checkItemGlb(glb({ ...fixture, nodes }), meta).ok, false);
  }
  assert.equal(checkItemGlb(glb({ ...fixture, nodes: [{ name: 'torso' }, { ...garment, skin: undefined }] }), meta).ok, false);
});
test('one shape reused by many parts cannot make hundreds of thousands of drawn pieces', () => {
  // 모양 하나(조각 40개)를 부품 10개가 쓰면 그릴 물체 400개: 상한 256 을 넘는다.
  const meshes = [{ primitives: Array.from({ length: 40 }, () => ({ attributes: { POSITION: 0 } })) }];
  const nodes = Array.from({ length: 10 }, (_, i) => ({ name: `n${i}`, mesh: 0 }));
  const r = checkItemGlb(glb({ meshes, nodes, scenes: [{ nodes: nodes.map((_, i) => i) }] }), rigid);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /그려야 할 조각/);
  // 조금 되풀이하는 정도(그릴 물체 80개)는 그대로 통과한다.
  const fine = Array.from({ length: 2 }, (_, i) => ({ name: `n${i}`, mesh: 0 }));
  assert.equal(checkItemGlb(glb({ meshes, nodes: fine, scenes: [{ nodes: [0, 1] }] }), rigid).ok, true);
});
test('a piece that draws nothing is refused', () => {
  const r = checkItemGlb(glb({ accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3' }] }), rigid);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /아무것도 그리지/);
});
test('parts must point to shapes by plain numbers (three.js also reads "1" and [1])', () => {
  // 실제 우회 모양: 정상 부품 하나 옆에 번호를 글자·묶음으로 쓴 부품을 둔다(모양은 있으니 '빈 모양'으로 걸리지 않는다).
  // 그래서 거절 이유가 '부품 연결'이어야 이 검사가 지켜진다(코드 검증 0181c84e Medium).
  for (const mesh of ['0', [0], 0.5, -1, 9]) {
    const r = checkItemGlb(glb({ nodes: [{ name: 'hat', mesh: 0 }, { name: 'b', mesh }], scenes: [{ nodes: [0, 1] }] }), rigid);
    assert.equal(r.ok, false, JSON.stringify(mesh));
    if (!r.ok) assert.match(r.reason, /부품 연결/, JSON.stringify(mesh));
  }
  for (const skin of ['0', [0]]) {
    const r = checkItemGlb(glb({ nodes: [{ name: 'hat', mesh: 0 }, { name: 'b', mesh: 0, skin }], scenes: [{ nodes: [0, 1] }] }), rigid);
    assert.equal(r.ok, false, JSON.stringify(skin));
    if (!r.ok) assert.match(r.reason, /부품 연결/, JSON.stringify(skin));
  }
  assert.equal(checkItemGlb(glb({ nodes: [{ name: 'hat', mesh: 0, children: ['0'] }] }), rigid).ok, false, 'string child');
  assert.equal(checkItemGlb(glb({ scenes: [{ nodes: [[0]] }] }), rigid).ok, false, 'array root');
});
