import assert from 'node:assert/strict';
import test from 'node:test';
import { parseItemLight, ITEM_LIGHT_MAX_PER_ITEM, ITEM_LIGHT_BONE_NAMES } from '../src/lib/doreumi/itemLight.ts';

test('optional creator lights have bounded defaults and normalize colour and beam direction without mutating inputs', () => {
  for (const kind of ['spot', 'point']) {
    const input = Object.freeze({ kind, color: '#FfcC88', direction: Object.freeze([1, 0, 1]) });
    const light = parseItemLight(input, false);
    const { direction, ...properties } = light;
    assert.deepEqual(properties, {
      kind, color: '#ffcc88', intensity: kind === 'spot' ? 18 : 4, distance: kind === 'spot' ? 8 : 4.5,
      angle: 30, position: [0, 0, 0],
    });
    assert.ok(Math.abs(direction[0] - Math.SQRT1_2) < 1e-15 && direction[1] === 0 && Math.abs(direction[2] - Math.SQRT1_2) < 1e-15);
    light.direction[0] = 0; assert.equal(input.direction[0], 1);
  }
  assert.equal(ITEM_LIGHT_MAX_PER_ITEM, 1);
});

test('every numeric boundary is inclusive while infinite range, unsupported fields and malformed metadata fail closed', () => {
  const spot = { kind: 'spot', color: '#123456' }, point = { ...spot, kind: 'point' };
  for (const [input, field, min, max] of [[spot, 'intensity', .001, 18], [point, 'intensity', .001, 4], [spot, 'distance', .001, 8], [point, 'distance', .001, 4.5], [spot, 'angle', 5, 60]]) {
    assert.ok(parseItemLight({ ...input, [field]: min }, false));
    assert.ok(parseItemLight({ ...input, [field]: max }, false));
    assert.equal(parseItemLight({ ...input, [field]: max + .001 }, false), null);
    for (const invalid of [NaN, Infinity, -Infinity, '1', null, -1, 0]) assert.equal(parseItemLight({ ...input, [field]: invalid }, false), null);
  }
  assert.ok(parseItemLight({ ...spot, position: [-3, 3, 0], direction: [0, -1, 0], angle: 5 }, false));
  for (const value of [undefined, null, [], 'spot', {}, { ...spot, kind: 'ambient' }, { ...spot, color: 'red' }, { ...spot, color: '#fff' }, { ...spot, color: [1, 1, 1] }, { ...spot, castShadow: true }, { ...spot, position: [3.001, 0, 0] }, { ...spot, position: [0, null, 0] }, { ...spot, position: new Array(3) }, { ...spot, direction: [0, 0, 0] }, { ...spot, direction: [1.001, 0, 0] }, { ...spot, direction: [0, NaN, 1] }, { ...spot, direction: [0, 1] }, { ...spot, direction: new Array(3) }]) assert.equal(parseItemLight(value, false), null);
});

test('skinned lights require a known body joint and rigid lights cannot mix mesh-local and bone-local coordinates', () => {
  const light = { kind: 'point', color: '#ffffff' };
  assert.equal(parseItemLight(light, true), null);
  for (const bone of ITEM_LIGHT_BONE_NAMES) {
    assert.equal(parseItemLight({ ...light, bone }, true)?.bone, bone);
    assert.equal(parseItemLight({ ...light, bone }, false), null);
  }
  for (const bone of ['', 'Doreumi', 'DoreumiRig', 'unknown', '__proto__', null]) assert.equal(parseItemLight({ ...light, bone }, true), null);
});
