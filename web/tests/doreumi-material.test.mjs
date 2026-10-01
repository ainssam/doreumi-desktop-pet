import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { ShaderChunk, ShaderLib } from 'three';
import { applyDoreumiAtlasSampling } from '../src/lib/doreumi/motion-material.ts';
import { DOREUMI_FACE_PLATE, DRESS_FRAGMENT, DRESS_FRAGMENT_UNIFORMS, facePlateWeight } from '../src/lib/doreumi/motion-dress.ts';

test('original atlas UV stays inside MSAA coverage without changing global shaders or other maps', () => {
  const originals = { ...ShaderChunk }, standard = ShaderLib.standard;
  const shader = { vertexShader: standard.vertexShader, fragmentShader: standard.fragmentShader };
  applyDoreumiAtlasSampling(shader);
  for (const source of [shader.vertexShader, shader.fragmentShader]) {
    assert.equal((source.match(/centroid varying vec2 vMapUv;/g) ?? []).length, 1);
    assert.ok(source.includes('varying vec2 vNormalMapUv;'));
  }
  assert.deepEqual(ShaderChunk, originals);
  assert.equal(ShaderLib.standard.vertexShader, standard.vertexShader);
  assert.throws(() => applyDoreumiAtlasSampling({ vertexShader: 'changed', fragmentShader: 'changed' }), /declaration changed/);
});
test('actual body shader retains the complete expression and neutral-skin composition', () => {
  const runtime = fs.readFileSync(new URL('../src/lib/doreumi/motion-runtime.ts', import.meta.url), 'utf8');
  const start = runtime.indexOf('material.onBeforeCompile = shader => {');
  const end = runtime.indexOf('material.customProgramCacheKey', start);
  assert.ok(start >= 0 && end > start);
  const material = {}, uniforms = { faceSkin: {}, faceInk: {}, faceNext: {}, faceBlend: {}, faceBounds: {} };
  vm.runInNewContext(runtime.slice(start, end), { material, uniforms, applyDoreumiAtlasSampling, DRESS_FRAGMENT, DRESS_FRAGMENT_UNIFORMS });
  const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.faceNext, uniforms.faceNext);
  assert.ok(shader.vertexShader.includes('vFacePosition = transformed;\nvFaceRest = position;'));
  assert.ok(shader.fragmentShader.includes('mix(fromInk.a,toInk.a,faceBlend)'));
  assert.ok(shader.fragmentShader.includes('cleanSkin.a*faceGate'));
  assert.ok(shader.fragmentShader.includes('inkPremultiplied*faceGate'));
  // Shop colors are painted before the face, so eyes and cheeks always stay on top.
  assert.ok(shader.fragmentShader.includes('uniform vec4 dressBody;'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb = dressRecolor(diffuseColor.rgb, vFaceRest);'));
  // The face plate keeps its own white, so the clean-skin layer under the eyes is never recolored.
  assert.ok(!shader.fragmentShader.includes('cleanSkin.rgb = dressRecolor'));
  assert.ok(shader.fragmentShader.indexOf('dressRecolor(diffuseColor.rgb') < shader.fragmentShader.indexOf('cleanSkin.a*faceGate'));
  assert.equal((shader.vertexShader.match(/centroid varying vec2 vMapUv;/g) ?? []).length, 1);
  assert.equal((shader.fragmentShader.match(/centroid varying vec2 vMapUv;/g) ?? []).length, 1);
});

test('shop colors paint the hood and body but never the white face plate', () => {
  // GLSL table and the JS mirror are the same numbers.
  const glsl = DRESS_FRAGMENT_UNIFORMS.match(/float\[37\]\(([^)]*)\)/)[1].split(',').map(Number);
  assert.deepEqual(glsl, DOREUMI_FACE_PLATE.map(value => Number(value.toFixed(5))));
  // Recolor has no leftover gate that skips off-line texels (the old cause of white specks and seams).
  assert.ok(!DRESS_FRAGMENT_UNIFORMS.includes('smoothstep(.035'));
  // Inside the recessed face plate (rest pose): eyes, mouth, cheeks, forehead.
  for (const [x, y, z] of [[0, .2, .338], [-.13, .25, .33], [.13, .12, .33], [0, .38, .3], [-.25, .1, .31]]) assert.equal(facePlateWeight(x, y, z), 1, `${x},${y}`);
  // The hood rim and wall, sides and top of the head, the back of the head and the belly are all body.
  for (const [x, y, z] of [[0, .45, .27], [0, -.05, .35], [.35, .2, .27], [-.33, .2, .276], [0, .2, -.3], [0, -.3, .4], [0, .7, .1]]) assert.equal(facePlateWeight(x, y, z), 0, `${x},${y}`);
  // The edge is soft over a few rest-pose millimetres, not a hard step.
  const edge = DOREUMI_FACE_PLATE[18];
  const mid = facePlateWeight(edge, .205, .3);
  assert.ok(mid > 0 && mid < 1);
});
