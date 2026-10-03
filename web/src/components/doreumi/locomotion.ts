import { gaitUnitsPerSecond } from '@/lib/doreumi/motion-gait';
import { projectTravelPoint, sampleDoreumiTravel, stageTravelYaw, type DoreumiStageDecision, type DoreumiStageFrame, type DoreumiTravel } from '@/lib/doreumi/motion-travel';
import { chooseLedgeMotion, chooseTeeterSequence, glideFrom, holdFrom, ledgeApproach, ledgeStepPose, type LedgeMotion, type LedgeStepPlan, type LedgeStyle } from '@/lib/doreumi/motion-ledge';

export type LocomotionPhase = "idle" | "dragged" | "falling" | "landing" | "running" | "stepping" | "pausing";
export type WallSide = "left" | "right";
/** 턱: 그 위에 서는 화면 구간. top 은 턱 윗면의 화면 y(발이 닿는 선). 휴대폰 홈 바닥 줄의 링크 묶음이 이것이다. */
export type Ledge = { left: number; right: number; top: number };
export type MotionBounds = { width: number; height: number; viewportWidth: number; viewportHeight: number; occupiedBottom: number; ledges?: readonly Ledge[] };
/**
 * 턱 넘기 중인 상태. plan 은 경로, time 은 마지막으로 받은 동작 시각, waited 는 넘기를 시작한 뒤 흐른 시간(ms),
 * quiet 는 그 동작의 프레임이 마지막으로 온 뒤 흐른 시간(ms). 렌더러가 멈추면(그래픽 끊김 등) quiet 로 끝낸다.
 */
export type LedgeStepState = { plan: LedgeStepPlan; time: number; waited: number; quiet?: number };
/** 나들이: 턱 위로 올라가(out) 잠깐 놀고(pause) 자기 자리로 돌아온다(back). */
export type ExcursionState = { stage: "out" | "pause" | "back"; target: number; pauseAction: string; pauseMs: number };
export type MotionState = {
  x: number; y: number; vy: number; elapsed: number; phase: LocomotionPhase; side: WallSide;
  /** 달리는 방향(나들이에서 왼쪽으로 갈 때 자기 자리 side 와 다르다). 없으면 목적지 쪽. */
  heading?: WallSide;
  /** 달려갈 곳(상자 x). 없으면 자기 벽(side). */
  targetX?: number | null;
  step?: LedgeStepState | null;
  /** 다가가는 턱 가장자리와 고른 방식(가장자리에 닿기 전에 미리 정해 출발 거리를 맞춘다). */
  pendingStep?: { edge: number; motion: LedgeMotion } | null;
  excursion?: ExcursionState | null;
  /** 점프 찌그러짐·늘어남(가로, 세로). 넘기 동작 프레임에서만 있다. */
  squash?: readonly [number, number] | null;
};
// Master Run: .19 units of stance travel / (.45 seconds * .48 stance duty).
export const RUN_UNITS_PER_SECOND = gaitUnitsPerSecond('Run');
export const RUN_PLAYBACK_RATE = 2;
export const runPixelsPerSecond = (canvasHeight: number) => RUN_UNITS_PER_SECOND * canvasHeight / 2.68 * RUN_PLAYBACK_RATE;
export const floorY = (b: MotionBounds) => Math.max(0, b.viewportHeight - Math.max(0, b.occupiedBottom) - b.height);
/** The avatar box is wider than Doreumi's body, so resting "against the wall" lets the box pass the edge a little
 * (user direction 2026-09-26: 기본 위치를 더 측면에 붙게). CSS uses the same 11%. */
export const WALL_INSET_RATIO = .11;
export const wallInset = (width: number) => Math.round(width * WALL_INSET_RATIO);
export const wallX = (side: WallSide, b: MotionBounds) => side === "left" ? -wallInset(b.width) : Math.max(-wallInset(b.width), b.viewportWidth - b.width + wallInset(b.width));
export const nearestWall = (x: number, b: MotionBounds): WallSide => x + b.width / 2 < b.viewportWidth / 2 ? "left" : "right";
/** 놓았을 때 돌아갈 벽: 휴대폰은 어디서든 오른쪽, 넓은 화면은 가까운 쪽(사용자 지시 2026-10-01). */
export const homeWall = (x: number, b: MotionBounds, phone = false): WallSide => phone ? "right" : nearestWall(x, b);
const ledgeUnder = (center: number, b: MotionBounds) => b.ledges?.find(ledge => center >= ledge.left && center <= ledge.right) ?? null;
/** 몸 중심 x 에서 발이 닿는 화면 y: 턱 위면 턱 윗면, 아니면 바닥. */
export const surfaceAt = (center: number, b: MotionBounds) => ledgeUnder(center, b)?.top ?? b.viewportHeight - Math.max(0, b.occupiedBottom);
/** 상자 x 에서 서 있을 때의 상자 y. 턱이 없으면 floorY 와 같다. */
export const restYAt = (x: number, b: MotionBounds) => b.ledges?.length ? Math.max(0, surfaceAt(x + b.width / 2, b) - b.height) : floorY(b);
export function clampPosition(x: number, y: number, b: MotionBounds) {
  const cx = Math.max(wallX("left", b), Math.min(wallX("right", b), x));
  return { x: cx, y: Math.max(0, Math.min(restYAt(cx, b), y)) };
}
/**
 * 공연 이동(들여온 동작의 걸음)이 머무를 상자 x 범위: 지금 서 있는 바닥을 벗어나지 않는다.
 * 턱 위면 그 턱 안, 턱 사이 바닥이면 양옆 턱 사이(몸이 턱에 걸치지 않게 몸 폭 30% 여유). 지금 자리는 늘 범위 안이다.
 */
export function stageRange(x: number, b: MotionBounds): [number, number] {
  const lo = wallX("left", b), hi = wallX("right", b);
  if (!b.ledges?.length) return [lo, hi];
  const w = b.width, center = x + w / 2, margin = w * .3;
  const on = ledgeUnder(center, b);
  let left = -Infinity, right = Infinity;
  if (on) { left = on.left + margin; right = on.right - margin; }
  else for (const ledge of b.ledges) {
    if (ledge.right <= center) left = Math.max(left, ledge.right + margin);
    if (ledge.left >= center) right = Math.min(right, ledge.left - margin);
  }
  return [Math.max(lo, Math.min(x, left - w / 2)), Math.min(hi, Math.max(x, right - w / 2))];
}

/** 지금 몸 중심에서 진행 방향으로 처음 만나는 턱 가장자리(바닥 높이가 바뀌는 곳). 목적지 너머는 보지 않는다. */
function nextLedgeEdge(center: number, targetCenter: number, b: MotionBounds) {
  const dir = Math.sign(targetCenter - center);
  if (!dir || !b.ledges?.length) return null;
  let best: number | null = null;
  for (const ledge of b.ledges) for (const edge of [ledge.left, ledge.right]) {
    const ahead = (edge - center) * dir;
    if (ahead <= 0 || (targetCenter - edge) * dir <= 0) continue;
    if (Math.abs(surfaceAt(edge - dir * .5, b) - surfaceAt(edge + dir * .5, b)) < 1) continue;
    if (best === null || ahead < (best - center) * dir) best = edge;
  }
  return best;
}

/**
 * 떨어뜨린 몸이 턱 가장자리쯤(턱 위 몸 폭 24% 안쪽 ~ 바깥 12%)이면 휘청일 자리를 돌려준다.
 * 바깥이 화면 밖인 가장자리(턱 왼쪽 끝 0)는 빼고, 바깥이 더 낮은 가장자리만 본다.
 */
export function teeterSpot(center: number, b: MotionBounds) {
  const width = b.width, minCenter = wallX("left", b) + width / 2, maxCenter = wallX("right", b) + width / 2;
  for (const ledge of b.ledges ?? []) for (const [edge, dir] of [[ledge.right, 1], [ledge.left, -1]] as const) {
    const outside = edge + dir * width * .35;
    if (outside < minCenter || outside > maxCenter) continue;
    if (surfaceAt(edge + dir * .5, b) - ledge.top < 4) continue;
    const offset = (center - edge) * dir;
    if (offset >= -width * .24 && offset <= width * .12) return { edge, dir: dir as 1 | -1, top: ledge.top };
  }
  return null;
}

export type StepOptions = { random?: () => number; forcedStyle?: LedgeStyle | null };

export function stepLocomotion(state: MotionState, milliseconds: number, b: MotionBounds, reducedMotion = false, options: StepOptions = {}): MotionState {
  const dt = Math.max(0, Math.min(250, milliseconds)) / 1000;
  // 움직임 줄이기가 넘기 도중 켜지면 아래 분기에서 곧바로 자기 자리로 옮긴다.
  if (state.phase === "stepping" && !reducedMotion) return advanceStep(state, dt, b);
  const next: MotionState = { ...state, ...clampPosition(state.x, state.y, b) };
  if (state.phase === "idle" || state.phase === "dragged") return next;
  // 목적지는 늘 갈 수 있는 자리로 맞춘다(벽 너머 목적지에서 영원히 제자리 달리기 방지).
  const home = () => clampPosition(state.targetX ?? wallX(state.side, b), 0, b).x;
  if (reducedMotion) {
    // 움직임 줄이기: 넘기·나들이 없이 곧바로 자기 자리로.
    const x = wallX(state.side, b);
    return { ...next, x, y: restYAt(x, b), vy: 0, elapsed: 0, phase: "idle", step: null, pendingStep: null, excursion: null, targetX: null, heading: undefined };
  }
  if (state.phase === "falling") {
    // 턱 가장자리쯤에 떨어지면 턱 윗면에서 멈춰 휘청인다(이미 턱보다 아래에 있으면 그냥 아래 바닥으로).
    const spot = b.ledges?.length ? teeterSpot(next.x + b.width / 2, b) : null;
    const teeter = spot && state.y <= spot.top - b.height + 1 ? spot : null;
    const rest = teeter ? teeter.top - b.height : restYAt(next.x, b);
    next.y = Math.min(rest, next.y + next.vy * dt + 1600 * dt * dt);
    next.vy += 3200 * dt;
    if (next.y >= rest && teeter) {
      const [sway, outcome] = chooseTeeterSequence(options.random, options.forcedStyle);
      // 닿은 자리에서 휘청이기 시작해 발이 반쯤 걸친 자리로 스르르 옮겨 간다(착지 순간 옆으로 튀지 않게).
      const width = b.width, landed = (next.x + width / 2 - teeter.edge) * teeter.dir / width;
      const motion = glideFrom(sway, Math.max(-.24, Math.min(.12, landed)));
      const plan: LedgeStepPlan = { motion, dir: teeter.dir, edge: teeter.edge, from: teeter.top, to: teeter.top, width, height: b.height, then: [outcome] };
      return { ...next, y: teeter.top - b.height, vy: 0, elapsed: 0, phase: "stepping", step: { plan, time: 0, waited: 0 }, pendingStep: null };
    }
    if (next.y >= rest) { next.phase = "landing"; next.vy = 0; next.elapsed = 0; }
  } else if (state.phase === "landing") {
    next.y = restYAt(next.x, b); next.elapsed += dt * 1000;
    if (next.elapsed >= 650) { next.phase = "running"; next.elapsed = 0; }
  } else if (state.phase === "pausing") {
    next.y = restYAt(next.x, b); next.elapsed += dt * 1000;
    const trip = state.excursion;
    if (!trip || next.elapsed >= trip.pauseMs) {
      next.phase = "running"; next.elapsed = 0; next.targetX = null; next.heading = undefined;
      next.excursion = trip ? { ...trip, stage: "back" } : null;
    }
  } else {
    const target = home();
    const width = b.width, center = next.x + width / 2, targetCenter = target + width / 2;
    const dir: 1 | -1 = target >= next.x ? 1 : -1;
    next.heading = dir > 0 ? "right" : "left";
    next.y = restYAt(next.x, b);
    let pending = state.pendingStep ?? null;
    const edge = nextLedgeEdge(center, targetCenter, b);
    if (edge === null) pending = null;
    else if (!pending || pending.edge !== edge) {
      const down = surfaceAt(edge + dir * .5, b) > surfaceAt(edge - dir * .5, b);
      // 가장자리까지 남은 거리 안에서 출발할 수 있는 방식만 고른다(구르기는 0.75 폭 도움닫기가 필요하다).
      pending = { edge, motion: chooseLedgeMotion(down ? "down" : "up", options.random, options.forcedStyle, (edge - center) * dir / width) };
    }
    const step = runPixelsPerSecond(b.height) * dt;
    if (pending) {
      const approach = ledgeApproach(pending.motion, width), startCenter = pending.edge - dir * approach;
      const toStart = (startCenter - center) * dir;
      if (toStart <= step) {
        // 출발점에 닿았다: 그 자리에 서서 넘기 동작을 시작한다(화면 이동은 동작 시계를 따른다).
        // 이미 출발점을 지났으면 뒤로 순간이동하지 않고 지금 자리에서 출발한다. 가장자리는 실제 자리 그대로 두고
        // 도움닫기만 남은 거리로 줄인다(가장자리 너머 허공을 걷지 않게).
        const past = toStart < 0, begin = past ? center : startCenter;
        const motion = past ? holdFrom(pending.motion, -Math.max(0, (pending.edge - center) * dir) / width) : pending.motion;
        const from = surfaceAt(begin, b), to = surfaceAt(pending.edge + dir * .5, b);
        const plan: LedgeStepPlan = { motion, dir, edge: pending.edge, from, to, width, height: b.height };
        return { ...next, x: begin - width / 2, y: from - b.height, phase: "stepping", elapsed: 0, step: { plan, time: 0, waited: 0 }, pendingStep: null };
      }
      next.x += dir * Math.min(toStart, step);
      next.pendingStep = pending;
      next.y = restYAt(next.x, b);
      return next;
    }
    next.pendingStep = null;
    const distance = target - next.x;
    next.x += Math.sign(distance) * Math.min(Math.abs(distance), step);
    next.y = restYAt(next.x, b);
    if (Math.abs(distance) <= step) {
      const trip = state.excursion;
      if (trip?.stage === "out") { next.phase = "pausing"; next.elapsed = 0; next.excursion = { ...trip, stage: "pause" }; }
      else { next.phase = "idle"; next.excursion = null; next.targetX = null; next.heading = undefined; }
    }
  }
  return next;
}

/** 동작을 불러오지 못하면(오프라인 등) 이만큼 기다린 뒤 넘기를 마친 자리로 옮긴다. */
export const STEP_LOAD_TIMEOUT_MS = 2500;

/**
 * 넘기는 동작 시계(frame)로 움직이므로 여기서는 시간만 센다. 동작이 안 뜨거나 도중에 프레임이 끊기면(quiet) 끝내고,
 * 어떤 경우에도 동작 길이+여유를 넘기지 않는다. 그래야 그래픽이 멈춘 폰에서 매 프레임 계산이 끝없이 돌지 않는다.
 */
function advanceStep(state: MotionState, dt: number, b: MotionBounds): MotionState {
  const step = state.step;
  if (!step) return { ...state, phase: "running" };
  const waited = step.waited + dt * 1000, quiet = (step.quiet ?? 0) + dt * 1000;
  if (quiet >= STEP_LOAD_TIMEOUT_MS || waited >= step.plan.motion.duration * 1000 + STEP_LOAD_TIMEOUT_MS) return finishStep(state, b);
  return { ...state, step: { ...step, waited, quiet } };
}

/**
 * 넘기를 마치고 도착 바닥에서 다시 달린다. 이어서 할 동작(휘청임 → 결과)이 있으면 그 자리에서 다음 동작을 시작한다.
 * chain=false 는 끼어들기로 멈출 때(이어 하지 않고 지금 동작이 끝난 자리에 선다).
 */
export function finishStep(state: MotionState, b: MotionBounds, chain = true): MotionState {
  const plan = state.step?.plan;
  if (!plan) return { ...state, phase: "running", step: null };
  const end = ledgeStepPose(plan, plan.motion.duration, 0);
  const x = Math.max(wallX("left", b), Math.min(wallX("right", b), end.x));
  const [next, ...rest] = plan.then ?? [];
  if (chain && next) {
    const from = surfaceAt(plan.edge - plan.dir * .5, b), to = surfaceAt(plan.edge + plan.dir * .5, b);
    const nextPlan: LedgeStepPlan = { motion: next, dir: plan.dir, edge: plan.edge, from, to, width: plan.width, height: plan.height, then: rest };
    const start = ledgeStepPose(nextPlan, 0, 0);
    return { ...state, x: start.x, y: start.y, phase: "stepping", elapsed: 0, step: { plan: nextPlan, time: 0, waited: 0 }, pendingStep: null };
  }
  return { ...state, x, y: restYAt(x, b), phase: "running", elapsed: 0, step: null, pendingStep: null, squash: null };
}

/** 렌더러가 보낸 넘기 동작의 한 순간. 그 시각에 맞는 자리로 옮기고, 동작이 끝나면 다시 달린다. */
export function applyStepFrame(state: MotionState, action: string, time: number, pixelsPerUnit: number, b: MotionBounds): MotionState {
  const step = state.step;
  if (state.phase !== "stepping" || !step || !Number.isFinite(time)) return state;
  // 한 번 재생하는 동작이 끝나면 렌더러가 Idle 로 넘어간다: 이미 시작한 넘기면 끝난 것이다(시작 전 프레임은 기다린다).
  if (action !== step.plan.motion.action) return step.time > 0 ? finishStep(state, b) : state;
  // 반복 재생으로 시계가 처음으로 돌아가면 이미 끝난 것이다.
  if (step.time > 0 && time + 0.05 < step.time) return finishStep(state, b);
  const pose = ledgeStepPose(step.plan, time, pixelsPerUnit);
  // 구르기처럼 멀리 가는 동작도 벽을 넘지 않는다(넘었다 끝에서 되돌아 튀지 않게).
  const moved = { ...state, x: Math.max(wallX("left", b), Math.min(wallX("right", b), pose.x)), y: Math.max(0, pose.y), squash: pose.sx !== 1 || pose.sy !== 1 ? [pose.sx, pose.sy] as const : null, step: { ...step, time: Math.max(step.time, time, 1e-3), quiet: 0 } };
  return pose.done ? finishStep(moved, b) : moved;
}

/** 나들이를 시작할 수 있으면 상태를 돌려준다. 자기 자리(턱 밖)에서 쉬고 있고 턱 위에 설 자리가 있어야 한다. */
export function startExcursion(state: MotionState, b: MotionBounds, random: () => number = Math.random, pauseActions: readonly string[] = EXCURSION_PAUSES): MotionState | null {
  if (state.phase !== "idle" || !b.ledges?.length) return null;
  const width = b.width, center = state.x + width / 2;
  if (ledgeUnder(center, b)) return null;
  const ledge = b.ledges.reduce((best, item) => item.right > best.right ? item : best);
  const low = Math.max(ledge.left + width * .35, wallX("left", b) + width / 2 + 1), high = ledge.right - width * .55;
  if (high <= low) return null;
  const targetCenter = low + (high - low) * random();
  const [action, seconds] = pauseActions[Math.min(pauseActions.length - 1, Math.floor(random() * pauseActions.length))].split(":");
  return {
    ...state, phase: "running", elapsed: 0, targetX: targetCenter - width / 2, heading: "left", pendingStep: null, step: null,
    excursion: { stage: "out", target: targetCenter - width / 2, pauseAction: action, pauseMs: Math.round(Number(seconds) * 1000) },
  };
}
/** 턱 위에서 잠깐 하는 동작과 길이(초). 승인된 내장 동작만 쓴다. */
export const EXCURSION_PAUSES = ["Wave:3.6", "HeadTilt:4", "Cheer:4", "PeekLeft:5"] as const;

export type ImportedStageState = {
  action: string; yaw: number; x: number; originX: number; originTravel: number;
  pixelsPerUnit: number; time: number; blocked: boolean;
};

function chooseStageYaw(travel: DoreumiTravel, x: number, b: MotionBounds, pixelsPerUnit: number, time: number) {
  const [left, right] = stageRange(x, b), preferred = right - x >= x - left ? 'right' : 'left';
  const candidates = [preferred, preferred === 'right' ? 'left' : 'right'] as const;
  let best = stageTravelYaw(travel, preferred), minimumOverflow = Infinity;
  for (const side of candidates) {
    const yaw = stageTravelYaw(travel, side), origin = projectTravelPoint(sampleDoreumiTravel(travel, time), yaw);
    const projected = travel.positionsXZ.map((point, i) => travel.times[i] < time ? 0 : (projectTravelPoint(point, yaw) - origin) * pixelsPerUnit);
    const overflow = Math.max(0, left - x - Math.min(...projected)) + Math.max(0, x + Math.max(...projected) - right);
    if (overflow < minimumOverflow - .001) { minimumOverflow = overflow; best = yaw; }
  }
  return best;
}

/** Reject a performance before takeoff when neither direction has enough room. */
export function importedStageFits(travel: DoreumiTravel, x: number, b: MotionBounds, pixelsPerUnit: number) {
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) return false;
  const yaw = chooseStageYaw(travel, x, b, pixelsPerUnit, 0);
  const origin = projectTravelPoint(travel.positionsXZ[0], yaw), range = stageRange(x, b);
  return travel.positionsXZ.every(point => {
    const position = x + (projectTravelPoint(point, yaw) - origin) * pixelsPerUnit;
    return position >= range[0] && position <= range[1];
  });
}

/** One absolute sample from the renderer's animation clock. Repeating a frame,
 * pausing, or rendering at another FPS cannot accumulate extra screen travel. */
export function stepImportedStage(previous: ImportedStageState | null, frame: DoreumiStageFrame, b: MotionBounds, startX: number): { state: ImportedStageState | null; decision?: DoreumiStageDecision; moved: boolean } {
  if (!frame.travel || !/^meshy:\d+$/.test(frame.action) || !Number.isFinite(frame.time) || !Number.isFinite(frame.pixelsPerUnit) || frame.pixelsPerUnit <= 0) return { state: null, moved: false };
  if (frame.paused) { const current = previous?.action === frame.action ? previous : null; return { state: current, decision: current ? { yaw: current.yaw, stop: current.blocked || undefined } : undefined, moved: false }; }
  const x = clampPosition(previous?.x ?? startX, 0, b).x;
  let state = previous;
  if (!state || state.action !== frame.action) {
    const yaw = chooseStageYaw(frame.travel, x, b, frame.pixelsPerUnit, frame.time);
    state = { action: frame.action, yaw, x, originX: x, originTravel: projectTravelPoint(sampleDoreumiTravel(frame.travel, frame.time), yaw), pixelsPerUnit: frame.pixelsPerUnit, time: frame.time, blocked: false };
  } else if (state.blocked) return { state: { ...state, x }, decision: { yaw: state.yaw, stop: true }, moved: false };
  else if (frame.time < state.time - 1e-4 || Math.abs(x - state.x) > .001) {
    // A seek or viewport boundary change must not replay completed travel.
    state = { ...state, x, originX: x, originTravel: projectTravelPoint(sampleDoreumiTravel(frame.travel, frame.time), state.yaw), pixelsPerUnit: frame.pixelsPerUnit, time: frame.time };
  } else if (Math.abs(frame.pixelsPerUnit - state.pixelsPerUnit) > 1e-4) {
    // Camera framing eases over multiple rendered frames. Preserve this frame's
    // travel while applying the new scale only to future displacement.
    state = { ...state, x, originX: x, originTravel: projectTravelPoint(sampleDoreumiTravel(frame.travel, state.time), state.yaw), pixelsPerUnit: frame.pixelsPerUnit };
  }
  const desired = state.originX + (projectTravelPoint(sampleDoreumiTravel(frame.travel, frame.time), state.yaw) - state.originTravel) * frame.pixelsPerUnit;
  const [minX, maxX] = stageRange(state.originX, b);
  const nextX = Math.min(maxX, Math.max(minX, clampPosition(desired, 0, b).x)), blocked = Math.abs(nextX - desired) > .5;
  return { state: { ...state, x: nextX, time: frame.time, blocked }, decision: { yaw: state.yaw, stop: blocked || undefined }, moved: Math.abs(nextX - state.x) > .001 };
}
