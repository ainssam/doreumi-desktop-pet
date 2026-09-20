import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  actionLoopPolicy,
  clampZoom,
  normalizeV60InspectionBounds,
  normalizePercent,
  selectSingleAction,
  v60InspectionPose,
} from '/v87/viewer-model.mjs';

export const V60_SHA256 = '00969b87595ee949d44fbe3f738ad028ee466c215cd64c825268bc01a2ec17d2';

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse((object) => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    for (const material of asArray(object.material)) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('캔버스 이미지를 만들지 못했습니다.'));
    }, type);
  });
}

export async function loadGlbFromUrl(loader, url, {
  fetchImpl = globalThis.fetch,
  pageUrl = globalThis.location?.href ?? 'http://127.0.0.1/',
} = {}) {
  const response = await fetchImpl(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const absoluteUrl = new URL(url, pageUrl);
  const resourcePath = new URL('./', absoluteUrl).href;
  return loader.parseAsync(bytes, resourcePath);
}

export async function createV60Viewer({
  canvas,
  modelUrl = '/assets/v60.glb',
  onState = () => {},
} = {}) {
  if (!canvas) throw new Error('V60 canvas가 없습니다.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eaf1fb');
  const camera = new THREE.PerspectiveCamera(32, 1, 0.02, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI * 0.86;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c3d7, 2.2));
  const key = new THREE.DirectionalLight(0xfffbf5, 3.1);
  key.position.set(-3.2, 5.8, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.015;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe2ff, 1.35);
  fill.position.set(4, 3, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x8faeff, 1.05);
  rim.position.set(-3, 3.5, -4);
  scene.add(rim);

  const loader = new GLTFLoader();
  let gltf;
  try {
    gltf = await loadGlbFromUrl(loader, modelUrl);
  } catch (error) {
    renderer.dispose();
    controls.dispose();
    throw new Error(`V60 GLB 로드 실패: ${error.message}`);
  }

  const model = gltf.scene;
  model.name ||= 'DoreumiV60';
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    for (const material of asArray(object.material)) {
      material.normalMap = null;
      material.bumpMap = null;
      material.displacementMap = null;
      material.roughness = 0.9;
      material.metalness = 0;
      material.needsUpdate = true;
    }
  });
  scene.add(model);
  model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(model);
  const centerVector = box.getCenter(new THREE.Vector3());
  const sizeVector = box.getSize(new THREE.Vector3());
  const rawBounds = {
    center: centerVector.toArray(),
    size: sizeVector.toArray(),
    min: box.min.toArray(),
    max: box.max.toArray(),
  };
  const bounds = normalizeV60InspectionBounds(rawBounds);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(sizeVector.x, sizeVector.z) * 2.2, 96),
    new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.98, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = box.min.y - 0.008;
  floor.receiveShadow = true;
  scene.add(floor);

  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let currentAction = null;
  let disposed = false;
  let animationFrame = 0;
  let dirty = true;
  let lastTime = performance.now();
  let lastStateEmit = 0;
  const state = {
    ready: true,
    modelVersion: 'V60',
    modelSha256: V60_SHA256,
    animationCount: clips.size,
    animationNames: [...clips.keys()],
    active: 'Idle',
    paused: false,
    transition: 'hard-cut',
    view: 'front',
    zoom: 1,
    time: 0,
    duration: clips.get('Idle')?.duration ?? 0,
    progress: 0,
  };

  function snapshot() {
    return {
      ...state,
      bounds: structuredClone(bounds),
    };
  }

  function emit(force = false) {
    if (force) dirty = true;
    const now = performance.now();
    if (!force && now - lastStateEmit < 120) return;
    lastStateEmit = now;
    onState(snapshot());
  }

  function applyCamera(view = state.view, zoom = state.zoom) {
    const pose = v60InspectionPose(view, zoom);
    camera.position.fromArray(pose.position);
    controls.target.fromArray(pose.target);
    controls.minDistance = pose.distance * 0.48;
    controls.maxDistance = pose.distance * 2.8;
    controls.update();
    state.view = view;
    state.zoom = pose.zoom;
    emit(true);
  }

  function play(name) {
    const next = actions.get(name);
    const clip = clips.get(name);
    if (!next || !clip) throw new Error(`V60 클립 없음: ${name}`);
    mixer.stopAllAction();
    const policy = actionLoopPolicy(name);
    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.setLoop(policy.loop ? THREE.LoopRepeat : THREE.LoopOnce, policy.repetitions);
    next.clampWhenFinished = !policy.loop;
    next.paused = false;
    next.play();
    currentAction = next;
    Object.assign(state, selectSingleAction(state, name), {
      time: 0,
      duration: clip.duration,
      progress: 0,
    });
    mixer.timeScale = 1;
    emit(true);
    return snapshot();
  }

  function pause(value = !state.paused) {
    state.paused = Boolean(value);
    mixer.timeScale = state.paused ? 0 : 1;
    if (currentAction) currentAction.paused = state.paused;
    emit(true);
    return snapshot();
  }

  function seek(percent) {
    if (!currentAction) return snapshot();
    const progress = normalizePercent(percent);
    currentAction.paused = true;
    currentAction.time = (progress / 100) * currentAction.getClip().duration;
    mixer.update(0);
    state.paused = true;
    state.time = currentAction.time;
    state.duration = currentAction.getClip().duration;
    state.progress = progress;
    emit(true);
    return snapshot();
  }

  function setView(view) {
    applyCamera(view, state.zoom);
    return snapshot();
  }

  function setZoom(zoom) {
    applyCamera(state.view, clampZoom(zoom));
    return snapshot();
  }

  function reset() {
    play('Idle');
    applyCamera('front', 1);
    seek(0);
    pause(false);
    return snapshot();
  }

  function resize() {
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 640);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 640);
    const pixelWidth = Math.floor(width * renderer.getPixelRatio());
    const pixelHeight = Math.floor(height * renderer.getPixelRatio());
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      dirty = true;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function render(now) {
    if (disposed) return;
    const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (!state.paused) mixer.update(delta);
    if (currentAction) {
      state.time = currentAction.time;
      state.duration = currentAction.getClip().duration;
      state.progress = state.duration > 0 ? (state.time / state.duration) * 100 : 0;
    }
    resize();
    const cameraChanged = controls.update();
    if (!state.paused || dirty || cameraChanged) {
      renderer.render(scene, camera);
      dirty = false;
    }
    emit();
    animationFrame = requestAnimationFrame(render);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    mixer.stopAllAction();
    controls.dispose();
    renderer.dispose();
    disposeObject(model);
    floor.geometry.dispose();
    floor.material.dispose();
  }

  applyCamera('front', 1);
  play('Idle');
  animationFrame = requestAnimationFrame(render);

  return {
    renderer,
    scene,
    camera,
    controls,
    model,
    mixer,
    clips,
    actions,
    bounds,
    get state() { return snapshot(); },
    play,
    pause,
    seek,
    setView,
    setZoom,
    reset,
    captureBlob: (type = 'image/png') => canvasBlob(canvas, type),
    dispose,
  };
}
