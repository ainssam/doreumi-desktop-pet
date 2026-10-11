/**
 * How often Doreumi draws (2026-10-06 사용자: "모바일에서는 움직임을 줄인다거나. 그리고 가볍게 하는 작업도 당연히 하고").
 *
 * - Desktop: 30 frames a second while only breathing in place, 60 during a performance, a walk or a run.
 * - Phones and small or low-memory machines: 24 frames a second at most, performances come 2.5 times less often,
 *   and drawing pauses while a finger is on the screen or the page is scrolling (it picks up again 300ms later).
 * On top of these, the pace governor below slows Doreumi down further when the page itself starts to stutter
 * (no graphics card, a busy school PC), and speeds back up once frames come smoothly again.
 *
 * 2026-10-07 운영자 지시: "컴퓨터에 따라 도름이 모션이나 뛰는거나 그런거가 안되는 경우가 있더라고 … 모든 데스크톱에서 제대로 모션 작동되게해",
 * "사양에 따라 동작이 단순화되게 … 움직임을 아예 없애는건 아니고 … 가볍게", "동작은 다 하는데 기기사양에따라 프레임 … 단순화 … 렉을 해소해".
 * 그래서 도름이는 어떤 기기에서도 멈추지 않는다. 그래픽 가속이 없거나 버거운 컴퓨터는 동작을 모두 하되 덜 자주 그린다(아래 조절기).
 * 시스템의 '움직임 줄이기'(Windows 애니메이션 효과 끄기 등, 학교·회사 컴퓨터에 흔하다)는 사양 신호가 아니므로
 * 저절로 하는 공연 사이를 길게 쉬는 데만 쓴다(doreumiCalmAmbient).
 */
export const DESKTOP_IDLE_FRAME_MS = 1000 / 30;
export const DESKTOP_ACTIVE_FRAME_MS = 12;
export const LOW_POWER_FRAME_MS = 1000 / 24;
export const LOW_POWER_AMBIENT_GAP_SCALE = 2.5;
export const TOUCH_RESUME_MS = 300;

let coarse: MediaQueryList | null | undefined;
let narrow: MediaQueryList | null | undefined;
let reducedMotion: MediaQueryList | null | undefined;
const query = (text: string) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(text) : null;

/** Cached once per page; never call matchMedia inside a frame. */
export function reducedMotionQuery(): MediaQueryList | null {
  if (reducedMotion === undefined) reducedMotion = query('(prefers-reduced-motion: reduce)');
  return reducedMotion;
}

/** Touch-first, narrow, or a small CPU / memory budget. Re-read cheaply (cached queries) when the viewport changes. */
export function doreumiLowPower(): boolean {
  if (coarse === undefined) coarse = query('(pointer: coarse)');
  if (narrow === undefined) narrow = query('(max-width: 899.98px)');
  if (coarse?.matches || narrow?.matches) return true;
  const device = typeof navigator !== 'undefined' ? navigator as Navigator & { deviceMemory?: number } : undefined;
  if (device && typeof device.hardwareConcurrency === 'number' && device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4) return true;
  if (device && typeof device.deviceMemory === 'number' && device.deviceMemory > 0 && device.deviceMemory <= 4) return true;
  return false;
}

/** 저절로 하는 공연 사이를 길게 쉴지: 휴대폰·작은 기기, 또는 시스템 '움직임 줄이기'. */
export function doreumiCalmAmbient(): boolean {
  return doreumiLowPower() || !!reducedMotionQuery()?.matches;
}

/** Minimum time between drawn frames. `active`: a performance, a walk or a blend is playing (not the breathing idle loop). */
export function doreumiFrameBudget(active: boolean, lowPower: boolean): number {
  if (lowPower) return LOW_POWER_FRAME_MS;
  return active ? DESKTOP_ACTIVE_FRAME_MS : DESKTOP_IDLE_FRAME_MS;
}

/**
 * Pace governor (2026-10-07 운영자 지시 "기기사양에따라 프레임 … 단순화 … 렉을 해소해"): every motion keeps playing; only how
 * often Doreumi draws drops, one step at a time (full → 20 → 12 → 8 frames a second), when its drawing makes the page miss frames.
 *
 * - The screen's own frame interval is measured from animation frames Doreumi did NOT draw (so a 30Hz battery mode, a 120Hz monitor
 *   and a remote desktop each have their own base). At full speed one frame a second is skipped on purpose to keep measuring.
 * - A drawn frame is "missed" when the next frame comes later than 1.5× that base, and never sooner than MISS_FLOOR_MS (one and a half
 *   60Hz frames). On a 120·144·165Hz screen one frame is only 6~8ms, so a draw that merely spills into the next fast frame is not a
 *   stutter; counting it dropped Doreumi to 8 frames a second on capable Windows laptops (2026-10-07 원장 60, 시뮬레이터 실측).
 *   30% missed → one step slower (at most once a second).
 *   Under 5% missed for 6s → one step faster; if it has to come back down within 10s, the next try waits twice as long (up to 48s).
 * - The level learned on this page is kept for the next renderer (shop preview, 도름이 다시 열기) so it does not stutter again.
 * - Machines without graphics acceleration start at 12 a second and never go faster than 20.
 */
export const PACE_FRAME_MS = [0, 1000 / 20, 1000 / 12, 125] as const;
export const MISS_FLOOR_MS = 25;
export type DoreumiPace = {
  level: number; floor: number; base: number; last: number; lastDrew: boolean; forceSkip: boolean;
  skips: { at: number; gap: number }[]; drawn: boolean[]; changedAt: number; upAt: number; calmSince: number; backoff: number;
};
let learnedLevel: number | null = null;
export function createPace(software: boolean): DoreumiPace {
  const floor = software ? 1 : 0;
  const level = Math.max(floor, learnedLevel ?? (software ? 2 : 0));
  return { level, floor, base: 1000 / 60, last: 0, lastDrew: false, forceSkip: false, skips: [], drawn: [], changedAt: 0, upAt: -Infinity, calmSince: 0, backoff: 0 };
}
/** Forget what this page learned (tests). */
export function resetLearnedPace() { learnedLevel = null; }
/**
 * Call on every animation frame callback, then set `pace.lastDrew` to whether this callback drew.
 * Returns the extra minimum time between drawn frames; `pace.forceSkip` asks the caller to skip this one frame (measuring).
 */
export function stepPace(pace: DoreumiPace, now: number): number {
  const gap = pace.last ? now - pace.last : 0;
  pace.last = now;
  if (gap > 0 && gap < 1000) {
    if (pace.lastDrew) { pace.drawn.push(gap > Math.max(pace.base * 1.5, MISS_FLOOR_MS)); if (pace.drawn.length > 20) pace.drawn.shift(); }
    else pace.skips.push({ at: now, gap });
  }
  while (pace.skips.length && now - pace.skips[0].at > 3000) pace.skips.shift();
  if (pace.skips.length >= 2) pace.base = Math.max(5, Math.min(...pace.skips.map(sample => sample.gap)));
  const enough = pace.drawn.length >= 10;
  const missed = enough ? pace.drawn.filter(Boolean).length / pace.drawn.length : 0;
  if (enough && missed >= .3 && now - pace.changedAt > 1000 && pace.level < PACE_FRAME_MS.length - 1) {
    if (now - pace.upAt < 10000) pace.backoff = Math.min(3, pace.backoff + 1);
    pace.level++; pace.changedAt = now; pace.drawn = []; pace.calmSince = 0; learnedLevel = pace.level;
  } else if (enough && missed <= .05 && pace.level > pace.floor) {
    if (!pace.calmSince) pace.calmSince = now;
    else if (now - pace.calmSince > 6000 * 2 ** pace.backoff) {
      pace.level--; pace.changedAt = now; pace.upAt = now; pace.calmSince = 0; pace.drawn = []; learnedLevel = pace.level;
    }
  } else if (missed > .05) pace.calmSince = 0;
  if (now - pace.changedAt > 60000) pace.backoff = 0;
  // Full speed draws every frame, so no frame is left to measure the screen with: skip one a second.
  const lastSkip = pace.skips.length ? pace.skips[pace.skips.length - 1].at : -Infinity;
  pace.forceSkip = pace.level === 0 && now - lastSkip > 1000;
  return PACE_FRAME_MS[pace.level];
}
