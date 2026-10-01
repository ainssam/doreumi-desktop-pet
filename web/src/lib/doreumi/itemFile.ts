import "server-only";
import { createHash } from "node:crypto";

/**
 * 회원이 AI 와 만든 도름이 아이템 파일(.glb) 검사. 파일은 남이 보낸 입력이라 여기서 형식 경계를 전부 닫는다.
 * 통과 조건: glTF 2.0 바이너리 한 덩어리 · 바깥 주소(uri) 없음 · 허용한 확장만 · 면·그림 상한 ·
 * 뼈에 붙는 장신구면 붙일 뼈가 도름이 몸에 있음 · 몸 따라 움직이는 옷이면 관절 이름이 전부 도름이 뼈.
 * 모양을 그리는 일은 브라우저가 하므로 여기서는 크기·구조만 본다(스크립트가 들어갈 자리는 glTF 에 없다).
 */
export const ITEM_MAX_BYTES = 3 * 1024 * 1024;
export const PREVIEW_MAX_BYTES = 400 * 1024;
const MAX_TRIANGLES = 40_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_NODES = 200;
const MAX_IMAGE_SIDE = 2048;
const ALLOWED_EXTENSIONS = new Set(["KHR_materials_emissive_strength", "KHR_texture_transform", "KHR_materials_unlit", "EXT_meshopt_compression", "KHR_mesh_quantization"]);

/** public/doreumi/rig-contract.json 의 뼈 이름(DoreumiRig 제외)과 서명. 시험(doreumi-item-file)이 둘이 같은지 확인한다. */
export const RIG_BONE_NAMES = ["root","body","torso","head","shoulderL","armL","elbowL","wristL","shoulderR","armR","elbowR","wristR","thighL","kneeL","shinL","footL","thighR","kneeR","shinR","footR"] as const;
const RIG_BONES = new Set<string>(RIG_BONE_NAMES);
/** 장신구를 붙일 수 있는 자리: 뼈 + 모델에 있는 부착점(머리 장식·손바닥·무릎 위). */
export const ATTACH_POINTS = new Set([...RIG_BONES, "headAccessory", "palmL", "palmR", "lap"]);
export const RIG_SIGNATURE = "21af64ae682478f53aeb5e96e987efd394744bb695c3a34bc0e6f7be99e6c94f";

type Gltf = {
  asset?: { version?: string };
  buffers?: { uri?: string; byteLength?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  bufferViews?: { byteLength?: number; byteOffset?: number; buffer?: number }[];
  accessors?: { count?: number }[];
  meshes?: { primitives?: { indices?: number; attributes?: Record<string, number>; mode?: number; targets?: unknown[] }[] }[];
  nodes?: { name?: string; skin?: number; mesh?: number }[];
  skins?: { joints?: number[] }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  animations?: unknown[];
};

export type ItemFileCheck = { ok: true; sha256: string; triangles: number; rigged: boolean } | { ok: false; reason: string };

export function checkItemGlb(bytes: Uint8Array, meta: { rigged: boolean; bone: string | null }): ItemFileCheck {
  if (bytes.byteLength < 20 || bytes.byteLength > ITEM_MAX_BYTES) return { ok: false, reason: "파일 크기는 3MB 이하여야 해요." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return { ok: false, reason: "glTF 2.0 바이너리(.glb) 파일이 아니에요." };
  if (view.getUint32(8, true) !== bytes.byteLength) return { ok: false, reason: "파일 길이가 머리글과 달라요." };
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || 20 + jsonLength > bytes.byteLength) return { ok: false, reason: "파일 구조를 읽지 못했어요." };
  let gltf: Gltf;
  try { gltf = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength))) as Gltf; }
  catch { return { ok: false, reason: "파일 구조를 읽지 못했어요." }; }
  if (!gltf || typeof gltf !== "object" || gltf.asset?.version !== "2.0") return { ok: false, reason: "glTF 2.0 파일이 아니에요." };

  const declared = new Set(gltf.extensionsUsed ?? []);
  for (const name of [...declared, ...(gltf.extensionsRequired ?? [])]) {
    if (!ALLOWED_EXTENSIONS.has(name)) return { ok: false, reason: `쓸 수 없는 확장(${String(name).slice(0, 60)})이 들어 있어요.` };
  }
  // 선언하지 않고 물체·재질 안에 숨겨 둔 확장도 막는다(불러오는 쪽이 선언 없이도 쓰는 확장이 있다).
  const hidden = findExtensionKeys(gltf).find(name => !ALLOWED_EXTENSIONS.has(name) || !declared.has(name));
  if (hidden) return { ok: false, reason: `쓸 수 없는 확장(${hidden.slice(0, 60)})이 들어 있어요.` };
  // 바깥 파일·주소를 부르는 자리는 모두 막는다(한 파일에 다 담겨야 한다).
  if ((gltf.buffers ?? []).some((buffer) => buffer.uri !== undefined)) return { ok: false, reason: "바깥 파일을 부르는 부분이 있어요. 모두 한 파일에 담아 주세요." };
  const images = gltf.images ?? [];
  if (images.length > MAX_IMAGES) return { ok: false, reason: `그림은 ${MAX_IMAGES}장까지 넣을 수 있어요.` };
  for (const image of images) {
    if (image.uri !== undefined || typeof image.bufferView !== "number") return { ok: false, reason: "그림은 파일 안에 담아 주세요." };
    if (!["image/png", "image/jpeg", "image/webp"].includes(image.mimeType ?? "")) return { ok: false, reason: "그림은 PNG·JPG·WebP 만 쓸 수 있어요." };
    const view = gltf.bufferViews?.[image.bufferView];
    if ((view?.byteLength ?? Infinity) > MAX_IMAGE_BYTES) return { ok: false, reason: "그림 한 장은 1MB 이하여야 해요." };
    const size = imageSize(binChunk(bytes, jsonLength)?.subarray(view?.byteOffset ?? 0, (view?.byteOffset ?? 0) + (view?.byteLength ?? 0)));
    if (!size || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) return { ok: false, reason: `그림 크기는 가로세로 ${MAX_IMAGE_SIDE}픽셀 이하여야 해요.` };
  }
  if ((gltf.nodes ?? []).length > MAX_NODES) return { ok: false, reason: "부품이 너무 많아요." };
  if ((gltf.animations ?? []).length) return { ok: false, reason: "아이템에는 동작을 넣지 않아요. 도름이 몸을 따라 움직여요." };

  // 같은 모양을 여러 번 쓰면 그만큼 그려지므로, 모양이 아니라 모양을 쓰는 부품마다 센다.
  const meshTriangles: number[] = [];
  for (const mesh of gltf.meshes ?? []) {
    let count = 0;
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) return { ok: false, reason: "면(삼각형)으로 된 모양만 쓸 수 있어요." };
      if (primitive.targets?.length) return { ok: false, reason: "모양이 바뀌는 부품(morph)은 쓸 수 없어요." };
      const accessor = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION ?? -1];
      count += Math.floor((accessor?.count ?? 0) / 3);
    }
    meshTriangles.push(count);
  }
  let triangles = 0;
  for (const node of gltf.nodes ?? []) if (typeof node.mesh === "number") triangles += meshTriangles[node.mesh] ?? 0;
  if (!triangles) return { ok: false, reason: "모양이 비어 있어요." };
  if (triangles > MAX_TRIANGLES) return { ok: false, reason: `면이 너무 많아요(${triangles.toLocaleString("ko-KR")}개, ${MAX_TRIANGLES.toLocaleString("ko-KR")}개 이하).` };

  const skins = gltf.skins ?? [];
  if (meta.rigged) {
    if (!skins.length) return { ok: false, reason: "몸 따라 움직이는 옷인데 뼈대 연결이 없어요." };
    const joints = new Set<number>();
    for (const skin of skins) for (const joint of skin.joints ?? []) {
      const name = gltf.nodes?.[joint]?.name ?? "";
      if (!RIG_BONES.has(name)) return { ok: false, reason: `도름이 뼈에 없는 관절(${name.slice(0, 40) || "이름 없음"})이 있어요.` };
      joints.add(joint);
    }
    // 관절이 아닌 부품은 도름이 뼈·부착점 이름을 쓸 수 없다(동작이 엉뚱한 부품에 걸리지 않게).
    const reserved = (gltf.nodes ?? []).find((node, index) => !joints.has(index) && node.name && isReservedNodeName(node.name));
    if (reserved) return { ok: false, reason: `부품 이름(${String(reserved.name).slice(0, 40)})은 도름이 몸에서 쓰는 이름이라 바꿔 주세요.` };
  } else {
    if (skins.length) return { ok: false, reason: "뼈대에 묶인 옷이면 '몸 따라 움직이는 옷'으로 보내 주세요." };
    if (!meta.bone || !ATTACH_POINTS.has(meta.bone)) return { ok: false, reason: "붙일 자리 이름이 도름이 몸에 없어요." };
    // 끼우는 장신구가 도름이 뼈·부착점 이름을 쓰면 다음 아이템이 엉뚱한 곳에 붙을 수 있다.
    const reserved = (gltf.nodes ?? []).find(node => node.name && isReservedNodeName(node.name));
    if (reserved) return { ok: false, reason: `부품 이름(${String(reserved.name).slice(0, 40)})은 도름이 몸에서 쓰는 이름이라 바꿔 주세요.` };
  }
  // 도름이 몸을 바꾸는 파일을 막는다: 도름이 몸 이름을 쓴 모양이 들어 있으면 안 된다.
  if ((gltf.nodes ?? []).some((node) => node.name === "Doreumi")) return { ok: false, reason: "도름이 몸은 바꿀 수 없어요. 아이템만 담아 주세요." };

  return { ok: true, sha256: createHash("sha256").update(bytes).digest("hex"), triangles, rigged: meta.rigged };
}

/** 도름이 몸에서 쓰는 이름(몸·뼈대 뿌리·뼈·부착점). 아이템 부품은 이 이름을 쓸 수 없다. */
const isReservedNodeName = (name: string) => name === "Doreumi" || name === "DoreumiRig" || ATTACH_POINTS.has(name);

/** JSON 전체를 훑어 모든 extensions 블록의 이름을 모은다(깊이 제한). */
function findExtensionKeys(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const item of value) findExtensionKeys(item, depth + 1, out); return out; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "extensions" && child && typeof child === "object") out.push(...Object.keys(child as object));
    findExtensionKeys(child, depth + 1, out);
  }
  return out;
}
function binChunk(bytes: Uint8Array, jsonLength: number): Uint8Array | null {
  const start = 20 + jsonLength;
  if (start + 8 > bytes.byteLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(start, true);
  if (view.getUint32(start + 4, true) !== 0x004e4942 || start + 8 + length > bytes.byteLength) return null;
  return bytes.subarray(start + 8, start + 8 + length);
}
/** PNG·JPEG·WebP 머리글만 읽어 가로세로를 구한다(풀어 보지 않는다). */
export function imageSize(data: Uint8Array | null | undefined): { width: number; height: number } | null {
  if (!data || data.byteLength < 30) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.byteLength) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1], length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += 2 + length;
    }
    return null;
  }
  const tag = (at: number) => String.fromCharCode(...data.subarray(at, at + 4));
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    const kind = tag(12);
    if (kind === "VP8X") return { width: 1 + (data[24] | data[25] << 8 | data[26] << 16), height: 1 + (data[27] | data[28] << 8 | data[29] << 16) };
    if (kind === "VP8L") { const b = view.getUint32(21, true); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    if (kind === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  return null;
}

export function checkPreviewWebp(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 16 || bytes.byteLength > PREVIEW_MAX_BYTES) return "미리보기 그림은 400KB 이하여야 해요.";
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return "미리보기 그림은 WebP 여야 해요.";
  return null;
}
