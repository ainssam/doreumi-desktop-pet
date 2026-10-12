/** Bounded GLB node.extras.doreumiLight contract shared by upload checks and school rendering. */
export const ITEM_LIGHT_MAX_PER_ITEM = 1;
export const ITEM_LIGHT_BONE_NAMES = [
  'root', 'body', 'torso', 'head', 'shoulderL', 'armL', 'elbowL', 'wristL',
  'shoulderR', 'armR', 'elbowR', 'wristR', 'thighL', 'kneeL', 'shinL', 'footL',
  'thighR', 'kneeR', 'shinR', 'footR', 'headAccessory', 'palmL', 'palmR', 'lap',
] as const;
const bones = new Set<string>(ITEM_LIGHT_BONE_NAMES);
const fields = new Set(['kind', 'color', 'intensity', 'distance', 'angle', 'position', 'direction', 'bone']);
type Triple = [number, number, number];
export type DoreumiItemLight = {
  kind: 'spot' | 'point'; color: string; intensity: number; distance: number; angle: number;
  position: Triple; direction: Triple; bone?: string;
};

function numberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function vector(value: unknown, bound: number): Triple | null {
  if (!Array.isArray(value) || value.length !== 3 || ![0, 1, 2].every(index => numberIn(value[index], -bound, bound))) return null;
  return [value[0], value[1], value[2]];
}

/** Invalid opt-ins never create a light. Rigid coordinates belong to the mesh, skinned coordinates to its named body joint. */
export function parseItemLight(value: unknown, rigged: boolean): DoreumiItemLight | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !fields.has(key))) return null;
  if (input.kind !== 'spot' && input.kind !== 'point') return null;
  if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color)) return null;
  const maxIntensity = input.kind === 'spot' ? 18 : 4, maxDistance = input.kind === 'spot' ? 8 : 4.5;
  const intensity = input.intensity === undefined ? maxIntensity : input.intensity;
  const distance = input.distance === undefined ? maxDistance : input.distance;
  const angle = input.angle === undefined ? 30 : input.angle;
  if (!numberIn(intensity, 0, maxIntensity) || intensity <= 0 || !numberIn(distance, 0, maxDistance) || distance <= 0 || !numberIn(angle, 5, 60)) return null;
  const position = vector(input.position === undefined ? [0, 0, 0] : input.position, 3);
  const direction = vector(input.direction === undefined ? [0, 0, 1] : input.direction, 1);
  if (!position || !direction) return null;
  const length = Math.hypot(...direction);
  if (length === 0) return null;
  if (rigged ? typeof input.bone !== 'string' || !bones.has(input.bone) : input.bone !== undefined) return null;
  return {
    kind: input.kind, color: input.color.toLowerCase(), intensity, distance, angle, position,
    direction: [direction[0] / length, direction[1] / length, direction[2] / length],
    ...(rigged ? { bone: input.bone as string } : {}),
  };
}
