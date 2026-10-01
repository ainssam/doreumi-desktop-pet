/** Rebuild web derivatives from the creator's approved, locally hydrated repository.
 * No geometry decimation, texture painting, network requests, or source writes.
 * Usage: node scripts/doreumi/assets-build.mjs --source=/path/to/doreumi-desktop-pet
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = process.argv.find(a => a.startsWith('--source='))?.slice(9);
if (!SOURCE) throw new Error('Pass --source= with the hydrated creator repository.');
const SOURCE_COMMIT = 'b2cb2a6f7646a298c577a2dbe510a2a75cb9161b';
if (execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== SOURCE_COMMIT) {
  throw new Error('Unexpected creator revision. Re-audit before changing the source pin.');
}
const OUT = path.join(ROOT, 'public/doreumi');
const src = relative => path.join(SOURCE, 'deliverable', relative);
const sha = data => createHash('sha256').update(data).digest('hex');
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const pins = {
  model: '00969b87595ee949d44fbe3f738ad028ee466c215cd64c825268bc01a2ec17d2',
  position: '20e8b80c7f5f3d2c62db8aa41b60511c4a52190a6d93b0f65af177c8d739f540',
  normal: '48dcad24ead205fd43194efa9897d7a1fcc91261ba93da91eebf11c832670799',
};
async function verified(file, expected) {
  const data = await readFile(file);
  if (sha(data) !== expected) throw new Error(`Source integrity mismatch: ${path.relative(SOURCE, file)}`);
  return data;
}
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
await mkdir(path.join(OUT, 'expressions'), { recursive: true });
await mkdir(path.join(OUT, 'props'), { recursive: true });
const registry = await json(src('dorms-v86-approved-expression-set/APPROVED-MANIFEST.json'));
if (registry.assets.length !== 34 || registry.assets.some(a => !a.userApproved)) throw new Error('34 approved expressions required');
const original = await verified(src('dorms-v60-final-shoulder/models/basic.glb'), pins.model);
const document = await io.readBinary(original);
const corrections = {};
for (const name of ['position', 'normal']) {
  const bytes = await verified(src(`dorms-v89-v60-neutral-face/data/neutral-${name}-delta.bin`), pins[name]);
  corrections[name] = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const geometry = await json(src('dorms-v89-v60-neutral-face/reports/geometry-validation.json'));
const approval = await json(src('dorms-v90-v60-expression-set/USER-APPROVAL.json'));
if (!geometry.pass || approval.model.sha256 !== pins.model) throw new Error('Approved face correction required');

// Run the exact approved V90 color-transfer functions on decoded pixels, without a browser.
// Canvas here is only an in-memory pixel carrier. The original algorithm never renders 3D.
globalThis.document = {
  createElement(type) {
    if (type !== 'canvas') throw new Error('Unexpected DOM use in approved transfer');
    const canvas = { width: 0, height: 0, data: null };
    canvas.getContext = () => ({
      drawImage(image, _x, _y, width, height) {
        if (width !== image.width || height !== image.height) throw new Error('Decode images to <=4096 before transfer');
        canvas.data = image.data;
      },
      getImageData: () => ({ data: canvas.data }),
      putImageData: image => { canvas.data = image.data; },
    });
    return canvas;
  },
};
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.__doreumiBakeThree = THREE;
const asModule = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const projectionCode = await readFile(src('dorms-v88-expression-transfer-pilot/src/projection.mjs'), 'utf8');
const projectionUrl = asModule(projectionCode);
const transferCode = (await readFile(src('dorms-v88-expression-transfer-pilot/src/transfer.mjs'), 'utf8'))
  .replace("import * as THREE from 'three';", 'const THREE=globalThis.__doreumiBakeThree;')
  .replace("'./projection.mjs'", JSON.stringify(projectionUrl));
const expressionCode = await readFile(src('dorms-v90-v60-expression-set/src/pigment.mjs'), 'utf8');
const thinkingCode = await readFile(src('dorms-v89-v60-neutral-face/src/pigment.mjs'), 'utf8');
const faceCode = (await readFile(src('dorms-v90-v60-expression-set/src/face-material.mjs'), 'utf8'))
  .replace("import * as THREE from 'three';", 'const THREE=globalThis.__doreumiBakeThree;')
  .replace("'/v88/transfer.mjs'", JSON.stringify(asModule(transferCode)))
  .replace("'/v88/projection.mjs'", JSON.stringify(projectionUrl))
  .replace("'./pigment.mjs'", JSON.stringify(asModule(expressionCode)))
  .replace("'/v89/pigment.mjs'", JSON.stringify(asModule(thinkingCode)));
const { createFaceMaterial } = await import(asModule(faceCode));
const { projectSurface } = await import(projectionUrl);
async function decodedImage(bytes) {
  const { data, info } = await sharp(bytes).resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
async function samplingRoot(doc, textureOverride) {
  const meshes = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial();
    const image = await decodedImage(textureOverride ?? material.getBaseColorTexture().getImage());
    meshes.push({ isMesh: true, geometry: {
      attributes: {
        position: { array: primitive.getAttribute('POSITION').getArray(), count: primitive.getAttribute('POSITION').getCount() },
        uv: { array: primitive.getAttribute('TEXCOORD_0').getArray() },
      }, index: { array: primitive.getIndices().getArray() },
    }, material: { color: new THREE.Color().fromArray(material.getBaseColorFactor()), map: { image, flipY: false } } });
  }
  return { traverse: visit => meshes.forEach(visit), meshes };
}
const target = await samplingRoot(document);
const neutral = registry.assets.find(a => a.id === 'neutral');
const neutralDoc = await io.readBinary(await verified(src(`dorms-v86-approved-expression-set/${neutral.model}`), neutral.modelSHA256));
const source = await samplingRoot(neutralDoc, await verified(src(`dorms-v86-approved-expression-set/${neutral.texture}`), neutral.textureSHA256));
const expressions = [];
let neutralFace;
for (const expression of registry.assets) {
  const pixels = await verified(src(`dorms-v86-approved-expression-set/${expression.texture}`), expression.textureSHA256);
  const image = await decodedImage(pixels);
  source.meshes.forEach(mesh => { mesh.material.map.image = image; });
  const face = createFaceMaterial(target, source, geometry.regionsXY, expression);
  const encode = surface => sharp(Buffer.from(surface.rgba), { raw: { width: surface.width, height: surface.height, channels: 4 } }).webp({ lossless: true }).toBuffer();
  if (expression.id === 'neutral') {
    neutralFace = face;
    await writeFile(path.join(OUT, 'face-skin.webp'), await encode(face.skin));
  }
  const ink = await encode(face.ink);
  await writeFile(path.join(OUT, 'expressions', `${expression.id}.webp`), ink);
  expressions.push({ id: expression.id, label: expression.id === 'relieved' ? '기쁨' : expression.id === 'shy' ? '부끄러움' : expression.label, sourceVersion: expression.version, sourceSHA256: expression.textureSHA256, sha256: sha(ink), bytes: ink.length, inkPixels: face.report.inkPixels });
  console.log(`Baked approved expression ${expression.id}: ${ink.length} bytes`);
}

// A transparent actual-model front view is available before WebGL and on unsupported devices.
// Rasterize the original triangles and approved neutral face, never substitute an illustration.
const primitives = target.meshes.map(mesh => {
  const image = mesh.material.map.image;
  const positions = mesh.geometry.attributes.position.array.slice();
  for (let i = 0; i < positions.length; i++) positions[i] += corrections.position[i];
  return { positions, uvs: mesh.geometry.attributes.uv.array, indices: mesh.geometry.index.array,
    sample(u, v) { const x = Math.max(0, Math.min(image.width - 1, Math.round(u * (image.width - 1)))); const y = Math.max(0, Math.min(image.height - 1, Math.round(v * (image.height - 1)))); const k = 4 * (y * image.width + x); return Array.from(image.data.subarray(k, k + 4)); } };
});
const fallback = projectSurface(primitives, { bounds: [-1.18, -1.08, 1.18, 1.25], width: 512, height: 506 });
for (let row = 0; row < fallback.height; row++) for (let col = 0; col < fallback.width; col++) {
  const k = 4 * (row * fallback.width + col);
  if (fallback.depth[row * fallback.width + col] < .22) continue;
  const x = fallback.bounds[0] + (col + .5) / fallback.width * (fallback.bounds[2] - fallback.bounds[0]);
  const y = fallback.bounds[3] - (row + .5) / fallback.height * (fallback.bounds[3] - fallback.bounds[1]);
  for (const surface of [neutralFace.skin, neutralFace.ink]) {
    const u = Math.floor((x - surface.bounds[0]) / (surface.bounds[2] - surface.bounds[0]) * surface.width);
    const v = Math.floor((surface.bounds[3] - y) / (surface.bounds[3] - surface.bounds[1]) * surface.height);
    if (u < 0 || v < 0 || u >= surface.width || v >= surface.height) continue;
    const p = 4 * (v * surface.width + u), alpha = surface.rgba[p + 3] / 255;
    for (let c = 0; c < 3; c++) fallback.rgba[k + c] = fallback.rgba[k + c] * (1 - alpha) + surface.rgba[p + c] * alpha;
  }
}
// Preserve empty RGB as well as alpha. WebP may otherwise fill fully transparent
// pixels with neighboring colors, which alpha-blind previewers show as blocks.
for (let i = 0; i < fallback.rgba.length; i += 4) if (!fallback.rgba[i + 3]) fallback.rgba.fill(0, i, i + 3);
await writeFile(path.join(OUT, 'fallback.webp'), await sharp(Buffer.from(fallback.rgba), { raw: { width: fallback.width, height: fallback.height, channels: 4 } }).webp({ lossless: true, exact: true }).toBuffer());

const mesh = document.getRoot().listMeshes()[0];
const primitive = mesh.listPrimitives()[0];
const buffer = document.getRoot().listBuffers()[0];
const morph = document.createPrimitiveTarget('ApprovedNeutralFace');
for (const [attribute, name] of [['POSITION', 'position'], ['NORMAL', 'normal']]) {
  morph.setAttribute(attribute, document.createAccessor(`approved-neutral-${name}`).setType('VEC3').setArray(corrections[name]).setBuffer(buffer));
}
primitive.addTarget(morph);
mesh.setWeights([1]);
const attributesBefore = Object.fromEntries(primitive.listSemantics().map(s => [s, sha(Buffer.from(primitive.getAttribute(s).getArray().buffer))]));
async function compress(doc, file, textureSize, textureOverride) {
  if (textureOverride && doc.getRoot().listTextures().length === 0) {
    const texture = doc.createTexture('creator-runtime-texture').setImage(textureOverride).setMimeType('image/png');
    for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(texture);
  }
  for (const texture of doc.getRoot().listTextures()) {
    const image = await sharp(textureOverride ?? texture.getImage()).resize({ width: textureSize, height: textureSize, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    texture.setImage(image).setMimeType('image/jpeg');
  }
  // QUANTIZE is the encoder's filter-free mode. No quantize() transform is used:
  // every position, normal, UV, skin weight and animation value remains float-exact.
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(doc);
  await writeFile(file, bytes);
  return { bytes: bytes.length, sha256: sha(bytes) };
}
const model = await compress(document, path.join(OUT, 'doreumi.glb'), 2048);
const decoded = await io.read(path.join(OUT, 'doreumi.glb'));
const decodedPrimitive = decoded.getRoot().listMeshes()[0].listPrimitives()[0];
for (const [s, hash] of Object.entries(attributesBefore)) {
  if (sha(Buffer.from(decodedPrimitive.getAttribute(s).getArray().buffer)) !== hash) throw new Error(`Geometry changed: ${s}`);
}
const props = [];
const attachments = await json(src('dorms-v98-badge-integration/data/attachments.json'));
for (const id of ['megaphone', 'christmas-gift-sack']) {
  const original = await readFile(src(`dorms-v48-premium-props/props/${id}.glb`));
  const doc = await io.readBinary(original);
  const texture = await readFile(src(`dorms-v98-badge-integration/data/prop-textures/${id}.png`));
  props.push({ id, sourceSHA256: sha(original), ...(await compress(doc, path.join(OUT, 'props', `${id}.glb`), 1024, texture)), attachment: attachments[id] });
}
const actions = document.getRoot().listAnimations().map(a => ({ id: a.getName(), duration: Math.max(...a.listSamplers().map(s => s.getInput().getMax([])[0])), approval: 'approved' }));
actions.push(...['MegaphoneSpeak', 'CarryBag'].map(id => ({ id, duration: 6, approval: 'candidate' })));
const manifest = { version: 1, source: { repository: 'ainssam/doreumi-desktop-pet', revision: SOURCE_COMMIT, modelSHA256: pins.model, corrections: pins }, model, geometryExact: true, textureSize: 2048, faceResolution: 768, faceBounds: [-.4, -.12, .4, .64], actions, expressions, props, transferSourceHashes: { projection: sha(projectionCode), expression: sha(expressionCode), thinking: sha(thinkingCode) } };
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ model, expressionCount: expressions.length, expressionsBytes: expressions.reduce((n, e) => n + e.bytes, 0), actions: actions.length, geometryExact: true }, null, 2));
