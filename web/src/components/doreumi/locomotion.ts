import { gaitUnitsPerSecond } from '@/lib/doreumi/motion-gait';
import { projectTravelPoint, sampleDoreumiTravel, stageTravelYaw, type DoreumiStageDecision, type DoreumiStageFrame, type DoreumiTravel } from '@/lib/doreumi/motion-travel';

export type LocomotionPhase = "idle" | "dragged" | "falling" | "landing" | "running";
export type WallSide = "left" | "right";
export type MotionBounds = { width: number; height: number; viewportWidth: number; viewportHeight: number; occupiedBottom: number };
export type MotionState = { x: number; y: number; vy: number; elapsed: number; phase: LocomotionPhase; side: WallSide };
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
export function clampPosition(x: number, y: number, b: MotionBounds) {
  return { x: Math.max(wallX("left", b), Math.min(wallX("right", b), x)), y: Math.max(0, Math.min(floorY(b), y)) };
}
export function stepLocomotion(state: MotionState, milliseconds: number, b: MotionBounds, reducedMotion = false): MotionState {
  const dt = Math.max(0, Math.min(250, milliseconds)) / 1000;
  const next = { ...state, ...clampPosition(state.x, state.y, b) };
  if (state.phase === "idle" || state.phase === "dragged") return next;
  if (reducedMotion) return { ...next, x: wallX(state.side, b), y: floorY(b), vy: 0, elapsed: 0, phase: "idle" };
  if (state.phase === "falling") {
    next.y = Math.min(floorY(b), next.y + next.vy * dt + 1600 * dt * dt);
    next.vy += 3200 * dt;
    if (next.y >= floorY(b)) { next.phase = "landing"; next.vy = 0; next.elapsed = 0; }
  } else if (state.phase === "landing") {
    next.y = floorY(b); next.elapsed += dt * 1000;
    if (next.elapsed >= 650) { next.phase = "running"; next.elapsed = 0; }
  } else {
    next.y = floorY(b);
    const distance = wallX(next.side, b) - next.x, step = runPixelsPerSecond(b.height) * dt;
    next.x += Math.sign(distance) * Math.min(Math.abs(distance), step);
    if (Math.abs(distance) <= step) next.phase = "idle";
  }
  return next;
}

export type ImportedStageState = {
  action: string; yaw: number; x: number; originX: number; originTravel: number;
  pixelsPerUnit: number; time: number; blocked: boolean;
};

function chooseStageYaw(travel: DoreumiTravel, x: number, b: MotionBounds, pixelsPerUnit: number, time: number) {
  const left = wallX('left', b), right = wallX('right', b), preferred = right - x >= x - left ? 'right' : 'left';
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
  const origin = projectTravelPoint(travel.positionsXZ[0], yaw);
  return travel.positionsXZ.every(point => {
    const position = x + (projectTravelPoint(point, yaw) - origin) * pixelsPerUnit;
    return position >= wallX('left', b) && position <= wallX('right', b);
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
  const nextX = clampPosition(desired, 0, b).x, blocked = Math.abs(nextX - desired) > .5;
  return { state: { ...state, x: nextX, time: frame.time, blocked }, decision: { yaw: state.yaw, stop: blocked || undefined }, moved: Math.abs(nextX - state.x) > .001 };
}
