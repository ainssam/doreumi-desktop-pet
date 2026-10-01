import test from 'node:test';
import assert from 'node:assert/strict';
import { solveContactIntervalPath } from '../scripts/doreumi/meshy-contact-intervals.mjs';
const wide = [{ minimum: -1.5, maximum: 1.5 }];
test('global branch selection prepares for future positive support instead of flipping between disjoint sets', () => {
  const frames = Array.from({ length: 45 }, (_, index) => ({ rawAngle: 0, intervals: index >= 15 && index <= 25
    ? [{ minimum: -1.5, maximum: -1 }, { minimum: .6, maximum: 1.5 }]
    : index === 26 ? [{ minimum: .6, maximum: 1.5 }] : wide }));
  const result = solveContactIntervalPath(frames);
  assert.equal(result.report.feasible, true);
  assert.ok(result.angles.slice(15, 27).every(angle => angle >= .6 - 1e-8));
  assert.ok(result.report.maximumStep < .2);
  result.angles.forEach((angle, index) => assert.ok(frames[index].intervals.some(i => angle >= i.minimum - 1e-8 && angle <= i.maximum + 1e-8)));
});
test('empty skin-feasible intervals remain unresolved rather than copying a previous pose', () => {
  const result = solveContactIntervalPath([{ rawAngle: 0, intervals: wide }, { rawAngle: 0, intervals: [] }]);
  assert.equal(result.report.feasible, false); assert.equal(result.angles, null); assert.deepEqual(result.report.emptyFrames, [1]);
});
test('unrestricted source angle remains zero and invalid ranges are rejected', () => {
  const result = solveContactIntervalPath(Array.from({ length: 20 }, () => ({ rawAngle: 0, intervals: wide })));
  assert.ok(result.angles.every(angle => Math.abs(angle) < 1e-12));
  assert.throws(() => solveContactIntervalPath([{ rawAngle: 0, intervals: [{ minimum: 1, maximum: -1 }] }]), /interval/);
  assert.throws(() => solveContactIntervalPath([{ rawAngle: NaN, intervals: wide }]), /frame/);
});
