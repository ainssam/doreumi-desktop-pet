/** Read-only visual diagnostic applied only to the isolated QA bundle. */
export function parseMaterialDiagnostic(value = 'production', isolated = false) {
  if (!['production', 'diffuse-only', 'atlas-only'].includes(value)) throw Error('Unknown material diagnostic');
  if (value !== 'production' && !isolated) throw Error('Material diagnostics require the isolated runtime');
  return value;
}
export function instrumentMaterialDiagnostic(source, mode) {
  parseMaterialDiagnostic(mode, true);
  if (mode === 'production') return source;
  const marker = "material.customProgramCacheKey = () => 'doreumi-approved-face-v2-centroid-dress1';";
  if (source.split(marker).length !== 2) throw Error('Body material diagnostic hook changed');
  const expression = mode === 'diffuse-only' ? 'reflectedLight.directDiffuse + reflectedLight.indirectDiffuse' : 'diffuseColor.rgb';
  return source.replace(marker, `${marker}
        const originalMaterialCompile = material.onBeforeCompile;
        material.onBeforeCompile = (shader, webglRenderer) => {
          originalMaterialCompile.call(material, shader, webglRenderer);
          if (!shader.fragmentShader.includes('#include <opaque_fragment>')) throw Error('Body material fragment hook changed');
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = ${expression};\\n#include <opaque_fragment>');
        };
        material.customProgramCacheKey = () => 'doreumi-qa-diagnostic-${mode}';`);
}
export function parseUvDiagnostic(value = 'production', isolated = false) {
  if (!['production', 'centroid'].includes(value)) throw Error('Unknown UV diagnostic');
  if (value !== 'production' && !isolated) throw Error('UV diagnostics require the isolated runtime');
  return value;
}
export function instrumentUvDiagnostic(source, mode) {
  parseUvDiagnostic(mode, true);
  if (mode === 'production') return source;
  const marker = "material.customProgramCacheKey = () => 'doreumi-approved-face-v2-centroid-dress1';";
  if (source.split(marker).length !== 2) throw Error('Body UV diagnostic hook changed');
  return source.replace(marker, `${marker}
        const originalUvCompile = material.onBeforeCompile;
        material.onBeforeCompile = (shader, webglRenderer) => {
          originalUvCompile.call(material, shader, webglRenderer);
          for (const [field, chunk] of [['vertexShader', 'uv_pars_vertex'], ['fragmentShader', 'uv_pars_fragment']]) {
            const declaration = THREE.ShaderChunk[chunk];
            if (!declaration.includes('varying vec2 vMapUv;')) throw Error('Base UV declaration changed');
            shader[field] = shader[field].replace('#include <' + chunk + '>', declaration.replace('varying vec2 vMapUv;', 'centroid varying vec2 vMapUv;'));
          }
        };
        material.customProgramCacheKey = () => 'doreumi-qa-uv-centroid';`);
}
