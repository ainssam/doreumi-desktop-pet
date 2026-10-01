import test from 'node:test';
import assert from 'node:assert/strict';
import { integratePhaseAwareTravel } from '../scripts/doreumi/meshy-phase-travel.mjs';
import { parseDoreumiTravel } from '../src/lib/doreumi/motion-travel.ts';

const foot = (x, y = .002) => [[x, y, 0], [x + .1, y, .1]];
const input = (sourceFeet, targetFeet) => ({ times: [0, .1, .2], sourceFeet, targetFeet,
  sourceRoots: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], legRatio: 1, sourceFloor: .002,
  targetVertexIds: { L: [101, 102], R: [201, 202] }, sourceVertexIds: { L: [1, 2], R: [3, 4] } });

test('source skin stability selects the planted foot even when a moving foot is lower', () => {
  const source = [0, .1, .2].map(x => ({ L: foot(0, .009), R: foot(1 + x) }));
  const target = [0, .1, .2].map(x => ({ L: foot(x, .009), R: foot(1 - x) }));
  const result = integratePhaseAwareTravel(input(source, target));
  assert.deepEqual(result.positions, [[0, 0], [-.1, 0], [-.2, 0]]);
  assert.deepEqual(result.supports, ['L', 'L']);
  assert.equal(result.phases.length, 1); assert.equal(result.phases[0].vertex, 101);
  assert.equal(result.phases[0].sourceVertex, 1); assert.equal(result.phases[0].end, .2);
});

test('the next source-planted foot takes support without target-height hysteresis', () => {
  const source = [{ L: foot(0), R: foot(1, .008) }, { L: foot(0), R: foot(1.2, .008) }, { L: foot(.1), R: foot(1.2, .008) }];
  const target = [{ L: foot(0), R: foot(1, .008) }, { L: foot(.1), R: foot(.8, .008) }, { L: foot(.3), R: foot(.7, .008) }];
  const result = integratePhaseAwareTravel(input(source, target));
  assert.deepEqual(result.supports, ['L', 'R']);
  assert.ok(Math.abs(result.positions.at(-1)[0]) < 1e-9);
  assert.deepEqual(result.phases.map(phase => [phase.start, phase.end, phase.side]), [[0, .1, 'L'], [.1, .2, 'R']]);
});

test('rolling to another target material point uses that same point at both endpoints', () => {
  const source = [0, 1, 2].map(() => ({ L: foot(0), R: foot(1, 1) }));
  const target = [0, 1, 2].map(i => ({ L: [[i * .1, i ? .04 : .002, 0], [100 + i * .1, .004, 0]], R: foot(1, 1) }));
  const result = integratePhaseAwareTravel(input(source, target));
  assert.ok(Math.abs(result.positions.at(-1)[0] + .2) < 1e-9);
  assert.equal(result.phases[0].vertex, 102);
});

test('source glides retain their actual motion and do not become planted QA intervals', () => {
  const source = [0, .04, .08].map(x => ({ L: foot(x), R: foot(1, 1) }));
  const target = [0, .1, .2].map(x => ({ L: foot(x), R: foot(1, 1) }));
  const data = input(source, target); data.legRatio = .5;
  const result = integratePhaseAwareTravel(data);
  assert.ok(Math.abs(result.positions.at(-1)[0] + .16) < 1e-9);
  assert.equal(result.evidence.movingContactPairs, 2); assert.equal(result.phases.length, 0);
});

test('a source-planted but floating target is reported instead of becoming fabricated contact evidence', () => {
  const source = [0, 1, 2].map(() => ({ L: foot(0), R: foot(1, 1) }));
  const target = [0, 1, 2].map(() => ({ L: foot(0, .08), R: foot(1, 1) }));
  const result = integratePhaseAwareTravel(input(source, target));
  assert.equal(result.evidence.sourcePlantedPairs, 2);
  assert.equal(result.evidence.missingTargetContactPairs, 2);
  assert.equal(result.phases.length, 0);
});

const validTravel = () => ({ version: 1, source: 'target-stance', times: [0, 1], positionsXZ: [[0, 0], [1, 0]], direction: [1, 0],
  contactEvidence: { version: 1, basis: 'source-and-target-skin', mesh: 'Doreumi', vertexCount: 78799,
    sourceFloor: .08, sourceTolerance: .04, targetFloor: .002, targetTolerance: .012, stationarySpeed: .15,
    phases: [{ start: .2, end: .8, side: 'L', vertex: 68042, sourceVertex: 18514, sourceMaxSpeed: .02, sourceMaxHeight: .01, targetMaxHeight: .004 }] } });

test('runtime parser retains measured contact phases and rejects unsafe vertex references or false evidence', () => {
  const valid = validTravel(); assert.deepEqual(parseDoreumiTravel(valid, 1), valid);
  for (const change of [
    value => { value.contactEvidence.phases[0].vertex = 78799; },
    value => { value.contactEvidence.phases[0].vertex = -1; },
    value => { value.contactEvidence.phases[0].sourceMaxSpeed = .3; },
    value => { value.contactEvidence.phases[0].targetMaxHeight = .08; },
    value => { value.contactEvidence.phases[0].end = 1.1; },
    value => { value.contactEvidence.phases.push({ ...value.contactEvidence.phases[0], start: .7, end: .9 }); },
  ]) {
    const invalid = validTravel(); change(invalid); assert.throws(() => parseDoreumiTravel(invalid, 1), /skin contact/);
  }
});
