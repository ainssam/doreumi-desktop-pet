export type DoreumiLowLedge = {
  version: 1;
  kind: 'low-ledge';
  geometry: {
    width: number; frontZ: number; depth: number; wallTop: number; top: number;
    railZ: number; railRadius: number; rails: [number, number][];
    footstepTop: number; footstepFrontZ: number; footstepBackZ: number;
  };
  targetHandVertices: { L: number; R: number };
  targetFootVertices: { L: number; R: number };
};

const ACTIONS = new Set([439, 440, 619, 620]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A surface is enabled only together with its measured, adapted clip metadata. */
export function parseDoreumiEnvironment(value: unknown, actionId: number): DoreumiLowLedge | null {
  if (!ACTIONS.has(actionId) || !object(value) || value.version !== 1 || value.kind !== 'low-ledge' || !object(value.geometry)) return null;
  const g = value.geometry;
  const numbers = ['width', 'frontZ', 'depth', 'wallTop', 'top', 'railZ', 'railRadius', 'footstepTop', 'footstepFrontZ', 'footstepBackZ'];
  if (numbers.some(key => typeof g[key] !== 'number' || !Number.isFinite(g[key]) || (g[key] as number) <= 0 || (g[key] as number) > 3)) return null;
  if (!Array.isArray(g.rails) || g.rails.length !== 2 || !g.rails.every(rail => Array.isArray(rail) && rail.length === 2
    && rail.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= (g.width as number) / 2)
    && rail[0] < rail[1])) return null;
  if (g.rails[0][1] >= g.rails[1][0] || (g.railRadius as number) > .08
    || (g.footstepFrontZ as number) >= (g.footstepBackZ as number) || (g.wallTop as number) > (g.top as number)) return null;
  for (const key of ['targetHandVertices', 'targetFootVertices']) {
    const probes = value[key];
    if (!object(probes) || !['L', 'R'].every(side => Number.isSafeInteger(probes[side]) && (probes[side] as number) >= 0 && (probes[side] as number) < 78799)) return null;
  }
  return {
    version: 1, kind: 'low-ledge',
    geometry: { ...Object.fromEntries(numbers.map(key => [key, g[key]])), rails: g.rails.map(rail => [...rail]) } as DoreumiLowLedge['geometry'],
    targetHandVertices: { ...(value.targetHandVertices as DoreumiLowLedge['targetHandVertices']) },
    targetFootVertices: { ...(value.targetFootVertices as DoreumiLowLedge['targetFootVertices']) },
  };
}
