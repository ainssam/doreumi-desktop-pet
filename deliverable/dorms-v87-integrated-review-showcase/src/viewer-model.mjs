export const CAMERA_PRESETS = Object.freeze({
  front: Object.freeze({ azimuth: 0, label: '정면' }),
  quarter: Object.freeze({ azimuth: 45, label: '45도' }),
  side: Object.freeze({ azimuth: 90, label: '측면' }),
  back: Object.freeze({ azimuth: 180, label: '뒷면' }),
});

export function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0.65, Math.min(1.9, number));
}

export function normalizePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

export function selectSingleAction(state, active) {
  return { active, paused: false, transition: 'hard-cut' };
}

export function actionLoopPolicy(name) {
  const loop = ['Idle', 'Walk', 'Run'].includes(name);
  return { loop, repetitions: loop ? Infinity : 1 };
}

export function cameraPose(bounds, view, zoom = 1) {
  const preset = CAMERA_PRESETS[view];
  if (!preset) throw new Error(`알 수 없는 카메라 시점: ${view}`);
  const safeZoom = clampZoom(zoom);
  const scale = Math.max(...bounds.size, 1);
  const distance = (scale * 2.05) / safeZoom;
  const radians = preset.azimuth * Math.PI / 180;
  const [targetX, targetY, targetZ] = bounds.center;
  return {
    view,
    zoom: safeZoom,
    distance,
    target: [targetX, targetY, targetZ],
    position: [
      targetX + Math.sin(radians) * distance,
      targetY + bounds.size[1] * 0.05,
      targetZ + Math.cos(radians) * distance,
    ],
  };
}

export function normalizeV60InspectionBounds(rawBounds) {
  const height = Math.max(Number(rawBounds?.size?.[1]) || 0, Number.EPSILON);
  const [centerX = 0, , centerZ = 0] = rawBounds?.center ?? [];
  const [minX = 0, , minZ = 0] = rawBounds?.min ?? [];
  const [maxX = 0, , maxZ = 0] = rawBounds?.max ?? [];
  return {
    center: [centerX, height / 2, centerZ],
    size: [Number(rawBounds?.size?.[0]) || 0, height, Number(rawBounds?.size?.[2]) || 0],
    min: [minX, 0, minZ],
    max: [maxX, height, maxZ],
  };
}

export function v60InspectionPose(view, zoom = 1) {
  const preset = CAMERA_PRESETS[view];
  if (!preset) throw new Error(`알 수 없는 카메라 시점: ${view}`);
  const safeZoom = clampZoom(zoom);
  const horizontalDistance = 6.25 / safeZoom;
  const verticalOffset = 0.8 / safeZoom;
  const radians = preset.azimuth * Math.PI / 180;
  const target = [0, 0.98, 0];
  return {
    view,
    zoom: safeZoom,
    distance: Math.hypot(horizontalDistance, verticalOffset),
    target,
    position: [
      Math.sin(radians) * horizontalDistance,
      target[1] + verticalOffset,
      Math.cos(radians) * horizontalDistance,
    ],
  };
}
