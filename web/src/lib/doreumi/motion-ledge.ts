/**
 * 턱 넘기: 휴대폰 홈 바닥 줄에서 도름이가 링크 묶음 위(턱)와 자기 자리(줄 바닥) 사이를 오갈 때 쓰는 동작과 이동 경로
 * (사용자 지시 2026-10-01 "그 턱을 점프하거나 구르거나 기어서 내려가고 올라가게 랜덤하게", 구르기는 내려갈 때만).
 *
 * 들여온 동작은 수평 이동이 지워져 있어(호스트가 화면 이동을 맡는다) 여기서 동작 시계에 맞춘 경로를 준다.
 * - x: 동작 시각별 몸 중심 위치(턱 가장자리 기준, 상자 폭 단위, +는 진행 방향).
 * - feet: 동작 시각별 발이 가는 길(0 = 출발 바닥, 1 = 도착 바닥). 사이 구간은 부드럽게 잇는다.
 * - float: 동작 자체가 몸을 띄우는 높이(모델 단위, 0.1초 간격). 2026-10-01 /dev/doreumi-motion 의
 *   inspect().bodyWorldBounds.min[1] 로 잰 값(마스터 ff950b38). 이만큼 상자를 내려 발이 늘 feet 경로 위에 있게 한다.
 * - apex: 점프·다이빙의 포물선 높이(상자 높이 비율). 출발·도착 중 높은 바닥 위로 그만큼 솟는다.
 * - settle: 다시 똑바로 선 시각. 여기서 넘기를 마치고 달리기로 잇는다(착지 뒤 옆모습으로 오래 서 있지 않게).
 * - jump: 점프는 키 대신 중력으로 움직인다(사용자 지시 2026-10-01 "진짜로 점프하는 듯한 움직임과 중력", "어설프게 짧게
 *   점프하면서 간신히 한번에"). 이륙~착지 사이 발은 g 가 일정한 포물선(출발 바닥 → 꼭짓점 → 도착 바닥)을, 몸은 일정한
 *   가로 속도로 한 번에 날아간다. 웅크림·이륙·착지에 찌그러짐(squash)·늘어남(stretch)을 더해 무게감을 준다.
 */

export type LedgeDirection = 'down' | 'up';
export type LedgeStyle = 'jump' | 'roll' | 'crawl' | 'hop' | 'topple';
type Keys = readonly (readonly [number, number])[];
export type LedgeMotion = {
  direction: LedgeDirection; style: LedgeStyle; action: string; duration: number;
  x: Keys; feet: Keys; apex: number; settle: number; float: readonly number[];
  jump?: { takeoff: number; land: number };
};

const FLOAT_STEP = 0.1;

/** 내려갈 때: 점프(470 뛰어내리기)·구르기(459 달려 뛰어 구르기)·기어 내려가기(486 걸터앉아 미끄러져 내리기). */
/**
 * 417 Hop_with_Arms_Raised: 가장자리에서 잠깐 머뭇하다 살짝 웅크리고, 두 팔을 번쩍 들어 균형을 잡으며 작게 톡 뛰어(1.55~2.15초)
 * 무릎을 굽혀 내려앉는다. "어설프게 짧게 점프하면서 간신히 한번에"(사용자 지시 2026-10-01). 467 은 공중 자세가 다이빙처럼 누워서 뺐다.
 */
const HOP_FLOAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.003, 0.001, 0, 0, 0.03, 0.099, 0.128, 0.121, 0.074, 0.009, 0, 0, 0, 0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
const HOP = { action: 'meshy:417', duration: 3.933, settle: 2.6, apex: 0.06, float: HOP_FLOAT, jump: { takeoff: 1.55, land: 2.15 } } as const;
const DOWN_JUMP: LedgeMotion = {
  direction: 'down', style: 'jump', ...HOP,
  x: [[0, -0.09], [1.3, -0.09], [1.55, -0.07], [2.15, 0.26], [2.4, 0.29], [3.933, 0.29]],
  feet: [[0, 0], [1.55, 0], [2.15, 1], [3.933, 1]],
};
const DOWN_ROLL: LedgeMotion = {
  direction: 'down', style: 'roll', action: 'meshy:459', duration: 5,
  x: [[0, -0.75], [0.2, -0.75], [1.55, -0.12], [2.5, 0.45], [3.1, 0.62], [5, 0.62]],
  feet: [[0, 0], [1.58, 0], [1.95, 0.2], [2.25, 0.65], [2.5, 1], [5, 1]],
  apex: 0.1,
  settle: 4.2,
  float: [0, 0.001, 0.003, 0.006, 0.011, 0.014, 0.017, 0.018, 0.019, 0.02, 0.017, 0.016, 0.017, 0.028, 0.019, 0.031, 0.053, 0.105, 0.2, 0.232, 0.412, 0.386, 0.458, 0.425, 0.234, 0.026, 0.01, 0, 0, 0, 0, 0.002, 0.017, 0.017, 0.005, 0.012, 0.014, 0.016, 0.016, 0.017, 0.016, 0.016, 0.015, 0.013, 0.011, 0.009, 0.006, 0.003, 0.002, 0, 0],
};
const DOWN_CRAWL: LedgeMotion = {
  direction: 'down', style: 'crawl', action: 'meshy:486', duration: 2.767,
  x: [[0, -0.18], [0.3, -0.18], [1.1, 0.1], [1.6, 0.4], [2.767, 0.4]],
  feet: [[0, 0], [0.95, 0], [1.25, 0.4], [1.6, 1], [2.767, 1]],
  apex: 0,
  settle: 2.4,
  float: [0, 0.009, 0.032, 0.066, 0.107, 0.15, 0.191, 0.225, 0.248, 0.257, 0.261, 0.267, 0.22, 0.11, 0.054, 0.037, 0.02, 0.002, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
/** 올라갈 때: 점프(내장 Jump)·기어오르기(474 두 손 짚고 뛰어오르기). */
const UP_JUMP: LedgeMotion = {
  direction: 'up', style: 'jump', ...HOP,
  x: [[0, -0.26], [1.3, -0.26], [1.55, -0.24], [2.15, 0.22], [2.4, 0.25], [3.933, 0.25]],
  feet: [[0, 0], [1.55, 0], [2.15, 1], [3.933, 1]],
};
const UP_CRAWL: LedgeMotion = {
  direction: 'up', style: 'crawl', action: 'meshy:474', duration: 3.633,
  x: [[0, -0.3], [1.3, -0.3], [1.85, 0.3], [3.633, 0.3]],
  feet: [[0, 0], [1.3, 0], [1.6, 0.75], [1.82, 1], [3.633, 1]],
  apex: 0.06,
  settle: 3.4,
  float: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.086, 0.19, 0.287, 0.363, 0.42, 0.382, 0.346, 0.344, 0.346, 0.347, 0.348, 0.348, 0.345, 0.331, 0.304, 0.266, 0.221, 0.172, 0.125, 0.079, 0.042, 0.015, 0.001],
};

/**
 * 턱 가장자리에 떨어뜨리면: 한 발로 중심을 잡듯 휘청이다가(503 팔 휘저으며 기우뚱 · 390 앞뒤로 기우뚱) 무작위로
 * 아래로 폴짝 내려앉거나(내장 Jump) 앞으로 꽈당 넘어진다(502). 사용자 지시 2026-10-01 "경계쯤 떨어뜨리면 한발로 중심
 * 잡듯이 하다가 아래쪽으로 착지하기도 하고 자빠지기도 하게해 랜덤하게". 휘청일 때는 바깥(낮은 쪽)을 본다.
 */
const EDGE_STANCE = -0.08;
const TEETER_FLAIL: LedgeMotion = {
  direction: 'down', style: 'jump', action: 'meshy:503', duration: 2.5,
  x: [[0, EDGE_STANCE], [2.5, EDGE_STANCE]], feet: [[0, 0], [2.5, 0]], apex: 0, settle: 2.3,
  float: [0, 0, 0, 0, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0, 0, 0.001, 0, 0.001, 0, 0, 0, 0, 0, 0, 0, 0],
};
const TEETER_SWAY: LedgeMotion = {
  direction: 'down', style: 'jump', action: 'meshy:390', duration: 3.433,
  x: [[0, EDGE_STANCE], [3.433, EDGE_STANCE]], feet: [[0, 0], [3.433, 0]], apex: 0, settle: 3.3,
  float: [0, 0, 0, 0, 0, 0, 0.001, 0, 0.002, 0.003, 0.005, 0.003, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 0, 0, 0, 0.001, 0.002, 0.003, 0.002, 0.002, 0.001, 0, 0, 0, 0, 0],
};
/** 휘청인 뒤 아래 바닥으로 폴짝. */
const TEETER_HOP: LedgeMotion = {
  direction: 'down', style: 'hop', ...HOP,
  x: [[0, EDGE_STANCE], [1.3, EDGE_STANCE], [1.55, EDGE_STANCE + 0.02], [2.15, 0.27], [2.4, 0.3], [3.933, 0.3]],
  feet: [[0, 0], [1.55, 0], [2.15, 1], [3.933, 1]],
};
/** 휘청인 뒤 앞으로 꽈당. 누운 몸(약 2단위)이 글자 위에 걸치지 않게 뿌리를 가장자리 밖으로 옮긴다. */
const TEETER_TOPPLE: LedgeMotion = {
  direction: 'down', style: 'topple', action: 'meshy:502', duration: 2.729,
  x: [[0, EDGE_STANCE], [0.62, EDGE_STANCE], [1.1, 0.26], [2.729, 0.26]],
  feet: [[0, 0], [0.7, 0], [1, 0.85], [1.12, 1], [2.729, 1]],
  apex: 0, settle: 2.55,
  float: [0, 0, 0, 0, 0, 0, 0, 0.026, 0.099, 0.294, 0.398, 0.407, 0.428, 0.46, 0.45, 0.458, 0.432, 0.388, 0.322, 0.218, 0.057, 0, 0, 0, 0, 0, 0, 0],
};
export const TEETER_MOTIONS: readonly LedgeMotion[] = [TEETER_FLAIL, TEETER_SWAY];
export const TEETER_OUTCOMES: readonly LedgeMotion[] = [TEETER_HOP, TEETER_TOPPLE];
/** 휘청이는 동작 하나와 결과(폴짝 내려앉기·꽈당) 하나를 무작위로. forced 가 'hop'·'topple' 이면 결과를 고정한다. */
export function chooseTeeterSequence(random: () => number = Math.random, forced?: LedgeStyle | null): [LedgeMotion, LedgeMotion] {
  const pick = <T,>(pool: readonly T[]) => pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  const teeter = pick(TEETER_MOTIONS);
  const outcome = TEETER_OUTCOMES.find(motion => motion.style === forced) ?? pick(TEETER_OUTCOMES);
  return [teeter, outcome];
}
/** 휘청일 때 몸 중심이 가장자리에서 안쪽으로 떨어진 거리(상자 폭 비율, 발이 반쯤 걸친 자리). */
export const EDGE_STANCE_RATIO = -EDGE_STANCE;

export const LEDGE_MOTIONS: Readonly<Record<LedgeDirection, readonly LedgeMotion[]>> = {
  down: [DOWN_JUMP, DOWN_ROLL, DOWN_CRAWL],
  up: [UP_JUMP, UP_CRAWL],
};

const approachRatio = (motion: LedgeMotion) => Math.max(0, -motion.x[0][1]);
/**
 * 방향에 맞는 방식을 무작위로 고른다. forced 가 그 방향에 없으면 무시한다(구르기는 내려갈 때만).
 * room(가장자리까지 남은 거리, 상자 폭 단위)을 주면 그 안에서 출발할 수 있는 방식만 고르고, 하나도 없으면 도움닫기가 가장 짧은 방식.
 */
export function chooseLedgeMotion(direction: LedgeDirection, random: () => number = Math.random, forced?: LedgeStyle | null, room?: number): LedgeMotion {
  const pool = LEDGE_MOTIONS[direction];
  const pick = forced ? pool.find(motion => motion.style === forced) : undefined;
  if (pick) return pick;
  const fits = room === undefined ? pool : pool.filter(motion => approachRatio(motion) <= room);
  const usable = fits.length ? fits : [pool.reduce((best, motion) => approachRatio(motion) < approachRatio(best) ? motion : best)];
  return usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))];
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** 키 사이는 smoothstep 으로 잇는다(구간 끝에서 속도 0이라 출발·착지가 툭 끊기지 않는다). */
export function keyAt(keys: Keys, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return t1 === t0 ? v1 : v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}

export function ledgeFloat(motion: LedgeMotion, t: number): number {
  const at = Math.max(0, t) / FLOAT_STEP, i = Math.floor(at), f = motion.float;
  if (i >= f.length - 1) return f[f.length - 1] ?? 0;
  return f[i] + (f[i + 1] - f[i]) * (at - i);
}

/** 시작 자리만 offset 으로 바꾼 사본: 첫 키부터 glide 초 동안 원래 자리로 스르르 옮겨 간다(착지 자리에서 순간이동하지 않게). */
export function glideFrom(motion: LedgeMotion, offset: number, glide = 0.35): LedgeMotion {
  const home = motion.x[0][1];
  if (Math.abs(offset - home) < 1e-3) return motion;
  return { ...motion, x: [[0, offset], [glide, home], ...motion.x.filter(([t]) => t > glide)] };
}
/** 도움닫기 자리를 offset 으로 줄인 사본: 처음 버티는 키들의 자리만 바꾼다(가장자리 바로 앞에서 그 자리로 바로 넘는다). */
export function holdFrom(motion: LedgeMotion, offset: number): LedgeMotion {
  const home = motion.x[0][1];
  if (Math.abs(offset - home) < 1e-3) return motion;
  let leading = true;
  return { ...motion, x: motion.x.map(([t, v]) => { if (leading && Math.abs(v - home) < 1e-6) return [t, offset] as const; leading = false; return [t, v] as const; }) };
}

/** 출발할 때 몸 중심이 턱 가장자리에서 진행 반대쪽으로 떨어져 있어야 하는 거리(px). */
export const ledgeApproach = (motion: LedgeMotion, width: number) => Math.max(0, -motion.x[0][1]) * width;

export type LedgeStepPlan = {
  motion: LedgeMotion; dir: 1 | -1; edge: number;
  /** 출발·도착 바닥의 화면 y(발이 닿는 선). */
  from: number; to: number;
  width: number; height: number;
  /** 이 동작이 끝나면 이어서 할 동작(휘청임 → 결과). 같은 가장자리에서 출발 바닥 → 가장자리 너머 바닥으로 간다. */
  then?: readonly LedgeMotion[];
};

export type LedgePose = { x: number; y: number; feet: number; center: number; done: boolean; sx: number; sy: number };

/**
 * 중력 포물선: 출발 바닥(from)에서 이륙해 높은 바닥보다 h 만큼 위 꼭짓점을 지나 도착 바닥(to)에 T 초 뒤 내려앉는다.
 * 오르는 시간과 내려오는 시간이 같은 g 에서 나오도록 g 를 푼다(화면 y 는 아래로 커진다).
 */
export function jumpArc(from: number, to: number, h: number, T: number, tau: number): number {
  const peak = Math.min(from, to) - Math.max(0, h);
  const rise = from - peak, fall = to - peak;
  if (T <= 0) return to;
  const g = ((Math.sqrt(2 * rise) + Math.sqrt(2 * fall)) / T) ** 2;
  const v0 = Math.sqrt(2 * g * rise);
  const t = Math.max(0, Math.min(T, tau));
  return from - v0 * t + 0.5 * g * t * t;
}

/** 웅크림 → 이륙 늘어남 → 착지 찌그러짐(아래 기준). 부피가 비슷하게 가로는 반대로 조금. */
function jumpSquash(jump: NonNullable<LedgeMotion["jump"]>, t: number): number {
  const bump = (start: number, length: number, amount: number) => t >= start && t <= start + length ? amount * Math.sin(Math.PI * (t - start) / length) : 0;
  return 1 - bump(jump.takeoff - 0.26, 0.26, 0.07) + bump(jump.takeoff, 0.2, 0.06) - bump(jump.land, 0.28, 0.1);
}

/**
 * 동작 시각 t 에서의 상자 자리. 발은 feet 경로(+포물선) 위에 있고, 동작이 몸을 띄우는 만큼 상자를 내려 그 높이를 지운다.
 * y 는 화면 아래로 커진다(상자 위쪽 모서리).
 */
export function ledgeStepPose(plan: LedgeStepPlan, t: number, pixelsPerUnit: number): LedgePose {
  const { motion, dir, edge, from, to, width, height } = plan;
  const time = Math.max(0, Math.min(motion.duration, t));
  const jump = motion.jump;
  let center: number, feet: number, sy = 1;
  if (jump) {
    // 공중에서는 가로 속도가 일정하다(이륙·착지 자리 사이를 곧게). 땅에서는 키를 따른다(웅크리며 살짝 다가가기·착지 뒤 한 발 내딛기).
    const airborne = time > jump.takeoff && time < jump.land;
    const ratio = airborne
      ? keyAt(motion.x, jump.takeoff) + (keyAt(motion.x, jump.land) - keyAt(motion.x, jump.takeoff)) * (time - jump.takeoff) / (jump.land - jump.takeoff)
      : keyAt(motion.x, time);
    center = edge + dir * ratio * width;
    feet = time <= jump.takeoff ? from : time >= jump.land ? to : jumpArc(from, to, motion.apex * height, jump.land - jump.takeoff, time - jump.takeoff);
    sy = jumpSquash(jump, time);
  } else {
    center = edge + dir * keyAt(motion.x, time) * width;
    const u = keyAt(motion.feet, time);
    // 출발 바닥에서 도착 바닥으로 가는 길 위에 위로 솟는 포물선을 더한다(apex 0 이면 곧게 미끄러져 내린다).
    feet = from + (to - from) * u - motion.apex * height * 4 * u * (1 - u);
  }
  const lift = Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? ledgeFloat(motion, time) * pixelsPerUnit : 0;
  return { x: center - width / 2, y: feet - height + lift, feet, center, done: t >= Math.min(motion.settle, motion.duration) - 1e-3, sx: 1 + (1 - sy) * 0.7, sy };
}
