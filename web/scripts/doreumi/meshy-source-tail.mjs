/** Explicit repair of one measured corrupt source key, never a motion filter.
 * Run_and_Jump 463 ends with a 139.7 degree right-foot rotation in one 30 Hz
 * source frame. Keep the original clock, decelerate the last valid frame over
 * the final two frames, and recover from its valid endpoint. Earlier source
 * poses, the jump apex, and all other action IDs keep their original times.
 */
const REPAIR = Object.freeze({
  actionId: 463,
  sourceSha256: '4d4ada0b91b84eca55bcefd07e582555d0822e35cd7e13e432e47209d55eb018',
  sourceDuration: 2.3333332538604736,
  retainedSourceDuration: 2.299999952316284,
  warpStart: 2.2666666507720947,
});

function repairFor(metadata, sourceDuration) {
  if (metadata?.actionId !== REPAIR.actionId) return undefined;
  if (metadata.sourceSha256 !== REPAIR.sourceSha256) {
    throw new Error('Source 463 checksum changed or is missing; its tail needs a new source-key audit.');
  }
  if (!Number.isFinite(sourceDuration) || Math.abs(sourceDuration - REPAIR.sourceDuration) > 1e-6) {
    throw new Error('Source 463 duration changed; its tail needs a new source-key audit.');
  }
  return REPAIR;
}

export function sourceTailSampleTime(metadata, requestedTime, sourceDuration) {
  const repair = repairFor(metadata, sourceDuration);
  if (!repair) return requestedTime;
  if (!Number.isFinite(requestedTime)) throw new Error('Invalid source tail sample time.');
  if (requestedTime <= repair.warpStart) return requestedTime;
  const progress = Math.min(1, (requestedTime - repair.warpStart) / (repair.sourceDuration - repair.warpStart));
  // Integral of a linearly decaying sample-time velocity. The derivative is
  // exactly one at warp entry and zero at its endpoint, avoiding a hard freeze.
  return repair.warpStart + (repair.retainedSourceDuration - repair.warpStart) * (2 * progress - progress * progress);
}

export function sourceTailEvidence(metadata, sourceDuration) {
  const repair = repairFor(metadata, sourceDuration);
  if (!repair) return undefined;
  return {
    version: 1,
    method: 'replace-corrupt-final-source-key-with-c1-decelerated-valid-pose',
    sourceActionId: repair.actionId,
    verifiedOriginalSourceSha256: repair.sourceSha256,
    originalSourceDuration: sourceDuration,
    playbackSourceDuration: sourceDuration,
    retainedSourceDuration: repair.retainedSourceDuration,
    originalInterval: [repair.retainedSourceDuration, repair.sourceDuration],
    timeWarpInterval: [repair.warpStart, repair.sourceDuration],
    removedSourceKeyTimes: [repair.sourceDuration],
    replacementPoseSourceTime: repair.retainedSourceDuration,
    durationPreserved: true,
    sourceBeforeWarpPreserved: true,
    corruptFinalKeySampled: false,
    originalLastKeyDegrees: { RightFoot: 139.7010701796075, RightUpLeg: 137.58224333641655, RightLeg: 96.05217001550687 },
    reason: 'Original last key changes the right leg by 96–140 degrees in one 30 Hz frame; earlier jump and landing motion remain authored.',
  };
}
