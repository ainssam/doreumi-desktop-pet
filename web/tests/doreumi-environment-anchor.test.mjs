import test from 'node:test';
import assert from 'node:assert/strict';
import { stepEnvironmentAnchor } from '../src/lib/doreumi/motion-environment-anchor.ts';

test('fixed environment retains its actual page origin and cancels on page movement', () => {
  const first = stepEnvironmentAnchor(null, 'meshy:439', 1124, 766, true);
  assert.equal(first.cancelled, false);
  assert.deepEqual(stepEnvironmentAnchor(first, 'meshy:439', 1124.3, 766.2, true), first);
  const moved = stepEnvironmentAnchor(first, 'meshy:439', 1125, 766, true);
  assert.equal(moved.cancelled, true);
  assert.equal(stepEnvironmentAnchor(moved, 'meshy:439', 1124, 766, true).cancelled, true);
  assert.equal(stepEnvironmentAnchor(moved, null, 1124, 766, true), null);
  assert.equal(stepEnvironmentAnchor(moved, 'meshy:619', 1125, 766, true).cancelled, false);
});

test('dragging, obstruction, or invalid origin cannot carry a fixed environment', () => {
  assert.equal(stepEnvironmentAnchor(null, 'meshy:439', 0, 0, false).cancelled, true);
  assert.equal(stepEnvironmentAnchor(null, 'meshy:439', NaN, 0, true).cancelled, true);
  assert.equal(stepEnvironmentAnchor(null, 'meshy:439', 0, Infinity, true).cancelled, true);
});
