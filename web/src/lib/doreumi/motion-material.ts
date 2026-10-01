import { ShaderChunk } from 'three';

type DoreumiShader = { vertexShader: string; fragmentShader: string };

/** Keep MSAA interpolation inside a covered triangle. The original atlas has
 * very small UV islands; pixel-center extrapolation can read a neighboring
 * island even when all covered samples belong to the blue curl. */
export function applyDoreumiAtlasSampling(shader: DoreumiShader): void {
  for (const [field, chunk] of [
    ['vertexShader', 'uv_pars_vertex'], ['fragmentShader', 'uv_pars_fragment'],
  ] as const) {
    const declaration = ShaderChunk[chunk];
    const include = `#include <${chunk}>`;
    if (!shader[field].includes(include) || !declaration.includes('varying vec2 vMapUv;')) {
      throw new Error('Doreumi atlas shader declaration changed');
    }
    shader[field] = shader[field].replace(include, declaration.replace('varying vec2 vMapUv;', 'centroid varying vec2 vMapUv;'));
  }
}
