import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DoreumiColors, DoreumiDressItem } from '@/lib/doreumi/items';

/**
 * 도름이 꾸미기: 색 바꾸기와 회원이 만든 아이템(.glb) 입히기. 도름이 몸(모양·뼈·표정)은 절대 바꾸지 않는다.
 *
 * 색(2026-09-30 사용자 지시: "눈이랑 입 있는 얼굴 쪽 하얀색은 그대로 있고 후드처럼 감싸고 있는 부분이 몸통"):
 * 도름이는 탈을 쓴 모양이다. 얼굴판(눈·입·볼이 있는 가운데 오목한 판)은 언제나 원래 흰색 그대로 두고,
 * 그 둘레의 탈·몸통과 소용돌이 두 개(배·머리)만 칠한다. 얼굴판 경계는 모형의 홈(탈 테두리 안쪽 바닥)을
 * 기준 자세 좌표에서 잰 값(DOREUMI_FACE_PLATE)이다.
 *
 * 칠하는 법: 그림 속 각 점을 '흰색 ↔ 남색' 선 위에 투영한 비율로 몸통색과 문양색을 섞는다. 예전에는 이 선에서
 * 조금 벗어난 점(JPEG 압축 얼룩, 흰색·남색 경계의 번짐)을 칠하지 않고 남겨서, 색을 입히면 몸 곳곳과 소용돌이
 * 둘레에 흰 점·흰 금이 갈라진 것처럼 보였다. 얼굴판 밖에는 눈·볼 같은 다른 그림이 없다(아틀라스 전수 확인)
 * 그래서 얼굴판 밖은 남김없이 칠한다.
 */
// THREE.Color already converts sRGB hex into the linear working space (ColorManagement), matching what
// the shader sees after decoding the sRGB texture. Do not convert a second time.
const linear = (hex: string) => new THREE.Color(hex);
const WHITE = linear('#f2f4fa'), NAVY = linear('#041642');
/** 기준 자세에서 이 높이보다 위의 남색은 머리 문양. 얼굴판(-0.02~0.42) 안에는 남색이 없다. */
const HEAD_SWIRL_MIN_Y = 0.3;

/**
 * 얼굴판 경계: 중심 (0, FACE_PLATE_CENTER_Y)에서 잰 반지름. 각도는 atan(y, |x|)를 -90도부터 90도까지 5도 간격
 * (좌우 대칭). 모형 앞면의 깊이 지도에서 홈 바닥(곡률이 가장 오목한 곳)을 1도마다 찾아 7도 폭으로 고른 값이다.
 */
export const FACE_PLATE_CENTER_Y = 0.205;
export const DOREUMI_FACE_PLATE = [
  0.2187, 0.2196, 0.2222, 0.2259, 0.2310, 0.2380, 0.2463, 0.2560, 0.2667, 0.2773, 0.2875, 0.2970, 0.3042,
  0.3099, 0.3130, 0.3142, 0.3144, 0.3130, 0.3088, 0.3029, 0.2967, 0.2903, 0.2836, 0.2755, 0.2669, 0.2588,
  0.2515, 0.2433, 0.2366, 0.2294, 0.2234, 0.2189, 0.2150, 0.2120, 0.2097, 0.2087, 0.2087,
] as const;
/** 얼굴판 앞면만: 뒤통수·옆머리가 같은 (x, y)에 있어도 칠하게 깊이도 본다. */
const FACE_PLATE_MIN_Z = 0.2, FACE_PLATE_FULL_Z = 0.24;
/** 경계를 부드럽게 넘기는 폭(모형 단위). 화면에서 1~2픽셀이라 계단 없이 이어진다. */
const FACE_PLATE_EDGE_IN = 0.004, FACE_PLATE_EDGE_OUT = 0.003;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 셰이더와 같은 식(시험용). 1이면 얼굴판 안쪽(칠하지 않음), 0이면 탈·몸통. */
export function facePlateWeight(x: number, y: number, z: number) {
  const dx = Math.max(Math.abs(x), 1e-5), dy = y - FACE_PLATE_CENTER_Y;
  const f = (Math.atan2(dy, dx) * 180 / Math.PI + 90) / 5;
  const i = Math.min(35, Math.max(0, Math.floor(f)));
  const edge = DOREUMI_FACE_PLATE[i] + (DOREUMI_FACE_PLATE[i + 1] - DOREUMI_FACE_PLATE[i]) * Math.min(1, Math.max(0, f - i));
  return (1 - smooth(-FACE_PLATE_EDGE_IN, FACE_PLATE_EDGE_OUT, Math.hypot(dx, dy) - edge)) * smooth(FACE_PLATE_MIN_Z, FACE_PLATE_FULL_Z, z);
}

export type DressUniforms = { dressBody: { value: THREE.Vector4 }; dressBelly: { value: THREE.Vector4 }; dressHead: { value: THREE.Vector4 } };
export function createDressUniforms(): DressUniforms {
  return { dressBody: { value: new THREE.Vector4(0, 0, 0, 0) }, dressBelly: { value: new THREE.Vector4(0, 0, 0, 0) }, dressHead: { value: new THREE.Vector4(0, 0, 0, 0) } };
}
export function applyDressColors(uniforms: DressUniforms, colors: DoreumiColors) {
  const set = (target: THREE.Vector4, hex: string | undefined) => {
    if (!hex) { target.set(0, 0, 0, 0); return; }
    const c = linear(hex); target.set(c.r, c.g, c.b, 1);
  };
  set(uniforms.dressBody.value, colors.body); set(uniforms.dressBelly.value, colors.belly); set(uniforms.dressHead.value, colors.head);
}
const f = (n: number) => n.toFixed(5);
/** Declarations (uniforms + the recolor function). Goes before main(); takes the rest-pose position. */
export const DRESS_FRAGMENT_UNIFORMS = `uniform vec4 dressBody;
uniform vec4 dressBelly;
uniform vec4 dressHead;
const float dPlate[37] = float[37](${DOREUMI_FACE_PLATE.map(f).join(', ')});
float dressFacePlate(vec3 rest) {
  vec2 d = vec2(max(abs(rest.x), 1e-5), rest.y - ${f(FACE_PLATE_CENTER_Y)});
  float a = (degrees(atan(d.y, d.x)) + 90.) / 5.;
  int i = int(clamp(floor(a), 0., 35.));
  float edge = mix(dPlate[i], dPlate[i + 1], clamp(a - float(i), 0., 1.));
  return (1. - smoothstep(${f(-FACE_PLATE_EDGE_IN)}, ${f(FACE_PLATE_EDGE_OUT)}, length(d) - edge)) * smoothstep(${f(FACE_PLATE_MIN_Z)}, ${f(FACE_PLATE_FULL_Z)}, rest.z);
}
vec3 dressRecolor(vec3 c, vec3 rest) {
  vec4 dSwirl = rest.y > ${HEAD_SWIRL_MIN_Y.toFixed(2)} ? dressHead : dressBelly;
  float dAmount = max(dressBody.a, dSwirl.a) * (1. - dressFacePlate(rest));
  if (dAmount <= 0.) return c;
  vec3 dW = vec3(${f(WHITE.r)}, ${f(WHITE.g)}, ${f(WHITE.b)});
  vec3 dN = vec3(${f(NAVY.r)}, ${f(NAVY.g)}, ${f(NAVY.b)});
  vec3 dAxis = dN - dW;
  // Every texel outside the face plate is body or swirl, including JPEG speckles and the soft white/navy seam,
  // so it is painted by its position on the white-navy line with no gaps left in the original color.
  float dT = clamp(dot(c - dW, dAxis) / dot(dAxis, dAxis), 0., 1.);
  vec3 dBody = mix(dW, dressBody.rgb, dressBody.a);
  vec3 dMark = mix(dN, dSwirl.rgb, dSwirl.a);
  return mix(c, mix(dBody, dMark, dT), dAmount);
}
`;
/** `#include <map_fragment>` 바로 뒤, 얼굴을 칠하기 전에 넣는다. vFaceRest(기준 자세 좌표)를 쓴다. 얼굴판의 맨살 층(cleanSkin)은 칠하지 않는다. */
export const DRESS_FRAGMENT = `diffuseColor.rgb = dressRecolor(diffuseColor.rgb, vFaceRest);`;

type LoadedItem = { id: string; objects: THREE.Object3D[] };
const HAND_MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const handLetter = (hand: NonNullable<DoreumiDressItem['hand']>) => hand === 'leftHand' ? 'L' : 'R';
const HAND_JOINT = /^(shoulder|arm|elbow|wrist|palm)([LR])$/;
const oppositeJoint = (name: string) => name.replace(/([LR])$/, side => side === 'L' ? 'R' : 'L');

function weightedHand(garments: readonly THREE.SkinnedMesh[]): 'L' | 'R' {
  let left = 0, right = 0;
  for (const garment of garments) {
    const indices = garment.geometry.getAttribute('skinIndex'), weights = garment.geometry.getAttribute('skinWeight');
    if (indices && weights) for (let vertex = 0; vertex < weights.count; vertex++) for (let component = 0; component < weights.itemSize; component++) {
      const name = garment.skeleton.bones[indices.getComponent(vertex, component)]?.name ?? '';
      if (!HAND_JOINT.test(name)) continue;
      if (name.endsWith('L')) left += weights.getComponent(vertex, component); else right += weights.getComponent(vertex, component);
    }
  }
  return left > right ? 'L' : 'R';
}

/** Reflected skinning needs reflected vertices, inverse binds, winding and tangent handedness together. */
function mirrorGarment(garment: THREE.SkinnedMesh) {
  garment.geometry = garment.geometry.clone();
  const geometry = garment.geometry;
  geometry.applyMatrix4(HAND_MIRROR);
  const index = geometry.index;
  if (index) for (let offset = 0; offset < index.count; offset += 3) {
    const value = index.getX(offset + 1); index.setX(offset + 1, index.getX(offset + 2)); index.setX(offset + 2, value);
  }
  else for (const attribute of Object.values(geometry.attributes)) for (let offset = 0; offset < attribute.count; offset += 3) for (let component = 0; component < attribute.itemSize; component++) {
    const value = attribute.getComponent(offset + 1, component);
    attribute.setComponent(offset + 1, component, attribute.getComponent(offset + 2, component)); attribute.setComponent(offset + 2, component, value);
  }
  const tangent = geometry.getAttribute('tangent');
  if (tangent) for (let vertex = 0; vertex < tangent.count; vertex++) tangent.setW(vertex, -tangent.getW(vertex));
}
const cache = new Map<string, Promise<ArrayBuffer>>();
async function fetchItem(url: string, signal?: AbortSignal) {
  let request = cache.get(url);
  if (!request) {
    request = fetch(url, { credentials: 'same-origin', signal }).then(async response => {
      if (!response.ok) throw new Error(`Doreumi item ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 3 * 1024 * 1024) throw new Error('Doreumi item too large');
      return bytes;
    });
    cache.set(url, request);
    request.catch(() => cache.delete(url));
  }
  return request;
}

/** 부착점은 도름이 몸에서만 찾는다. 이미 입은 아이템 안의 같은 이름 부품에 붙지 않게 한다. */
function findAnchor(model: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const stack: THREE.Object3D[] = [model];
  while (stack.length) {
    const node = stack.pop()!;
    if (node !== model && node.name.startsWith('DoreumiItem_')) continue;
    if (node.name === name) return node;
    stack.push(...node.children);
  }
  return undefined;
}

/** 아이템 한 개를 도름이에 붙인다. 뼈에 붙는 장신구는 그 뼈(부착점)의 자식으로, 옷은 도름이 뼈대에 다시 묶는다. */
export async function wearDressItem(loader: GLTFLoader, model: THREE.Object3D, item: DoreumiDressItem, signal?: AbortSignal): Promise<LoadedItem> {
  if (!item.asset) return { id: item.id, objects: [] };
  const gltf = await loader.parseAsync(await fetchItem(item.asset, signal), '');
  const objects: THREE.Object3D[] = [];
  if (item.rigged) {
    let body: THREE.SkinnedMesh | undefined;
    model.traverse(object => { if (!body && object instanceof THREE.SkinnedMesh && object.name === 'Doreumi') body = object; });
    if (!body) model.traverse(object => { if (!body && object instanceof THREE.SkinnedMesh) body = object; });
    if (!body) throw new Error('Doreumi body missing');
    const bones = new Map(body.skeleton.bones.map(bone => [bone.name, bone]));
    const garments: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) garments.push(object); });
    const mirrored = !!item.hand && handLetter(item.hand) !== weightedHand(garments);
    // Validate every mesh before attaching any: a malformed later mesh cannot leave a partial item on the body.
    const bindings = garments.map(garment => {
      const joints = garment.skeleton.bones.map(bone => bones.get(mirrored && HAND_JOINT.test(bone.name) ? oppositeJoint(bone.name) : bone.name));
      if (joints.some(bone => !bone)) throw new Error('Doreumi item joint mismatch');
      const inverses = garment.skeleton.boneInverses.map(inverse => mirrored ? HAND_MIRROR.clone().multiply(inverse).multiply(HAND_MIRROR) : inverse.clone());
      return { garment, mirrored, joints: joints as THREE.Bone[], inverses };
    });
    for (const { garment, mirrored, joints, inverses } of bindings) {
      if (mirrored) mirrorGarment(garment);
      garment.removeFromParent();
      garment.position.copy(body.position); garment.quaternion.copy(body.quaternion); garment.scale.copy(body.scale);
      garment.bind(new THREE.Skeleton(joints, inverses), body.bindMatrix);
      garment.bindMode = body.bindMode; garment.frustumCulled = false; garment.name = `DoreumiItem_${item.id}`;
      body.parent?.add(garment); objects.push(garment);
    }
  } else {
    const selected = item.hand ? handLetter(item.hand) : null;
    const original = item.bone ?? '';
    const handAnchor = HAND_JOINT.exec(original);
    const target = selected ? handAnchor ? `${handAnchor[1]}${selected}` : `palm${selected}` : original;
    const anchor = target ? findAnchor(model, target) : undefined;
    if (!anchor) throw new Error('Doreumi item anchor missing');
    const root = gltf.scene; root.name = `DoreumiItem_${item.id}`;
    if (selected && !handAnchor) {
      // Older hand items could be authored around a torso socket. Put their central grip at the palm,
      // removing that authored torso offset instead of carrying the offset over to the new hand.
      root.updateMatrixWorld(true);
      root.position.sub(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()));
    }
    if (selected && selected !== (handAnchor?.[2] ?? 'R')) root.applyMatrix4(HAND_MIRROR);
    root.traverse(object => { if (object instanceof THREE.Mesh) object.frustumCulled = false; });
    anchor.add(root); objects.push(root);
  }
  return { id: item.id, objects };
}

export function takeOffDressItem(loaded: LoadedItem) {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  for (const root of loaded.objects) {
    root.removeFromParent();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  }
  materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); skeletons.forEach(s => s.dispose());
}
