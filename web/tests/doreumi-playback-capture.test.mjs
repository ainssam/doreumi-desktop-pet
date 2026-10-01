import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual browser callback, not a parallel copy of its completion rule.
const source = fs.readFileSync(new URL('../scripts/doreumi/motion-qa.mjs', import.meta.url), 'utf8');
const start = source.indexOf('await page.evaluate(({ id, duration, rate }) => {');
const end = source.indexOf('}, { id: action.id, duration: action.duration, rate: playbackRate });', start);
const callback = source.slice(start + 'await page.evaluate('.length, end + 1);
function capture({ duration = 2, rate = 1 } = {}) {
  let now = 0, state = { action: 'meshy:591', time: 0, activeActions: 1, pending: null };
  const window = { __DOREUMI_QA__: { seek() {}, play() {}, inspect: () => ({ ...state }) } };
  const context = vm.createContext({ window, performance: { now: () => now } });
  vm.runInContext(`(${callback})(${JSON.stringify({ id: 'meshy:591', duration, rate })})`, context);
  return { run: window.__DOREUMI_PLAYBACK_RUN__, frame(time, values, canvas = { width: 128, height: 128, toDataURL: () => 'data:image/png;base64,AA==' }) {
    now = time * 1000; state = { ...state, ...values }; window.__DOREUMI_CAMERA_CAPTURE__?.(canvas);
  } };
}
function sourceFrames(c, duration = 2, rate = 1) {
  for (let time = 0; time < duration; time += .25) c.frame(time / rate, { action: 'meshy:591', time });
}
test('capture includes two real seconds after stable Idle and complete source coverage', () => {
  for (const rate of [1, .25]) {
    const c = capture({ rate }); sourceFrames(c, 2, rate);
    c.frame(2 / rate, { action: 'Idle', time: .05, activeActions: 2 });
    assert.equal(c.run.done, false);
    c.frame(2.5 / rate, { action: 'Idle', time: .55, activeActions: 1 });
    assert.equal(c.run.done, false);
    c.frame(2.5 / rate + 1.75, { time: .55 + 1.75 * rate });
    assert.equal(c.run.done, false);
    c.frame(2.5 / rate + 2, { time: .55 + 2 * rate });
    assert.equal(c.run.done, true); assert.equal(c.run.error, null);
    assert.equal(c.run.coverage.observedFrames, 8); assert.equal(c.run.coverage.firstTime, 0);
    assert.equal(c.run.coverage.lastTime, 1.75); assert.equal(c.run.coverage.monotonic, true);
    assert.equal(c.run.coverage.stableIdleAt, 2.5 / rate); assert.equal(c.run.coverage.settledIdleSeconds, 2);
  }
});
test('early cancellation, skipped beginning, backward clock and nonfinite time cannot pass', () => {
  for (const times of [[0, .25], [.25, .5, 1, 1.75], [0, .5, .25, 1.75], [0, NaN, 1.75]]) {
    const c = capture(); times.forEach((time, index) => c.frame(index * .3, { action: 'meshy:591', time }));
    c.frame(3, { action: 'Idle', time: 1, activeActions: 1 });
    c.frame(5, { action: 'Idle', time: 3, activeActions: 1 });
    assert.equal(c.run.done, true); assert.match(c.run.error, /did not cover/);
  }
});
test('a changed action resets the stable Idle tail clock', () => {
  const c = capture(); sourceFrames(c);
  c.frame(2.5, { action: 'Idle', time: .5, activeActions: 1 });
  c.frame(4, { action: 'Think', time: 0 });
  c.frame(4.5, { action: 'Idle', time: 0 });
  c.frame(6.25, { time: 1.75 }); assert.equal(c.run.done, false);
  c.frame(6.5, { time: 2 }); assert.equal(c.run.done, true);
  assert.equal(c.run.coverage.stableIdleAt, 4.5); assert.equal(c.run.coverage.settledIdleSeconds, 2);
});
test('an all-Idle run never passes and invalid dimensions stop with explicit failure', () => {
  const idle = capture(); for (let i = 0; i < 20; i++) idle.frame(i, { action: 'Idle', time: i });
  assert.equal(idle.run.done, false); assert.equal(idle.run.coverage, null);
  const invalid = capture(); invalid.frame(0, {}, { width: 0, height: 128 });
  assert.equal(invalid.run.done, true); assert.match(invalid.run.error, /dimensions/);
});
test('capture buffers are bounded and invalid playback rates fail before recording', () => {
  const c = capture(); for (let i = 0; i <= 1000; i++) c.frame(i, { action: 'meshy:591', time: 0 });
  assert.equal(c.run.frames.length, 1000); assert.equal(c.run.done, true); assert.match(c.run.error, /1000 frames/);
  for (const rate of [0, -1, 4, Infinity]) assert.throws(() => capture({ rate }), /capture clock/);
});
