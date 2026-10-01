export type MotionFrame = {
  halfHeight: number;
  centerY: number;
  tracking?: { times: number[]; centerY: number[] };
};
export type MotionFrameSample = { action: string; time: number; weight: number };
export type MotionCameraState = { halfHeight: number; centerY: number; tracking: boolean };

/** Camera samples are measured from the complete deformed skin, never root-height clamps. */
export function validMotionFrame(frame: MotionFrame, duration: number): boolean {
  if (!Number.isFinite(frame.halfHeight) || frame.halfHeight < 1 || frame.halfHeight > 10
    || !Number.isFinite(frame.centerY) || Math.abs(frame.centerY) > 10) return false;
  const track = frame.tracking;
  if (track === undefined) return true;
  if (!track || !Array.isArray(track.times) || !Array.isArray(track.centerY)
    || track.times.length < 2 || track.times.length > 10802 || track.times.length !== track.centerY.length
    || track.times[0] !== 0 || Math.abs(track.times.at(-1)! - duration) > 1e-5) return false;
  return track.times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= duration + 1e-5
    && (!index || time > track.times[index - 1])
    && Number.isFinite(track.centerY[index]) && Math.abs(track.centerY[index]) <= 10);
}

export function sampleMotionFrame(frame: MotionFrame, time: number, aspect: number) {
  let centerY = frame.centerY;
  const track = frame.tracking;
  if (track) {
    let low = 0, high = track.times.length - 1;
    const value = Number.isFinite(time) ? Math.max(0, Math.min(time, track.times[high])) : 0;
    while (high - low > 1) {
      const middle = (low + high) >>> 1;
      if (track.times[middle] <= value) low = middle; else high = middle;
    }
    const fraction = (value - track.times[low]) / (track.times[high] - track.times[low]);
    centerY = track.centerY[low] + (track.centerY[high] - track.centerY[low]) * fraction;
  }
  return { halfHeight: Math.max(frame.halfHeight, frame.halfHeight / aspect), centerY };
}

/** Follow the pose that the mixer actually rendered, including outgoing actions.
 * A new action name alone does not describe a crossfaded airborne pose. */
export function blendMotionFrames(samples: readonly MotionFrameSample[], frameFor: (action: string) => MotionFrame | undefined, aspect: number) {
  const sampleFrame = (action: string, time: number) => {
    const frame = frameFor(action);
    return frame ? { ...sampleMotionFrame(frame, time, aspect), tracking: !!frame.tracking }
      : { ...doreumiFrame(action, aspect), tracking: false };
  };
  let centerY = 0, halfHeight = 0, totalWeight = 0, tracking = false;
  for (const sample of samples) {
    if (!(sample.weight > 0)) continue;
    const measured = sampleFrame(sample.action, sample.time);
    centerY += measured.centerY * sample.weight;
    halfHeight = Math.max(halfHeight, measured.halfHeight);
    totalWeight += sample.weight;
    tracking ||= measured.tracking;
  }
  // Three blends any missing total weight with the original resting pose.
  if (totalWeight < 1) {
    const rest = sampleFrame('Idle', 0);
    centerY += rest.centerY * (1 - totalWeight);
    halfHeight = Math.max(halfHeight, rest.halfHeight);
  }
  return { centerY: centerY / Math.max(1, totalWeight), halfHeight, tracking };
}

export function advanceMotionCamera(current: MotionCameraState, target: MotionCameraState, delta: number, immediate = false): MotionCameraState {
  const blend = immediate ? 1 : 1 - Math.exp(-Math.max(0, delta) / .1);
  // Zooming in is cosmetic and may safely lag the pose. A slow RAF must not
  // consume the entire zoom in one visible frame after an outgoing action
  // disappears. Work in log scale so the limit describes apparent size.
  const zoomDelta = Math.min(Math.max(0, delta), 1 / 30);
  const zoomDistance = Math.max(0, Math.log(current.halfHeight / target.halfHeight));
  const zoomStep = Math.min(zoomDistance * (1 - Math.exp(-zoomDelta / .32)), .6 * zoomDelta);
  return {
    // Expand immediately while a contributing pose needs room. Shrink at no
    // more than 1.01% per 60 Hz frame or 2.03% after a long frame.
    halfHeight: immediate || target.halfHeight >= current.halfHeight ? target.halfHeight : current.halfHeight * Math.exp(-zoomStep),
    // A slow RAF can consume the entire outgoing fade. Its first untracked
    // frame must also reach the actual pose before ordinary easing resumes.
    centerY: current.centerY + (target.centerY - current.centerY) * (target.tracking || current.tracking ? 1 : blend),
    tracking: target.tracking,
  };
}
import { doreumiFrame } from '@/lib/doreumi/motion-catalog';
