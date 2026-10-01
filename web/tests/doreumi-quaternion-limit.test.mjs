import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { limitRestQuaternion } from '../scripts/doreumi/meshy-quaternion-limit.mjs';

const degrees = Math.PI / 180;
test('a 180-degree source boundary cannot flip a limited wrist to the opposite axis', () => {
  const rest = new Quaternion(), axis = new Vector3(.65, .63, -.42).normalize();
  let previousLog, previous, maximum = 0;
  for (const angle of [150, 162, 170, 177, 183, 190, 183, 177, 170, 105, 60, 0]) {
    const source = new Quaternion().setFromAxisAngle(axis, angle * degrees);
    if (angle > 180) source.set(-source.x, -source.y, -source.z, -source.w);
    const result = limitRestQuaternion(rest, source, 105 * degrees, previousLog);
    assert.ok(rest.angleTo(result.quaternion) <= 105 * degrees + 1e-9);
    if (previous && angle >= 105) maximum = Math.max(maximum, previous.angleTo(result.quaternion) / degrees);
    previousLog = result.log; previous = result.quaternion;
  }
  assert.ok(maximum < 1e-5, `the limit changed axis at 180 degrees: ${maximum}`);
  assert.ok(previous.angleTo(rest) < 1e-6);
});

test('ordinary rotations match the existing limit and quaternion sign is irrelevant', () => {
  const rest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .2), axis = new Vector3(.3, .7, -.2).normalize();
  for (const angle of [0, 20, 80, 104, 105, 150, 175]) {
    const source = rest.clone().multiply(new Quaternion().setFromAxisAngle(axis, angle * degrees)), before = source.toArray();
    const expected = rest.clone().slerp(source, angle > 105 ? 105 / angle : 1);
    const result = limitRestQuaternion(rest, source, 105 * degrees);
    assert.ok(result.quaternion.angleTo(expected) < 1e-7);
    const sign = new Quaternion(-source.x, -source.y, -source.z, -source.w);
    assert.ok(result.quaternion.angleTo(limitRestQuaternion(rest, sign, 105 * degrees).quaternion) < 1e-7);
    assert.deepEqual(source.toArray(), before);
  }
});
