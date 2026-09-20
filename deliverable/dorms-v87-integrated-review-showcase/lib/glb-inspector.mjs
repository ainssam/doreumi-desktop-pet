import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);
const TYPE_COMPONENTS = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function stableHash(value) {
  return sha256(Buffer.from(JSON.stringify(stable(value))));
}

export function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('유효한 GLB 파일이 아닙니다.');
  }
  if (bytes.readUInt32LE(4) !== 2) throw new Error('GLB 2.0만 지원합니다.');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB 헤더 길이와 실제 길이가 다릅니다.');

  let json;
  let binary;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) {
      json = JSON.parse(chunk.toString('utf8').replace(/\u0000+$/u, '').trimEnd());
    }
    if (type === BIN_CHUNK) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('GLB JSON 또는 BIN 청크가 없습니다.');
  return { json, binary };
}

function accessorBytes(document, accessorIndex) {
  const accessor = document.json.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) throw new Error(`accessor ${accessorIndex}를 읽을 수 없습니다.`);
  const view = document.json.bufferViews?.[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  const componentCount = TYPE_COMPONENTS.get(accessor.type);
  if (!view || !componentBytes || !componentCount) {
    throw new Error(`지원하지 않는 accessor 형식: ${accessor.componentType}/${accessor.type}`);
  }

  const elementBytes = componentBytes * componentCount;
  const stride = view.byteStride ?? elementBytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  if (stride === elementBytes) {
    return document.binary.subarray(start, start + accessor.count * elementBytes);
  }

  const packed = Buffer.alloc(accessor.count * elementBytes);
  for (let index = 0; index < accessor.count; index += 1) {
    document.binary.copy(
      packed,
      index * elementBytes,
      start + index * stride,
      start + index * stride + elementBytes,
    );
  }
  return packed;
}

function fingerprints(document, attributeName) {
  const records = [];
  for (const [meshIndex, mesh] of (document.json.meshes ?? []).entries()) {
    for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
      const accessorIndex = attributeName === 'INDICES'
        ? primitive.indices
        : primitive.attributes?.[attributeName];
      if (accessorIndex === undefined) continue;
      const accessor = document.json.accessors[accessorIndex];
      records.push({
        meshIndex,
        primitiveIndex,
        attributeName,
        count: accessor.count,
        type: accessor.type,
        componentType: accessor.componentType,
        normalized: accessor.normalized ?? false,
        hash: sha256(accessorBytes(document, accessorIndex)),
      });
    }
  }
  return records;
}

export async function inspectGlb(filePath) {
  const bytes = await readFile(filePath);
  const document = parseGlb(bytes);
  return {
    path: filePath,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    meshCount: document.json.meshes?.length ?? 0,
    nodeNames: (document.json.nodes ?? []).map((node) => node.name ?? ''),
    animationNames: (document.json.animations ?? []).map((clip) => clip.name ?? ''),
    materialCount: document.json.materials?.length ?? 0,
    textureCount: document.json.textures?.length ?? 0,
    imageCount: document.json.images?.length ?? 0,
    positionFingerprints: fingerprints(document, 'POSITION'),
    uvFingerprints: fingerprints(document, 'TEXCOORD_0'),
  };
}

export function compareTextureContracts(left, right) {
  const uvMatches = stableHash(left.uvFingerprints) === stableHash(right.uvFingerprints);
  const materialMatches = left.materialCount === right.materialCount;
  return {
    compatible: uvMatches && materialMatches,
    reasons: [
      ...(uvMatches ? [] : ['UV_ACCESSOR_MISMATCH']),
      ...(materialMatches ? [] : ['MATERIAL_COUNT_MISMATCH']),
    ],
  };
}
