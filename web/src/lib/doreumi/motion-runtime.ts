import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { DoreumiMotion } from '@/lib/doreumi/motion';
import { doreumiFrame, resolveDoreumiAction, resolveDoreumiExpression, type DoreumiExpression } from '@/lib/doreumi/motion-catalog';
import type { DoreumiRigInspection } from '@/lib/doreumi/motion-rig';
import { createLapProp, createSnowmanProp } from '@/lib/doreumi/motion-props';
import { sampleSnowmanMotion } from '@/lib/doreumi/motion-snowman';
import { createDoreumiContextProps, type DoreumiContextInspection } from '@/lib/doreumi/motion-context-props';
import type { DoreumiStageHandler } from '@/lib/doreumi/motion-travel';
import { boundedMotionText, fetchMotionLibrary, MOTION_CLIP_MAX_BYTES, type MotionLibrary } from '@/lib/doreumi/motion-library';
import { doreumiSeason, type DoreumiLook } from '@/lib/doreumi/seasons';
import { createDoreumiWardrobe, removeDoreumiWardrobe } from '@/lib/doreumi/motion-wardrobe';
import { advanceMotionCamera, blendMotionFrames } from '@/lib/doreumi/motion-camera';
import { applyDoreumiAtlasSampling } from '@/lib/doreumi/motion-material';
import { applyDressColors, createDressUniforms, DRESS_FRAGMENT, DRESS_FRAGMENT_UNIFORMS, takeOffDressItem, wearDressItem } from '@/lib/doreumi/motion-dress';
import type { DoreumiDress } from '@/lib/doreumi/items';
import { createTeacherKit, type TeacherKit, type TeacherSide } from '@/lib/doreumi/motion-teacher';

/** front-left·front-right: 진행 방향으로 반쯤(45도) 돈 모습. 턱 점프처럼 팔 동작도 보이고 방향도 읽혀야 할 때. */
export type DoreumiFacing = 'left' | 'right' | 'front' | 'front-left' | 'front-right';

type Attachment = { triangle: number[]; barycentric: number[]; rotation: [number, number, number]; scale: number; propContact: number[] };
type Manifest = { props: { id: string; attachment: Attachment }[] };
export type DoreumiInspection = {
  action: string; requested: string; time: number; duration: number; recovering: boolean; pending: string | null; activeActions: number;
  expression: string; paused: boolean; renderedFrames: number; dpr: number; drawCalls: number; triangles: number;
  bounds: { min: number[]; max: number[] }; viewport: { width: number; height: number }; finite: boolean;
  boundsBasis: 'visible-deformed-vertices'; conservativeBounds: { min: number[]; max: number[] };
  bodyWorldBounds: { min: number[]; max: number[] };
  joints: Record<string, { parent: string | null; position: number[] }>;
  prop: string | null; propError: string | null; motionError: string | null; season: DoreumiLook;
  contextProps: DoreumiContextInspection;
  bodyTextures: { width: number; height: number; minFilter: number; mipmaps: boolean }[];
  rig: DoreumiRigInspection; facing: DoreumiFacing; yaw: number;
};
export type DoreumiRenderer = {
  setAction: (action: string) => void; setExpression: (expression: string) => Promise<void>;
  setActive: (active: boolean) => void; setVisible: (visible: boolean) => void;
  seek: (action: string, seconds: number) => void; play: () => void;
  inspect: () => DoreumiInspection; dispose: () => void;
  setFacing: (facing: DoreumiFacing) => void; setSkeletonVisible: (visible: boolean) => void;
  loadAction: (action: string) => Promise<void>;
  setViewAngle: (degrees: number) => void; setPlaybackRate: (rate: number) => void;
  /** Vertical orbit (degrees, any value; 90 looks down on the crown, -90 up at the soles). Only the dress preview uses it. */
  setViewTilt: (degrees: number, render?: boolean) => void;
  setSeason: (season: DoreumiLook | 'auto') => void;
  /** Items worn together (one per slot) and chosen colors. Doreumi's own body never changes. */
  setDress: (dress: DoreumiDress) => Promise<void>;
  setLocomotionRate: (rate: number) => void;
  capture: () => string;
  /** 선생님 차림(안경·콧수염)과 가리키기를 켠다. 도름이 안내 수첩 칠판 수업 전용. */
  setTeacher: (on: boolean) => void;
  /** 이 캔버스 기준 화면 좌표(NDC, 캔버스 밖이면 1보다 클 수 있다)를 그 쪽 팔로 가리킨다. null 이면 그만 가리킨다. */
  pointAt: (ndc: { x: number; y: number } | null, side?: TeacherSide) => void;
  /** 가리키는 손의 위치(캔버스 왼쪽 위 기준, 캔버스 크기에 대한 0~1 비율). 가리키지 않으면 null. */
  handScreen: () => { x: number; y: number } | null;
};
const BASE = '/doreumi';
function visibleBounds(root: THREE.Object3D) {
  const bounds = new THREE.Box3();
  root.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) { object.skeleton.update(); object.computeBoundingBox(); bounds.union(object.boundingBox!.clone().applyMatrix4(object.matrixWorld)); }
    else { object.geometry.computeBoundingBox(); bounds.union(object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld)); }
  });
  return bounds;
}

/**
 * Half height of the standing preview frame that keeps `bounds` inside 90% of the avatar box when the camera is tilted
 * `tilt` radians over the top or under the feet (2026-10-06: "360도 돌려서 발바닥 정수리"). Screen up mixes the body's
 * height and its horizontal reach by the tilt; screen right is always horizontal. The horizontal reach is the radius around
 * the vertical axis, so turning left and right while tilted never pumps the zoom.
 */
export function tiltedFrameHalfHeight(bounds: THREE.Box3, centerY: number, tilt: number, boxAspect: number): number {
  const horizontal = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
  const vertical = Math.max(bounds.max.y - centerY, centerY - bounds.min.y);
  const up = Math.abs(Math.cos(tilt)) * vertical + Math.abs(Math.sin(tilt)) * horizontal;
  return Math.max(up / .9, horizontal / (boxAspect * .9));
}
function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach(t => { t.dispose(); if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close(); });
  materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
}

/** Extra canvas around the avatar box, as fractions of that box. With it the camera stays on the
 * standing frame, so every motion keeps the same size and foot line and simply draws into the margin. */
export type DoreumiStableFraming = { top: number; bottom: number; side: number };
export const DOREUMI_STABLE_FRAMING: DoreumiStableFraming = { top: .32, bottom: .25, side: .25 };

export async function createDoreumiRenderer(canvas: HTMLCanvasElement, signal: AbortSignal, onMotionFrame?: DoreumiStageHandler, stable?: DoreumiStableFraming, fitDress = false): Promise<DoreumiRenderer> {
  // 가속이 없는 기기인지는 렌더러를 만들기 전에 따로 재 본다. 그런 기기에서는 가장자리 다듬기(4배 표본)가 장면마다 가장 비싸서 끈다.
  const softwareRendering = probeSoftwareWebGL();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !softwareRendering, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.03;
  // 그래픽 가속이 없는 컴퓨터(학교 PC 등)는 WebGL 을 CPU 로 그린 뒤 매 장면을 다시 읽어 와 화면 전체가 멈췄다
  // (2026-10-06 측정: 8초 중 13초 분량의 GLES2::ReadPixels). 그런 기기에서는 작게·드물게 그린다. 모습은 같다.
  const maxDpr = softwareRendering ? 1 : window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  // 화면이 120Hz 여도 도름이는 초당 60장이면 충분하다. 가속이 없으면 초당 8장.
  const minFrameMs = softwareRendering ? 125 : 12;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  renderer.setPixelRatio(dpr); renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.35, 1.35, 2.48, -.2, .01, 30);
  camera.position.set(0, 1.14, 6); camera.lookAt(0, 1.14, 0);
  // Match the approved creator lighting, without the heavy desktop shadow map.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c3d7, 2.2));
  for (const [color, intensity, x, y, z] of [[0xfffbf5, 3.1, -3.2, 5.8, 4.6], [0xcfe2ff, 1.35, 4, 3, 1.5], [0x8faeff, 1.05, -3, 3.5, -4]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register(parser => {
    // Embedded images use blob URLs. Load them through img-src, as the existing
    // Bomi renderer does, rather than ImageBitmapLoader's CSP-blocked blob fetch.
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: 'DOREUMI_IMAGE_ELEMENT_TEXTURES' };
  });
  const textureLoader = new THREE.TextureLoader();
  const textures = new Map<string, THREE.Texture>();
  const textureRequests = new Map<string, Promise<THREE.Texture>>();
  let disposed = false;
  async function texture(id: string) {
    const cached = textures.get(id); if (cached) return cached;
    const pending = textureRequests.get(id); if (pending) return pending;
    const request = textureLoader.loadAsync(id === 'skin' ? `${BASE}/face-skin.webp` : `${BASE}/expressions/${id}.webp`).then(map => {
      if (disposed || signal.aborted) { map.dispose(); throw new DOMException('Disposed', 'AbortError'); }
      map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; map.minFilter = THREE.LinearFilter; map.magFilter = THREE.LinearFilter; map.generateMipmaps = false;
      textures.set(id, map); return map;
    }).finally(() => textureRequests.delete(id));
    textureRequests.set(id, request); return request;
  }
  async function loadModel(url: string) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Doreumi asset ${response.status}`);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), `${BASE}/`);
    if (disposed || signal.aborted) { disposeObject(gltf.scene); throw new DOMException('Disposed', 'AbortError'); }
    let meshCount = 0, textureMissing = false;
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      meshCount++;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const map = material instanceof THREE.MeshStandardMaterial ? material.map : null;
        if (!map || !(map.image?.width > 0 && map.image?.height > 0)) textureMissing = true;
      }
    });
    // GLTFLoader resolves failed image loads as null maps. Never present an
    // untextured white character as ready; retain the approved image fallback.
    if (!meshCount || textureMissing) { disposeObject(gltf.scene); throw new Error('Doreumi model texture unavailable'); }
    return gltf;
  }
  let model: THREE.Group | undefined;
  let motion: DoreumiMotion | undefined;
  let manifest: Manifest;
  try {
    const result = await Promise.all([loadModel(`${BASE}/doreumi-master.glb`).then(gltf => { model = gltf.scene; return gltf; }), texture('skin'), texture('neutral'), fetch(`${BASE}/manifest.json`, { signal }).then(async r => { if (!r.ok) throw new Error('Doreumi manifest unavailable'); return await r.json() as Manifest; })]);
    if (signal.aborted) throw new DOMException('Disposed', 'AbortError');
    const [gltf, skin, neutral, assetManifest] = result; manifest = assetManifest;
    motion = new DoreumiMotion(model!, gltf.animations);
    const dressUniforms = createDressUniforms();
    const uniforms = { faceSkin: { value: skin }, faceInk: { value: neutral }, faceNext: { value: neutral }, faceBlend: { value: 1 }, faceBounds: { value: new THREE.Vector4(-.4, -.12, .4, .64) }, ...dressUniforms };
    model!.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.morphTargetInfluences?.length) object.morphTargetInfluences[0] = 1;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.map) {
          // Sample the narrow atlas islands directly at the mascot's small display size.
          material.map.generateMipmaps = false; material.map.minFilter = THREE.LinearFilter; material.map.needsUpdate = true;
        }
        material.roughness = .9; material.metalness = 0;
        material.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, uniforms);
          applyDoreumiAtlasSampling(shader);
          shader.vertexShader = 'varying vec3 vFacePosition;\nvarying vec3 vFaceRest;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\nvFacePosition = transformed;\nvFaceRest = position;');
          shader.fragmentShader = 'varying vec3 vFacePosition;\nvarying vec3 vFaceRest;\nuniform sampler2D faceSkin;\nuniform sampler2D faceInk;\nuniform sampler2D faceNext;\nuniform float faceBlend;\nuniform vec4 faceBounds;\n' + DRESS_FRAGMENT_UNIFORMS + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            ${DRESS_FRAGMENT}
            vec2 fp = vec2((vFacePosition.x-faceBounds.x)/(faceBounds.z-faceBounds.x), (faceBounds.w-vFacePosition.y)/(faceBounds.w-faceBounds.y));
            vec2 restFp = vec2((vFaceRest.x-faceBounds.x)/(faceBounds.z-faceBounds.x), (faceBounds.w-vFaceRest.y)/(faceBounds.w-faceBounds.y));
            float faceGate = step(.22,vFacePosition.z)*step(0.,fp.x)*step(fp.x,1.)*step(0.,fp.y)*step(fp.y,1.);
            vec4 cleanSkin = texture2D(faceSkin,restFp);
            vec4 fromInk = texture2D(faceInk,fp), toInk = texture2D(faceNext,fp);
            float inkAlpha = mix(fromInk.a,toInk.a,faceBlend);
            vec3 inkPremultiplied = mix(fromInk.rgb*fromInk.a,toInk.rgb*toInk.a,faceBlend);
            diffuseColor.rgb = mix(diffuseColor.rgb,cleanSkin.rgb,cleanSkin.a*faceGate);
            diffuseColor.rgb = diffuseColor.rgb*(1.-inkAlpha*faceGate) + inkPremultiplied*faceGate;
          `);
        };
        material.customProgramCacheKey = () => 'doreumi-approved-face-v2-centroid-dress2-plate';
      }
    });
    const holder = new THREE.Group(); holder.add(model!); scene.add(holder);
    const lap = model!.getObjectByName('lap');
    const laptop = createLapProp('laptop'), book = createLapProp('book');
    laptop.visible = false; book.visible = false; lap?.add(laptop, book);
    const snowman = createSnowmanProp(); snowman.visible = false; holder.add(snowman);
    const contextProps = createDoreumiContextProps({ model: model!, parent: holder });
    let contextAction = '';
    // Base look by default; seasonal clothes are chosen explicitly (shop), never auto-applied.
    let season: DoreumiLook = 'everyday', automaticSeason = false;
    let wardrobe = createDoreumiWardrobe(model!, season); model!.add(wardrobe);
    let dressItems: Awaited<ReturnType<typeof wearDressItem>>[] = [], dressRequest = 0;
    let dressFitHalfHeight = 0;
    const dressFitBounds = new THREE.Box3(), dressRigidMeshes: THREE.Mesh[] = [];
    let library: MotionLibrary | undefined, libraryRequest: Promise<MotionLibrary> | undefined;
    let actionRequest = 0, motionError: string | null = null, playbackRate = 1, viewAngle = 0, viewTilt = 0;
    // Body + outfit box for the tilted preview frame. Measured once per outfit (skinned bounds are costly), lazily on the first tilt.
    let tiltFitBounds: THREE.Box3 | null = null, tiltFitAction = '';
    const orbitUp = new THREE.Vector3(), orbitTarget = new THREE.Vector3();
    /** Screen up for a camera at yaw `az` and tilt `el` (radians); it turns with the tilt so the poles never flip. */
    function orbitBasis(az: number, el: number) {
      orbitUp.set(-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el));
    }
    const clipRequests = new Map<string, Promise<void>>();
    async function loadAction(action: string) {
      if (!action.startsWith('meshy:') || motion!.hasClip(action)) return;
      const pending = clipRequests.get(action); if (pending) return pending;
      const request = (async () => {
        library ??= await (libraryRequest ??= fetchMotionLibrary(signal).finally(() => { libraryRequest = undefined; }));
        const entry = library.motions.find(item => item.id === action);
        if (!entry?.url) throw new Error('Motion is not acquired yet');
        const response = await fetch(entry.url, { signal });
        if (!response.ok) throw new Error(`Motion asset ${response.status}`);
        const data = JSON.parse(await boundedMotionText(response, MOTION_CLIP_MAX_BYTES));
        if (disposed || signal.aborted) return;
        const clip = THREE.AnimationClip.parse(data); clip.name = action;
        if (!clip.validate() || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 180) throw new Error('Invalid animation');
        motion!.registerClip(clip, { planarSupportMaxOffset: entry.planarSupport?.maxOffset });
      })().finally(() => clipRequests.delete(action));
      clipRequests.set(action, request); return request;
    }
    let skeletonHelper: THREE.SkeletonHelper | undefined;
    let facing: DoreumiFacing = 'front', targetYaw = 0;
    model!.updateMatrixWorld(true);
    const initialBounds = visibleBounds(model!);
    holder.position.y = -initialBounds.min.y;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.44, 32), new THREE.MeshBasicMaterial({ color: 0x6d5f50, transparent: true, opacity: .09, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.y = .52; shadow.position.y = .003; scene.add(shadow);
    let active = true, visible = true, inspectionPaused = false, frame = 0, lastTime = 0, elapsed = 0, renderedFrames = 0;
    let expression: DoreumiExpression = 'neutral', expressionRequest = 0, blinkUntil = 0, nextBlink = 3.6;
    let prop: { id: string; root: THREE.Group; config: Attachment } | null = null, propRequest = 0, propError: string | null = null;
    let selectedPropAction = '';
    let lastRenderedAction = 'Idle';
    let environmentYaw: { action: string; yaw: number } | null = null;
    let width = 1, height = 1;
    let cameraHalfHeight = 1.34, cameraCenterY = 1.14, cameraCenterZ = 0, cameraOffset = 0;
    let cameraTracking = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduceMotion = reduced.matches;
    const isPaused = () => !active || !visible || document.hidden || inspectionPaused || reduceMotion;
    const pendingProps = new Set<THREE.Group>();
    const skinned: THREE.SkinnedMesh[] = [];
    model!.traverse(object => { if (object instanceof THREE.SkinnedMesh && object.name !== 'DoreumiGarment') skinned.push(object); });
    const anchor = new THREE.Vector3(), vertex = new THREE.Vector3(), scale = new THREE.Vector3(), orientation = new THREE.Quaternion(), local = new THREE.Matrix4();
    // 선생님 차림은 처음 켤 때 만든다(돌아다니는 도름이는 만들지 않는다).
    let teacher: TeacherKit | null = null, teacherOn = false, aimSide: TeacherSide = 'L', aimReady = false;
    let aimTarget: THREE.Vector3 | null = null;
    const aimCurrent = new THREE.Vector3(), handPoint = new THREE.Vector3();
    function updateProp() {
      if (!prop || !skinned[0]) return;
      model!.updateMatrixWorld(true); skinned[0].skeleton.update(); anchor.set(0, 0, 0);
      prop.config.triangle.forEach((index, i) => {
        skinned[0].getVertexPosition(index, vertex); skinned[0].localToWorld(vertex);
        anchor.addScaledVector(vertex, prop!.config.barycentric[i]);
      });
      orientation.setFromEuler(new THREE.Euler(...prop.config.rotation)); scale.setScalar(prop.config.scale);
      // Keep the handle upright while the hand lifts it, and follow stage facing.
      orientation.premultiply(holder.quaternion);
      prop.root.matrix.compose(anchor, orientation, scale).multiply(local.makeTranslation(-prop.config.propContact[0], -prop.config.propContact[1], -prop.config.propContact[2]));
      prop.root.matrixWorldNeedsUpdate = true;
    }
    function render(delta = 0, immediate = false) {
      if (disposed) return;
      const nextSeason = automaticSeason ? doreumiSeason() : season;
      if (nextSeason !== season) { removeDoreumiWardrobe(wardrobe); season = nextSeason; wardrobe = createDoreumiWardrobe(model!, season); model!.add(wardrobe); }
      const state = motion!.inspect();
      if (lastRenderedAction.startsWith('meshy:') && state.action === 'Idle') { targetYaw = 0; facing = 'front'; }
      lastRenderedAction = state.action;
      const importedMotion = library?.motions.find(item => item.id === state.action);
      // A fixed surface shares the holder origin. Keep its initial orientation
      // until the whole action ends, including entry and recovery.
      if (importedMotion?.environmentSupport) {
        if (environmentYaw?.action !== state.action) environmentYaw = { action: state.action, yaw: holder.rotation.y };
      } else environmentYaw = null;
      if (contextAction !== state.action) { contextAction = state.action; contextProps.setMotion(importedMotion ?? null); }
      const aspect = width / height;
      const framing = blendMotionFrames(state.framingSamples,
        action => library?.motions.find(item => item.id === action)?.frame, aspect);
      const contextFrame = contextProps.inspect().frame;
      if (contextFrame) {
        const bottom = Math.min(framing.centerY - framing.halfHeight, contextFrame.centerY - contextFrame.halfHeight);
        const top = Math.max(framing.centerY + framing.halfHeight, contextFrame.centerY + contextFrame.halfHeight);
        framing.centerY = (bottom + top) / 2;
        framing.halfHeight = Math.max((top - bottom) / 2, contextFrame.halfHeight / (width / height));
      }
      if (season === 'christmas' || season === 'santa-hat') { framing.halfHeight += .15; framing.centerY += .10; }
      laptop.visible = state.action === 'Code' && state.propVisibility > 0;
      book.visible = state.action === 'Read' && state.propVisibility > 0;
      snowman.visible = state.action === 'Snowman';
      if (snowman.visible) {
        const snow = sampleSnowmanMotion(state.time);
        const base = snowman.userData.base as THREE.Mesh, head = snowman.userData.head as THREE.Group;
        base.position.fromArray(snow.basePosition); base.rotation.x = snow.ballAngle;
        head.position.fromArray(snow.headPosition); head.visible = snow.headOpacity > 0;
        for (const [object, opacity] of [[base, snow.opacity], [head, snow.headOpacity]] as const) object.traverse(child => {
          if (child instanceof THREE.Mesh) for (const surface of Array.isArray(child.material) ? child.material : [child.material]) { surface.transparent = opacity < 1; surface.opacity = opacity; }
        });
      }
      const lid = laptop.userData.lid as THREE.Group;
      // Reveal an already supported prop after the hands settle. Sliding it up
      // through the knees, or closing the lid through the hands, breaks contact.
      lid.rotation.x = .20;
      laptop.position.y = book.position.y = 0;
      for (const prop of [laptop, book]) prop.traverse(object => {
        if (object instanceof THREE.Mesh) for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
          surface.transparent = state.propVisibility < 1; surface.opacity = state.propVisibility;
        }
      });
      if (state.action !== selectedPropAction) {
        selectedPropAction = state.action;
        void selectProp(state.action).catch(error => { propError = String(error); });
      }
      const blend = immediate || reduceMotion ? 1 : 1 - Math.exp(-delta / .1);
      if (stable) {
        // Fixed standing frame mapped onto the avatar box inside the larger canvas: no zoom, no drift.
        const scaleY = 1 + stable.top + stable.bottom, boxAspect = (width / (1 + 2 * stable.side)) / (height / scaleY);
        const standing = doreumiFrame('Idle', boxAspect);
        let dressBox: THREE.Box3 | null = null;
        if (fitDress && dressItems.length) {
          model!.updateMatrixWorld(true);
          const bounds = dressFitBounds.clone();
          for (const mesh of dressRigidMeshes) bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
          dressBox = bounds;
          if (!bounds.isEmpty() && boxAspect > 0 && Number.isFinite(boxAspect)
            && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
            // The radial extent holds every viewing angle. Keep the largest frame until the outfit changes,
            // so moving a hand never repeatedly zooms the preview in and out. Rigid geometry bounds are cached.
            const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
            const nextHalfHeight = Math.max(dressFitHalfHeight, radius / (boxAspect * .9), (bounds.max.y - standing.centerY) / .9, (standing.centerY - bounds.min.y) / .9);
            if (Number.isFinite(nextHalfHeight)) {
              dressFitHalfHeight = nextHalfHeight;
              standing.halfHeight = Math.max(standing.halfHeight, dressFitHalfHeight);
            }
          }
        }
        // Tilted views (2026-10-06: "360도 돌려서 발바닥 정수리 요런곳도 볼수 있게"): the camera orbits a sphere around the
        // standing frame's center. Seen from above, below or at a slant the body box projects taller or wider than when
        // standing, so widen the frame just enough for that projection. At zero tilt this is exactly the standing frame.
        let halfHeight = standing.halfHeight;
        if (viewTilt !== 0 && boxAspect > 0 && Number.isFinite(boxAspect)) {
          // Body box measured once per outfit and motion (skinned bounds are costly), joined with this frame's held items.
          if (!tiltFitBounds || tiltFitAction !== state.action) { model!.updateMatrixWorld(true); tiltFitBounds = visibleBounds(model!); tiltFitAction = state.action; }
          const fit = dressBox ? tiltFitBounds.clone().union(dressBox) : tiltFitBounds;
          const needed = fit.isEmpty() ? NaN : tiltedFrameHalfHeight(fit, standing.centerY, viewTilt, boxAspect);
          if (Number.isFinite(needed)) halfHeight = Math.max(halfHeight, needed);
        }
        cameraHalfHeight = halfHeight * scaleY;
        cameraCenterY = standing.centerY;
        cameraOffset = (stable.top - stable.bottom) * halfHeight;
        cameraTracking = false; cameraCenterZ = 0;
      } else {
        const nextCamera = advanceMotionCamera({ halfHeight: cameraHalfHeight, centerY: cameraCenterY, tracking: cameraTracking }, framing, delta, immediate || reduceMotion);
        cameraHalfHeight = nextCamera.halfHeight; cameraCenterY = nextCamera.centerY; cameraTracking = nextCamera.tracking; cameraOffset = 0;
        cameraCenterZ += ((['Lie', 'Roll'].includes(state.action) ? -.65 : 0) - cameraCenterZ) * blend;
      }
      const decision = onMotionFrame?.({ action: state.action, time: state.time, duration: state.duration, paused: isPaused(), pixelsPerUnit: height / (2 * cameraHalfHeight), travel: importedMotion?.travel, fixedEnvironment: !!importedMotion?.environmentSupport });
      if (decision) {
        if (Number.isFinite(decision.yaw)) targetYaw = decision.yaw;
        if (decision.stop) { ++actionRequest; motion!.setAction('Idle'); targetYaw = 0; facing = 'front'; }
      }
      const yawDifference = Math.atan2(Math.sin(targetYaw - holder.rotation.y), Math.cos(targetYaw - holder.rotation.y));
      if (environmentYaw && !decision?.stop) holder.rotation.y = environmentYaw.yaw;
      else holder.rotation.y += yawDifference * (immediate || reduceMotion ? 1 : 1 - Math.exp(-delta / .14));
      camera.left = -cameraHalfHeight * width / height; camera.right = -camera.left;
      camera.top = cameraHalfHeight; camera.bottom = -cameraHalfHeight;
      // Orbit: yaw around the vertical axis, then tilt over the top or under the feet. The camera's up turns with the tilt,
      // so a full vertical turn never flips at the poles. A stable frame shifts its target along that up (the box offset).
      orbitBasis(viewAngle, viewTilt);
      orbitTarget.set(0, cameraCenterY, cameraCenterZ).addScaledVector(orbitUp, cameraOffset);
      camera.up.copy(orbitUp);
      camera.position.set(Math.sin(viewAngle) * Math.cos(viewTilt), Math.sin(viewTilt), Math.cos(viewAngle) * Math.cos(viewTilt)).multiplyScalar(6).add(orbitTarget);
      camera.lookAt(orbitTarget); camera.updateProjectionMatrix();
      contextProps.update({ time: state.time, duration: state.duration });
      if (teacher && teacherOn && aimTarget) {
        if (!aimReady || immediate || reduceMotion) { aimCurrent.copy(aimTarget); aimReady = true; }
        else aimCurrent.lerp(aimTarget, 1 - Math.exp(-delta / .09));
        teacher.aim(aimCurrent, aimSide);
      }
      updateProp(); renderer.render(scene, camera); renderedFrames++;
    }
    function resize() {
      const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const nextDpr = Math.min(maxDpr, Math.max(window.devicePixelRatio || 1, Math.max(width, height) <= (stable ? 180 * (1 + stable.top + stable.bottom) : 180) ? 2 : 1));
      if (nextDpr !== dpr) { dpr = nextDpr; renderer.setPixelRatio(dpr); }
      renderer.setSize(width, height, false);
      render(0, true);
    }
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
    function evictTextures() {
      if (textures.size <= 9) return;
      for (const [id, map] of textures) {
        if (textures.size <= 9) break;
        if (['skin', 'neutral', 'blink_closed', expression].includes(id) || map === uniforms.faceInk.value || map === uniforms.faceNext.value) continue;
        textures.delete(id); map.dispose();
      }
    }
    function showTexture(map: THREE.Texture, immediate = false) {
      if (uniforms.faceNext.value === map && !immediate) return;
      uniforms.faceInk.value = uniforms.faceNext.value; uniforms.faceNext.value = map; uniforms.faceBlend.value = immediate ? 1 : 0;
      if (immediate) uniforms.faceInk.value = map;
    }
    function tick(now: number) {
      frame = 0; if (disposed || isPaused()) { lastTime = 0; return; }
      if (lastTime && now - lastTime < minFrameMs) { frame = requestAnimationFrame(tick); return; }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, .25) : 0; lastTime = now; elapsed += dt;
      motion!.update(dt * playbackRate);
      uniforms.faceBlend.value = Math.min(1, uniforms.faceBlend.value + dt / .12);
      const blink = textures.get('blink_closed');
      if (blinkUntil && elapsed >= blinkUntil) { blinkUntil = 0; showTexture(textures.get(expression) ?? neutral); }
      if (elapsed >= nextBlink && !blinkUntil && blink && !['blink_closed', 'sleepy', 'yawning', 'wink', 'half_sleepy'].includes(expression)) {
        showTexture(blink); blinkUntil = elapsed + .14; nextBlink = elapsed + 3.4 + Math.random() * 3.1;
      }
      render(dt); frame = requestAnimationFrame(tick);
    }
    function schedule() { if (disposed) return; if (isPaused()) { cancelAnimationFrame(frame); frame = 0; lastTime = 0; render(); } else if (!frame) { lastTime = 0; frame = requestAnimationFrame(tick); } }
    const visibilityChanged = () => schedule(); document.addEventListener('visibilitychange', visibilityChanged);
    const reducedChanged = () => { reduceMotion = reduced.matches; schedule(); }; reduced.addEventListener('change', reducedChanged);
    async function selectProp(action: string) {
      const id = action === 'MegaphoneSpeak' ? 'megaphone' : action === 'CarryBag' ? 'christmas-gift-sack' : '';
      if (id === prop?.id) return;
      const request = ++propRequest;
      propError = null;
      if (prop) { scene.remove(prop.root); disposeObject(prop.root); prop = null; }
      if (!id) return;
      const loaded = await loadModel(`${BASE}/props/${id}.glb`); pendingProps.add(loaded.scene);
      if (disposed || request !== propRequest) { pendingProps.delete(loaded.scene); disposeObject(loaded.scene); return; }
      const config = manifest.props.find(p => p.id === id)?.attachment;
      if (!config) { pendingProps.delete(loaded.scene); disposeObject(loaded.scene); throw new Error('Missing approved prop attachment'); }
      loaded.scene.matrixAutoUpdate = false; scene.add(loaded.scene); prop = { id, root: loaded.scene, config }; pendingProps.delete(loaded.scene); render();
    }
    await texture('blink_closed').catch(() => undefined);
    resize(); schedule();
    return {
      setAction(action) {
        const request = ++actionRequest; motionError = null;
        if (action.startsWith('meshy:')) {
          void loadAction(action).then(() => {
            if (disposed || request !== actionRequest) return;
            motion!.setAction(action); if (reduceMotion) motion!.seek(action, 0); render(); schedule();
          }).catch(error => { if (request === actionRequest) { motionError = String(error); motion!.setAction('Idle'); render(); } });
          return;
        }
        if (action.toLowerCase() === 'run-left' || action.toLowerCase() === 'run-right') {
          facing = action.toLowerCase() === 'run-left' ? 'left' : 'right'; targetYaw = facing === 'left' ? -Math.PI / 2 : Math.PI / 2;
        } else if (!['Run', 'Walk'].includes(resolveDoreumiAction(action))) {
          facing = 'front'; targetYaw = 0;
        }
        motion!.setAction(action);
        if (reduceMotion) motion!.seek(action, 0);
        render(); schedule();
      },
      async setExpression(value) {
        const id = resolveDoreumiExpression(value), request = ++expressionRequest;
        const map = await texture(id);
        if (disposed || request !== expressionRequest) return;
        expression = id; blinkUntil = 0; nextBlink = elapsed + 3.4; showTexture(map, isPaused()); evictTextures(); render();
      },
      setActive(value) { active = value; schedule(); }, setVisible(value) { visible = value; schedule(); },
      setFacing(value) { facing = value; targetYaw = value === 'left' ? -Math.PI / 2 : value === 'right' ? Math.PI / 2 : value === 'front-left' ? -Math.PI / 4 : value === 'front-right' ? Math.PI / 4 : 0; render(0, isPaused()); schedule(); },
      setSkeletonVisible(value) {
        if (value && !skeletonHelper) {
          skeletonHelper = new THREE.SkeletonHelper(model!); skeletonHelper.renderOrder = 10;
          const materials = Array.isArray(skeletonHelper.material) ? skeletonHelper.material : [skeletonHelper.material];
          materials.forEach(material => { material.depthTest = false; material.transparent = true; material.opacity = .9; });
        }
        if (skeletonHelper) { if (value) scene.add(skeletonHelper); else scene.remove(skeletonHelper); }
        render();
      },
      loadAction,
      capture() { render(0, true); return canvas.toDataURL('image/png'); },
      setLocomotionRate(rate) { motion!.setLocomotionRate(rate); },
      setSeason(value) {
        automaticSeason = value === 'auto'; const nextSeason: DoreumiLook = value === 'auto' ? doreumiSeason() : value;
        if (nextSeason !== season) { removeDoreumiWardrobe(wardrobe); season = nextSeason; wardrobe = createDoreumiWardrobe(model!, season); model!.add(wardrobe); }
        render(0, true);
      },
      async setDress(dress) {
        applyDressColors(dressUniforms, dress.colors);
        // The one official item (flower pin) is still drawn in code; everything else is a member's .glb.
        const official: DoreumiLook = dress.items.some(item => item.id === 'flower-pin') ? 'flower-pin' : 'everyday';
        automaticSeason = false;
        if (official !== season) { removeDoreumiWardrobe(wardrobe); season = official; wardrobe = createDoreumiWardrobe(model!, season); model!.add(wardrobe); }
        const request = ++dressRequest;
        const loaded = await Promise.all(dress.items.filter(item => item.asset).map(item => wearDressItem(loader, model!, item, signal).catch(() => null)));
        const kept = loaded.filter((item): item is NonNullable<typeof item> => !!item);
        if (request !== dressRequest || disposed) { kept.forEach(takeOffDressItem); return; }
        dressItems.forEach(takeOffDressItem); dressItems = kept;
        dressFitHalfHeight = 0; dressFitBounds.makeEmpty(); dressRigidMeshes.length = 0; tiltFitBounds = null;
        if (fitDress) {
          model!.updateMatrixWorld(true);
          for (const item of kept) for (const object of item.objects) {
            dressFitBounds.union(visibleBounds(object));
            object.traverseVisible(child => {
              if (child instanceof THREE.Mesh && !(child instanceof THREE.SkinnedMesh)) {
                child.geometry.computeBoundingBox(); dressRigidMeshes.push(child);
              }
            });
          }
        }
        render(0, true);
      },
      setTeacher(on) {
        if (on && !teacher && skinned[0]) teacher = createTeacherKit(model!, skinned[0]);
        teacherOn = on && !!teacher; teacher?.setVisible(teacherOn);
        if (!teacherOn) { aimTarget = null; aimReady = false; }
        render(0, isPaused());
      },
      pointAt(ndc, side = 'L') {
        if (!ndc || !Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) { aimTarget = null; aimReady = false; render(0, isPaused()); return; }
        aimSide = side;
        // 직교 카메라라 NDC 의 x·y 가 곧 그 자리다. 깊이는 몸 앞쪽으로 둔다.
        const point = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
        point.z = .35;
        aimTarget = point;
        render(0, isPaused());
      },
      handScreen() {
        if (!teacher || !teacherOn || !aimTarget) return null;
        const world = teacher.hand(aimSide, handPoint);
        if (!world) return null;
        const p = world.clone().project(camera);
        // 0~1 비율로 돌려준다. 무대 배율이 바뀌어도 호출하는 쪽이 지금 캔버스 크기를 곱해 쓴다.
        return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
      },
      setViewAngle(degrees) { viewAngle = Number.isFinite(degrees) ? degrees * Math.PI / 180 : 0; render(0, true); },
      // render=false when setViewAngle follows right away, so a drag frame draws once, not twice.
      setViewTilt(degrees, draw = true) { viewTilt = Number.isFinite(degrees) ? degrees * Math.PI / 180 : 0; if (draw) render(0, true); },
      setPlaybackRate(rate) { playbackRate = Math.max(.1, Math.min(3, rate)); },
      seek(action, seconds) { ++actionRequest; inspectionPaused = true; cancelAnimationFrame(frame); frame = 0; lastTime = 0; motion!.seek(action, seconds); render(0, true); },
      play() { motion!.resume(); inspectionPaused = false; schedule(); },
      inspect() {
        model!.updateMatrixWorld(true);
        const box = visibleBounds(holder);
        if (prop) box.union(visibleBounds(prop.root));
        const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z).project(camera); min.min(p); max.max(p);
        }
        const conservativeBounds = { min: min.toArray(), max: max.toArray() };
        // Project real vertices rather than empty corners of the rotated world
        // AABB. This diagnostic runs only on inspect(), not on animation frames.
        min.set(Infinity, Infinity, Infinity); max.set(-Infinity, -Infinity, -Infinity);
        const point = new THREE.Vector3();
        const projectVisible = (root: THREE.Object3D) => root.traverseVisible(object => {
          if (!(object instanceof THREE.Mesh)) return;
          if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
          const positions = object.geometry.getAttribute('position');
          if (!positions) return;
          for (let index = 0; index < positions.count; index++) {
            object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld).project(camera);
            min.min(point); max.max(point);
          }
        });
        projectVisible(holder);
        if (prop) projectVisible(prop.root);
        const bounds = { min: min.toArray(), max: max.toArray() };
        const bodyBox = new THREE.Box3();
        skinned.forEach(mesh => bodyBox.union(mesh.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)));
        const bodyWorldBounds = { min: bodyBox.min.toArray(), max: bodyBox.max.toArray() };
        const joints = Object.fromEntries((skinned[0]?.skeleton.bones ?? []).map(bone => [bone.name, { parent: bone.parent?.name ?? null, position: bone.getWorldPosition(new THREE.Vector3()).toArray() }]));
        const bodyTextures = skinned.flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).flatMap(material => {
          const map = material instanceof THREE.MeshStandardMaterial ? material.map : null;
          return map ? [{ width: map.image?.width ?? 0, height: map.image?.height ?? 0, minFilter: map.minFilter, mipmaps: map.generateMipmaps }] : [];
        }));
        return { ...motion!.inspect(), expression, facing, yaw: holder.rotation.y, paused: isPaused(), renderedFrames, dpr, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, bounds, boundsBasis: 'visible-deformed-vertices', conservativeBounds, bodyWorldBounds, joints, viewport: { width, height }, finite: [...bounds.min, ...bounds.max].every(Number.isFinite), prop: laptop.visible ? 'laptop' : book.visible ? 'book' : prop?.id ?? null, propError, motionError, season, bodyTextures, contextProps: contextProps.inspect() };
      },
      dispose() {
        if (disposed) return; disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect();
        document.removeEventListener('visibilitychange', visibilityChanged); reduced.removeEventListener('change', reducedChanged);
        dressRequest++; dressItems.forEach(takeOffDressItem); dressItems = [];
        teacher?.dispose(); teacher = null;
        motion!.dispose(); contextProps.dispose(); skeletonHelper?.dispose(); removeDoreumiWardrobe(wardrobe); skinned.forEach(mesh => mesh.skeleton.dispose()); disposeObject(scene); pendingProps.forEach(disposeObject); textures.forEach(t => t.dispose()); textures.clear(); renderer.dispose();
      },
    };
  } catch (error) {
    disposed = true; motion?.dispose(); if (model) disposeObject(model); textures.forEach(t => t.dispose()); renderer.dispose(); throw error;
  }
}

/** WebGL 이 그래픽 카드 없이 CPU 로 돌고 있는지(SwiftShader·llvmpipe·Microsoft Basic Render Driver 등). 잠깐 쓴 맥락은 바로 돌려준다. */
function probeSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = (probe.getContext('webgl2') || probe.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}
