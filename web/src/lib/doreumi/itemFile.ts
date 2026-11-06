import "server-only";
import { createHash } from "node:crypto";
import { parseItemLight, ITEM_LIGHT_MAX_PER_ITEM } from "./itemLight";

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
export const ALLOWED_EXTENSIONS = new Set(["KHR_materials_emissive_strength", "KHR_texture_transform", "KHR_materials_unlit", "EXT_meshopt_compression", "KHR_mesh_quantization"]);

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
  nodes?: { name?: string; skin?: number; mesh?: number; extras?: { doreumiLight?: unknown } }[];
  skins?: { joints?: number[] }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  animations?: unknown[];
};

export type ItemFileCheck = { ok: true; sha256: string; triangles: number; rigged: boolean } | { ok: false; reason: string };

export function checkItemGlb(bytes: Uint8Array, meta: { rigged: boolean; bone: string | null }): ItemFileCheck {
  if (bytes.byteLength < 20 || bytes.byteLength > ITEM_MAX_BYTES) return { ok: false, reason: "파일 크기는 3MB 이하여야 해요." };
  const layout = glbLayout(bytes);
  if (typeof layout === "string") return { ok: false, reason: layout };
  const { jsonLength } = layout;
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
  const tables = itemTablesProblem(gltf);
  if (tables) return { ok: false, reason: tables };
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
  let lights = 0;
  for (const node of gltf.nodes ?? []) {
    if (!node?.extras || !Object.hasOwn(node.extras, "doreumiLight")) continue;
    if (++lights > ITEM_LIGHT_MAX_PER_ITEM) return { ok: false, reason: "불빛은 아이템 하나에 한 개만 넣을 수 있어요." };
    if (!Number.isInteger(node.mesh) || !gltf.meshes?.[node.mesh!] || (meta.rigged && (!Number.isInteger(node.skin) || !gltf.skins?.[node.skin!]))) {
      return { ok: false, reason: "불빛은 아이템의 모양에 붙여 주세요. 옷의 불빛은 뼈대에 묶인 부분에 붙여요." };
    }
    if (gltf.meshes[node.mesh!].primitives?.length !== 1) return { ok: false, reason: "불빛을 붙인 부품에는 재질을 하나만 써 주세요." };
    if (!parseItemLight(node.extras.doreumiLight, meta.rigged)) return { ok: false, reason: "불빛 설정을 확인해 주세요. 제작 도구의 helpers.addLight로 색·밝기·거리·방향을 정할 수 있어요." };
  }
  if ((gltf.animations ?? []).length) return { ok: false, reason: "아이템에는 동작을 넣지 않아요. 도름이 몸을 따라 움직여요." };

  // 같은 모양을 여러 번 쓰면 그만큼 그려지므로, 모양이 아니라 모양을 쓰는 부품마다 센다.
  const meshTriangles: number[] = [], meshDraws: number[] = [];
  for (const mesh of gltf.meshes ?? []) {
    let count = 0;
    meshDraws.push((mesh.primitives ?? []).length);
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) return { ok: false, reason: "면(삼각형)으로 된 모양만 쓸 수 있어요." };
      if (primitive.targets?.length) return { ok: false, reason: "모양이 바뀌는 부품(morph)은 쓸 수 없어요." };
      const accessor = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION ?? -1];
      const drawn = Math.floor((accessor?.count ?? 0) / 3);
      // 면이 없는 조각은 면 수 상한에 안 잡히면서 그릴 물체만 늘린다(도라방 보안 재검증과 같은 뿌리).
      if (drawn < 1) return { ok: false, reason: "아무것도 그리지 않는 모양 조각이 있어요. 내보내기 도구로 다시 저장해 주세요." };
      count += drawn;
    }
    meshTriangles.push(count);
  }
  let triangles = 0, draws = 0;
  for (const node of gltf.nodes ?? []) if (typeof node.mesh === "number") { triangles += meshTriangles[node.mesh] ?? 0; draws += meshDraws[node.mesh] ?? 0; }
  // 그릴 물체 수(부품마다 그 모양의 조각 수의 합) 상한. 작은 파일로 수십만 물체를 만들어 입은 사람 주변 브라우저를 멈추던 것을 막는다.
  // 승인된 아이템 183개 가운데 가장 많은 것이 140개라 넉넉히 256(2026-10-14 운영 저장소 읽기 확인).
  if (draws > ITEM_MAX_DRAWS) return { ok: false, reason: `그려야 할 조각이 너무 많아요(${draws}개, ${ITEM_MAX_DRAWS}개 이하). 재질을 합치거나 같은 부품을 덜 되풀이해 주세요.` };
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
export function findExtensionKeys(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const item of value) findExtensionKeys(item, depth + 1, out); return out; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "extensions" && child && typeof child === "object") out.push(...Object.keys(child as object));
    findExtensionKeys(child, depth + 1, out);
  }
  return out;
}
/**
 * .glb 의 덩어리 배치를 정확히 하나로 정한다: 머리글 12바이트 → JSON 덩어리 하나 → (있으면) BIN 덩어리 하나 → 파일 끝.
 * three.js 는 덩어리를 끝까지 다 읽고 마지막 JSON·마지막 BIN 을 쓴다. 검사는 첫 덩어리만 보면 '검사한 파일'과 '그려지는 파일'이
 * 달라질 수 있어서(덩어리를 뒤에 덧붙이는 방법), 덧붙인 덩어리·모르는 덩어리·4바이트로 맞추지 않은 덩어리는 모두 거절한다(보안 재검증 H-N1).
 */
export function glbLayout(bytes: Uint8Array): { jsonLength: number; bin: Uint8Array | null } | string {
  if (bytes.byteLength < 20) return "파일 구조를 읽지 못했어요.";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return "glTF 2.0 바이너리(.glb) 파일이 아니에요.";
  if (view.getUint32(8, true) !== bytes.byteLength) return "파일 길이가 머리글과 달라요.";
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || jsonLength % 4 !== 0 || 20 + jsonLength > bytes.byteLength) return "파일 구조를 읽지 못했어요.";
  const start = 20 + jsonLength;
  if (start === bytes.byteLength) return { jsonLength, bin: null };
  if (start + 8 > bytes.byteLength) return "파일 구조를 읽지 못했어요.";
  const binLength = view.getUint32(start, true);
  if (view.getUint32(start + 4, true) !== 0x004e4942 || binLength % 4 !== 0 || start + 8 + binLength !== bytes.byteLength) return "파일 안에 덩어리가 덧붙어 있어요. 내보내기 도구로 다시 저장해 주세요.";
  return { jsonLength, bin: bytes.subarray(start + 8, start + 8 + binLength) };
}
/** 아이템 하나가 그릴 수 있는 물체 수(부품마다 그 모양의 조각 수의 합). */
const ITEM_MAX_DRAWS = 256;
/** glTF 2.0 이 정한 자리 자료 이름(대문자)과 '_' 로 시작하는 직접 만든 이름. 도라방 검사도 이것을 쓴다. */
export const GLTF_ATTRIBUTE_NAME = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+|_[A-Z0-9_]+)$/;
/**
 * 표는 모두 목록이고 자리 자료 이름은 glTF 가 정한 이름이어야 한다. three.js 는 목록 대신 객체로 쓴 표도 번호로 읽고, 'Position' 같은
 * 이름도 자리로 읽어서, 길이·이름으로 거르는 검사(동작·재질·면 수)를 피할 수 있었다(도라방 보안 재검증 H-N2·H-N3 과 같은 뿌리).
 */
export function itemTablesProblem(gltf: unknown): string | null {
  const raw = gltf as Record<string, unknown>;
  for (const key of ["scenes", "nodes", "meshes", "accessors", "bufferViews", "buffers", "materials", "textures", "images", "samplers", "skins", "animations", "cameras", "extensionsUsed", "extensionsRequired"]) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return "모양 자료 표가 이상해요. 내보내기 도구로 다시 저장해 주세요.";
  }
  // 부품의 모양·자식·뼈대 번호와 장면 번호는 0 이상 정수만. three.js 는 "1" 이나 [1] 도 번호로 읽어서, 숫자만 세는 면·물체 수 검사를
  // 피해 갔다(보안 재검증, 아이템 물체 폭증 우회).
  const index = (value: unknown, size: number) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < size);
  const nodes = (raw.nodes as unknown[] | undefined) ?? [], meshCount = ((raw.meshes as unknown[] | undefined) ?? []).length, skinCount = ((raw.skins as unknown[] | undefined) ?? []).length;
  for (const node of nodes) {
    const n = node as { mesh?: unknown; skin?: unknown; children?: unknown } | null;
    if (!n || typeof n !== "object" || !index(n.mesh, meshCount) || !index(n.skin, skinCount)) return "부품 연결이 이상해요. 내보내기 도구로 다시 저장해 주세요.";
    if (n.children !== undefined && (!Array.isArray(n.children) || n.children.some(child => !Number.isSafeInteger(child) || child < 0 || child >= nodes.length))) return "부품 연결이 이상해요. 내보내기 도구로 다시 저장해 주세요.";
  }
  for (const scene of (raw.scenes as unknown[] | undefined) ?? []) {
    const roots = (scene as { nodes?: unknown } | null)?.nodes;
    if (!scene || typeof scene !== "object" || (roots !== undefined && (!Array.isArray(roots) || roots.some(root => !Number.isSafeInteger(root) || root < 0 || root >= nodes.length)))) return "부품 연결이 이상해요. 내보내기 도구로 다시 저장해 주세요.";
  }
  if (raw.scene !== undefined && !index(raw.scene, ((raw.scenes as unknown[] | undefined) ?? []).length)) return "부품 연결이 이상해요. 내보내기 도구로 다시 저장해 주세요.";
  for (const mesh of (raw.meshes as unknown[] | undefined) ?? []) {
    const primitives = (mesh as { primitives?: unknown } | null)?.primitives;
    if (!mesh || typeof mesh !== "object" || (primitives !== undefined && !Array.isArray(primitives))) return "모양 자료 표가 이상해요. 내보내기 도구로 다시 저장해 주세요.";
    for (const p of (primitives as unknown[] | undefined) ?? []) {
      const primitive = p as { attributes?: unknown; targets?: unknown } | null;
      if (!primitive || typeof primitive !== "object" || (primitive.targets !== undefined && !Array.isArray(primitive.targets))) return "모양 자료 표가 이상해요. 내보내기 도구로 다시 저장해 주세요.";
      const attributes = primitive.attributes;
      if (attributes !== undefined && (typeof attributes !== "object" || attributes === null || Array.isArray(attributes))) return "모양 자료 표가 이상해요. 내보내기 도구로 다시 저장해 주세요.";
      if (Object.keys((attributes as object) ?? {}).some(name => !GLTF_ATTRIBUTE_NAME.test(name))) return "모양 자료 이름이 glTF 규칙과 달라요. 내보내기 도구로 다시 저장해 주세요.";
    }
  }
  return null;
}
/** 검사를 통과한 배치의 BIN 덩어리(없으면 null). 배치가 어긋나면 null(검사하는 쪽은 glbLayout 을 먼저 부른다). */
export function binChunk(bytes: Uint8Array, jsonLength: number): Uint8Array | null {
  const layout = glbLayout(bytes);
  return typeof layout === "string" || layout.jsonLength !== jsonLength ? null : layout.bin;
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
