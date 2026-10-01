/** Measured in master-rig units. Both the authored feet and host travel consume
 * this contract so playback speed cannot drift away from support-foot travel. */
export const DOREUMI_GAIT = {
  Walk: { cycleSeconds: 1.15, stride: .145, stanceFraction: .64, lift: .045 },
  Run: { cycleSeconds: .45, stride: .19, stanceFraction: .48, lift: .09 },
} as const;

export function gaitUnitsPerSecond(action: keyof typeof DOREUMI_GAIT) {
  const gait = DOREUMI_GAIT[action];
  return gait.stride / (gait.cycleSeconds * gait.stanceFraction);
}
