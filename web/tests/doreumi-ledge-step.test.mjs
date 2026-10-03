import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const load = async entry => {
  const bundled = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
};
const L = await load('src/components/doreumi/locomotion.ts');
const M = await load('src/lib/doreumi/motion-ledge.ts');

// 390x844 휴대폰 홈 바닥 줄 실측(2026-10-01): 링크 묶음 18~281 · 줄 792~836, 도름이 상자 116x98.
const ledge = { left: 0, right: 283, top: 788 };
const b = { width: 116, height: 98, viewportWidth: 390, viewportHeight: 844, occupiedBottom: 12, ledges: [ledge] };
const base = 844 - 12; // 줄 바닥(발이 닿는 선)
const PPU = 98 / 2.68;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

/** 렌더러를 흉내 낸다: 넘기 중이면 그 동작의 시계를 16ms 씩 흘려 프레임을 보낸다. */
function simulate(state, { ms = 60_000, random = Math.random, forcedStyle = null, phone = true, record } = {}) {
  let clip = null;
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    state = L.stepLocomotion(state, 16, b, false, { random, forcedStyle });
    if (state.phase === 'stepping') {
      const action = state.step.plan.motion.action;
      if (!clip || clip.action !== action || clip.plan !== state.step.plan) clip = { action, plan: state.step.plan, time: 0 };
      else clip.time += .016;
      state = L.applyStepFrame(state, action, clip.time, PPU, b);
      record?.(state, clip);
    } else clip = null;
    if (state.phase === 'idle') return state;
  }
  void phone;
  return state;
}

test('턱 위와 줄 바닥은 몸 중심 x 로 갈린다', () => {
  assert.equal(L.surfaceAt(100, b), 788);
  assert.equal(L.surfaceAt(340, b), base);
  assert.equal(L.restYAt(0, b), 788 - 98);
  assert.equal(L.restYAt(L.wallX('right', b), b), base - 98);
  assert.equal(L.restYAt(L.wallX('right', { ...b, ledges: undefined }), { ...b, ledges: undefined }), L.floorY(b));
  // 턱 위에서는 턱 아래로 끌어내려지지 않는다.
  assert.equal(L.clampPosition(50, 800, b).y, 788 - 98);
  assert.equal(L.clampPosition(300, 800, b).y, base - 98);
});

test('휴대폰은 어디에 놓아도 오른쪽, 넓은 화면은 가까운 쪽', () => {
  assert.equal(L.homeWall(0, b, true), 'right');
  assert.equal(L.homeWall(0, b, false), 'left');
  assert.equal(L.homeWall(300, b, false), 'right');
});

test('구르기는 내려갈 때만, 방식은 무작위로 고르고 고정은 그 방향에 있을 때만', () => {
  assert.deepEqual(M.LEDGE_MOTIONS.down.map(m => m.style), ['jump', 'roll', 'crawl']);
  assert.deepEqual(M.LEDGE_MOTIONS.up.map(m => m.style), ['jump', 'crawl']);
  assert.equal(M.chooseLedgeMotion('up', () => .99, 'roll').style, 'crawl');
  assert.equal(M.chooseLedgeMotion('down', () => 0, 'roll').style, 'roll');
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(M.chooseLedgeMotion('down').style);
  assert.deepEqual([...seen].sort(), ['crawl', 'jump', 'roll']);
});

test('방식마다 출발 바닥에서 떠나 도착 바닥에 정확히 내려앉고, 몸이 가장자리를 넘는다', () => {
  for (const motion of [...M.LEDGE_MOTIONS.down, ...M.LEDGE_MOTIONS.up]) {
    const down = motion.direction === 'down';
    const plan = { motion, dir: down ? 1 : -1, edge: 283, from: down ? 788 : base, to: down ? base : 788, width: 116, height: 98 };
    const start = M.ledgeStepPose(plan, 0, PPU), end = M.ledgeStepPose(plan, motion.duration, PPU);
    near(start.feet, plan.from, .01, `${motion.action} 출발 발`);
    near(end.feet, plan.to, .01, `${motion.action} 도착 발`);
    near(end.y + 98, plan.to, 1, `${motion.action} 도착 상자 바닥(띄움 잔여 포함)`);
    assert.ok((start.center - 283) * plan.dir < 0, `${motion.action} 가장자리 앞에서 출발`);
    assert.ok((end.center - 283) * plan.dir >= 116 * .25, `${motion.action} 몸 반쯤이 가장자리를 넘어 착지`);
    for (let t = 0; t <= motion.duration; t += .02) {
      const pose = M.ledgeStepPose(plan, t, PPU);
      // 발은 낮은 바닥 아래로 파고들지 않고, 포물선 꼭대기보다 높이 뜨지 않는다.
      assert.ok(pose.feet <= Math.max(plan.from, plan.to) + .01, `${motion.action} t=${t.toFixed(2)} 바닥 관통`);
      assert.ok(pose.feet >= Math.min(plan.from, plan.to) - motion.apex * 98 - .01, `${motion.action} t=${t.toFixed(2)} 과한 도약`);
      // 동작이 몸을 띄우는 만큼 상자를 내려 발이 경로에 붙어 있다.
      near(pose.y + 98 - M.ledgeFloat(motion, t) * PPU, pose.feet, .01, `${motion.action} 띄움 상쇄`);
    }
  }
});

test('턱 위(글자 위)에 놓으면 턱 위에 착지해 오른쪽으로 달리다 내려가 자기 자리 바닥에 선다', () => {
  for (const style of ['jump', 'roll', 'crawl']) {
    let state = { x: 40, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
    let landed = null, stepped = null;
    state = simulate(state, {
      forcedStyle: style,
      record: s => { stepped ??= s.step.plan.motion; },
    });
    assert.equal(state.phase, 'idle', style);
    assert.equal(stepped.style, style);
    assert.equal(stepped.direction, 'down');
    assert.equal(state.x, L.wallX('right', b));
    assert.equal(state.y, base - 98, `${style} 줄 바닥에 섬`);
    void landed;
  }
});

test('착지는 그 자리 바닥에서 한다', () => {
  let state = { x: 40, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
  while (state.phase === 'falling') state = L.stepLocomotion(state, 16, b);
  assert.equal(state.phase, 'landing');
  assert.equal(state.y, 788 - 98);
  let right = { x: L.wallX('right', b), y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
  while (right.phase === 'falling') right = L.stepLocomotion(right, 16, b);
  assert.equal(right.y, base - 98);
});

test('나들이: 올라가 놀다 내려와 자기 자리로 돌아온다', () => {
  const home = { x: L.wallX('right', b), y: base - 98, vy: 0, elapsed: 0, phase: 'idle', side: 'right' };
  const rolls = [.5, 0];
  const random = () => rolls.shift() ?? .5;
  let state = L.startExcursion(home, b, random);
  assert.ok(state, '나들이 시작');
  assert.equal(state.phase, 'running');
  assert.equal(state.excursion.stage, 'out');
  assert.equal(state.excursion.pauseAction, 'Wave');
  const directions = [], phases = new Set();
  let paused = null;
  for (let elapsed = 0; elapsed < 90_000 && state.phase !== 'idle'; elapsed += 16) {
    const before = state.phase;
    state = L.stepLocomotion(state, 16, b);
    phases.add(state.phase);
    if (state.phase === 'stepping' && before !== 'stepping') directions.push(state.step.plan.motion.direction);
    if (state.phase === 'pausing') paused ??= { x: state.x, y: state.y };
    if (state.phase === 'stepping') {
      state.__t = (state.__t ?? -.016) + .016;
      const t = state.__t;
      state = L.applyStepFrame(state, state.step.plan.motion.action, t, PPU, b);
    }
  }
  assert.deepEqual(directions, ['up', 'down']);
  assert.ok(phases.has('pausing'));
  near(paused.y, 788 - 98, .5, '턱 위에서 논다');
  assert.ok(paused.x + 58 <= ledge.right - 116 * .5, '턱 위 안쪽에서 논다');
  assert.equal(state.phase, 'idle');
  assert.equal(state.excursion, null);
  assert.equal(state.x, L.wallX('right', b));
  assert.equal(state.y, base - 98);
});

test('나들이는 자기 자리에서만, 턱이 없으면 하지 않는다', () => {
  const home = { x: L.wallX('right', b), y: base - 98, vy: 0, elapsed: 0, phase: 'idle', side: 'right' };
  assert.equal(L.startExcursion({ ...home, phase: 'running' }, b), null);
  assert.equal(L.startExcursion(home, { ...b, ledges: [] }), null);
  assert.equal(L.startExcursion({ ...home, x: 20 }, b), null);
});

test('움직임 줄이기: 넘기·나들이 없이 곧바로 자기 자리 바닥으로', () => {
  const state = L.stepLocomotion({ x: 20, y: 400, vy: 0, elapsed: 0, phase: 'falling', side: 'right', excursion: { stage: 'out', target: 0, pauseAction: 'Wave', pauseMs: 1000 } }, 16, b, true);
  assert.equal(state.phase, 'idle');
  assert.equal(state.x, L.wallX('right', b));
  assert.equal(state.y, base - 98);
  assert.equal(state.excursion, null);
});

test('동작을 못 불러오면 기다리다 넘기를 마친 자리로 옮기고, 끝난 동작 뒤 Idle 프레임은 끝으로 본다', () => {
  const motion = M.LEDGE_MOTIONS.down[0];
  const plan = { motion, dir: 1, edge: 283, from: 788, to: base, width: 116, height: 98 };
  const stepping = { x: 200, y: 690, vy: 0, elapsed: 0, phase: 'stepping', side: 'right', step: { plan, time: 0, waited: 0 } };
  // 시작 전(다른 동작 프레임)은 기다린다.
  assert.equal(L.applyStepFrame(stepping, 'run-right', .5, PPU, b).phase, 'stepping');
  let waiting = stepping;
  for (let ms = 0; ms < L.STEP_LOAD_TIMEOUT_MS - 50; ms += 16) waiting = L.stepLocomotion(waiting, 16, b);
  assert.equal(waiting.phase, 'stepping');
  for (let ms = 0; ms < 100; ms += 16) waiting = L.stepLocomotion(waiting, 16, b);
  assert.equal(waiting.phase, 'running');
  assert.equal(waiting.y, base - 98);
  // 시작한 뒤 렌더러가 Idle 로 넘어가면 끝이다.
  const started = L.applyStepFrame(stepping, motion.action, 1, PPU, b);
  assert.equal(started.phase, 'stepping');
  const ended = L.applyStepFrame(started, 'Idle', .1, PPU, b);
  assert.equal(ended.phase, 'running');
  assert.equal(ended.y, base - 98);
});

test('공연 이동은 지금 서 있는 바닥을 벗어나지 않는다(턱 너머·턱 아래로 가지 않음)', () => {
  const home = L.wallX('right', b);
  const [lo, hi] = L.stageRange(home, b);
  assert.ok(lo + 58 >= ledge.right + 116 * .3 - .01, '자기 자리 바닥 안');
  assert.equal(hi, L.wallX('right', b));
  assert.deepEqual(L.stageRange(home, { ...b, ledges: [] }), [L.wallX('left', b), L.wallX('right', b)]);
  // 턱 위에서 쉬면(데스크톱) 그 턱 안에서만.
  const desk = { width: 140, height: 130, viewportWidth: 1280, viewportHeight: 860, occupiedBottom: 20, ledges: [{ left: 0, right: 446, top: 815 }, { left: 993, right: 1280, top: 815 }] };
  const right = L.wallX('right', desk), [dlo, dhi] = L.stageRange(right, desk);
  assert.ok(dlo + 70 >= 993 + 140 * .3 - .01 && dhi === right);
});

test('턱 가장자리쯤에 떨어뜨리면 바깥을 보며 휘청이고, 무작위로 폴짝 내려앉거나 꽈당 넘어진 뒤 자기 자리로 간다', () => {
  assert.ok(L.teeterSpot(283 - 10, b));
  assert.ok(L.teeterSpot(283 + 10, b));
  assert.equal(L.teeterSpot(150, b), null);
  assert.equal(L.teeterSpot(20, b), null, '화면 밖으로 떨어지는 왼쪽 끝은 휘청이지 않는다');
  for (const forced of ['hop', 'topple']) {
    let state = { x: 283 - 58 - 5, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
    const motions = [];
    let lyingClear = true;
    state = simulate(state, {
      forcedStyle: forced,
      record: (s, clip) => {
        const m = s.step?.plan.motion;
        if (m && motions.at(-1) !== m.action) motions.push(m.action);
        if (m?.style === 'topple' && clip.time >= 1.15 && clip.time <= 1.8) lyingClear &&= s.x + 58 >= 283 + 116 * .2;
      },
    });
    assert.ok(['meshy:503', 'meshy:390'].includes(motions[0]), `${forced} 휘청임 먼저: ${motions}`);
    assert.equal(motions[1], forced === 'hop' ? 'meshy:417' : 'meshy:502');
    assert.ok(lyingClear, '누운 몸이 글자 위에 걸치지 않는다');
    assert.equal(state.phase, 'idle');
    assert.equal(state.x, L.wallX('right', b));
    assert.equal(state.y, base - 98);
  }
  // 무작위: 두 결과가 다 나온다.
  const outcomes = new Set();
  for (let i = 0; i < 200; i++) outcomes.add(M.chooseTeeterSequence()[1].style);
  assert.deepEqual([...outcomes].sort(), ['hop', 'topple']);
});

test('휘청이는 동안 발은 턱 윗면에 붙어 있고, 끼어들기로 멈추면 턱 위에 선다', () => {
  let state = { x: 283 - 58 - 5, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
  while (state.phase === 'falling') state = L.stepLocomotion(state, 16, b, false, { forcedStyle: 'topple' });
  assert.equal(state.phase, 'stepping');
  assert.equal(state.step.plan.dir, 1);
  for (let t = 0; t <= 2; t += .1) {
    state = L.applyStepFrame(state, state.step.plan.motion.action, t, PPU, b);
    near(state.y + 98 - M.ledgeFloat(state.step.plan.motion, t) * PPU, 788, .01, `휘청임 t=${t.toFixed(1)}`);
  }
  const stopped = L.finishStep(state, b, false);
  assert.equal(stopped.phase, 'running');
  assert.equal(stopped.y, 788 - 98, '이어 하지 않고 턱 위에 선다');
});

test('넘기 도중 프레임이 끊기거나 움직임 줄이기가 켜지면 넘기를 끝낸다(끝없는 계산 방지)', () => {
  const motion = M.LEDGE_MOTIONS.down[0];
  const plan = { motion, dir: 1, edge: 283, from: 788, to: base, width: 116, height: 98 };
  let state = { x: 200, y: 690, vy: 0, elapsed: 0, phase: 'stepping', side: 'right', step: { plan, time: 0, waited: 0 } };
  for (let t = 0; t < 1; t += .1) state = L.applyStepFrame(state, motion.action, t, PPU, b);
  // 프레임이 끊긴 채 틱만 돈다.
  let ms = 0;
  while (state.phase === 'stepping' && ms < 60_000) { state = L.stepLocomotion(state, 16, b); ms += 16; }
  assert.ok(ms <= L.STEP_LOAD_TIMEOUT_MS + 32, `끊긴 뒤 ${ms}ms 만에 끝`);
  assert.equal(state.phase, 'running');
  // 계속 프레임이 와도 동작 길이+여유 안에서 끝난다.
  let steady = { x: 200, y: 690, vy: 0, elapsed: 0, phase: 'stepping', side: 'right', step: { plan, time: 0, waited: 0 } };
  for (let i = 0; i < 2000 && steady.phase === 'stepping'; i++) { steady = L.stepLocomotion(steady, 16, b); steady = L.applyStepFrame(steady, motion.action, .5, PPU, b); }
  assert.notEqual(steady.phase, 'stepping');
  // 움직임 줄이기
  const reduced = L.stepLocomotion({ x: 200, y: 690, vy: 0, elapsed: 0, phase: 'stepping', side: 'right', step: { plan, time: 1, waited: 100 } }, 16, b, true);
  assert.equal(reduced.phase, 'idle');
  assert.equal(reduced.x, L.wallX('right', b));
  assert.equal(reduced.y, base - 98);
  assert.equal(reduced.step, null);
});

test('나들이 목적지가 아무리 왼쪽이어도 도착해서 놀고 돌아온다(벽 너머 목적지로 영원히 달리지 않음)', () => {
  for (const width of [390, 360, 430]) {
    const bb = { ...b, viewportWidth: width };
    const home = { x: L.wallX('right', bb), y: base - 98, vy: 0, elapsed: 0, phase: 'idle', side: 'right' };
    let state = L.startExcursion(home, bb, () => 0);
    assert.ok(state.targetX >= L.wallX('left', bb), `${width}: 목적지가 벽 안`);
    let ms = 0;
    while (state.phase !== 'idle' && ms < 60_000) {
      state = L.stepLocomotion(state, 16, bb);
      if (state.phase === 'stepping') { state.__t = (state.__t ?? -.016) + .016; state = L.applyStepFrame(state, state.step.plan.motion.action, state.__t, PPU, bb); }
      ms += 16;
    }
    assert.equal(state.phase, 'idle', `${width}: 끝남 (${ms}ms)`);
    assert.equal(state.x, L.wallX('right', bb));
  }
});

test('넘기 출발점을 이미 지나 있으면 뒤로 순간이동하지 않고 남은 거리에 맞는 방식으로 넘는다', () => {
  for (const offset of [-.1, -.3, -.5, -.6]) {
    for (const seed of [0, .4, .99]) {
      const center = 283 + offset * 116;
      let state = { x: center - 58, y: 788 - 98, vy: 0, elapsed: 0, phase: 'running', side: 'right' };
      const before = state.x;
      while (state.phase === 'running') state = L.stepLocomotion(state, 16, b, false, { random: () => seed });
      assert.equal(state.phase, 'stepping');
      assert.ok(state.x >= before - .01, `offset ${offset} seed ${seed}: ${before} -> ${state.x}`);
      const approach = M.ledgeApproach(state.step.plan.motion, 116);
      assert.ok(approach <= Math.max(-offset * 116, .18 * 116) + .01, `도움닫기 ${approach} 가 남은 거리 안`);
    }
  }
});

test('구르기 착지는 자기 자리를 지나쳤다 되돌아 튀지 않는다', () => {
  let state = { x: 40, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
  let maxX = -Infinity, jump = 0, last = null;
  state = simulate(state, { forcedStyle: 'roll', record: s => { maxX = Math.max(maxX, s.x); if (last !== null) jump = Math.max(jump, last - s.x); last = s.x; } });
  assert.ok(maxX <= L.wallX('right', b) + .01, `최대 ${maxX}`);
  assert.equal(state.x, L.wallX('right', b));
});

test('휘청임은 닿은 자리에서 시작하고(옆으로 튀지 않음), 가장자리 바로 앞 내려가기는 허공을 걷지 않는다', () => {
  for (const offset of [-.23, -.1, 0, .05, .11]) {
    let state = { x: 283 + offset * 116 - 58, y: 300, vy: 0, elapsed: 0, phase: 'falling', side: 'right' };
    let before = state.x;
    while (state.phase === 'falling') { before = state.x; state = L.stepLocomotion(state, 16, b, false, { forcedStyle: 'hop' }); }
    assert.equal(state.phase, 'stepping', `offset ${offset}`);
    near(state.x, before, .01, `휘청임 시작 자리 offset ${offset}`);
    const first = L.applyStepFrame(state, state.step.plan.motion.action, 0, PPU, b);
    near(first.x, before, .5, `첫 프레임 자리 offset ${offset}`);
  }
  // 가장자리 -0.02w 에서 내려가기 시작: 발이 턱 높이인 동안 몸 중심이 가장자리를 크게 넘지 않는다.
  let state = { x: 283 - .02 * 116 - 58, y: 788 - 98, vy: 0, elapsed: 0, phase: 'running', side: 'right' };
  while (state.phase === 'running') state = L.stepLocomotion(state, 16, b, false, { random: () => .99 });
  assert.equal(state.step.plan.edge, 283, '가장자리는 실제 자리');
  let worst = 0;
  for (let t = 0; t <= state.step.plan.motion.duration; t += .02) {
    const pose = M.ledgeStepPose(state.step.plan, t, PPU);
    if (pose.feet <= 788 + .5) worst = Math.max(worst, pose.center - 283);
  }
  assert.ok(worst <= 116 * .12, `턱 높이에서 가장자리 너머 ${worst.toFixed(1)}px`);
});

test('점프는 중력 포물선 한 번으로 내려앉는다(중간에 멈칫 없음), 턱만 짧게 넘는다', () => {
  for (const motion of [M.LEDGE_MOTIONS.down[0], M.LEDGE_MOTIONS.up[0]]) {
    assert.ok(motion.jump, `${motion.action} 는 중력 점프`);
    const down = motion.direction === 'down';
    const plan = { motion, dir: 1, edge: 283, from: down ? 808 : 825, to: down ? 825 : 808, width: 116, height: 98 };
    const { takeoff, land } = motion.jump;
    const ys = [], xs = [];
    for (let t = takeoff; t <= land + 1e-9; t += .01) { const p = M.ledgeStepPose(plan, t, PPU); ys.push(p.feet); xs.push(p.center); }
    // 세로 가속도(두 번 차분)가 일정하다 = 한 번의 포물선.
    const acc = ys.slice(2).map((y, i) => y - 2 * ys[i + 1] + ys[i]);
    const spread = Math.max(...acc) - Math.min(...acc);
    assert.ok(acc.every(a => a > 0) && spread < 1e-6, `${motion.action} 가속도 일정 (${spread})`);
    // 꼭짓점을 지나면 내려가기만 한다(멈칫·두 번 오르기 없음).
    const peak = ys.indexOf(Math.min(...ys));
    for (let i = peak + 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1] - 1e-9, `${motion.action} 꼭짓점 뒤 되오름`);
    // 공중 가로 속도 일정.
    const dx = xs.slice(1).map((x, i) => x - xs[i]);
    assert.ok(Math.max(...dx) - Math.min(...dx) < 1e-6, `${motion.action} 가로 속도 일정`);
    // 짧게: 공중 가로 거리는 상자 폭의 절반 안쪽, 꼭짓점은 높은 바닥보다 8px 이하 위.
    assert.ok(xs.at(-1) - xs[0] <= 116 * .55, `${motion.action} 가로 ${xs.at(-1) - xs[0]}`);
    assert.ok(Math.min(808, 825) - Math.min(...ys) <= 8, `${motion.action} 꼭짓점 높이`);
    // 착지에 찌그러짐이 있다.
    const squash = M.ledgeStepPose(plan, land + .14, PPU);
    assert.ok(squash.sy < .95 && squash.sx > 1, `${motion.action} 착지 찌그러짐`);
  }
});
