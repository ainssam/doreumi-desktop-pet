import fs from 'node:fs';
import { createHash } from 'node:crypto';

const REVIEWED_ACTIONS = new Set([22, 23, 24, 27, 40, 63, 67, 578, 591, 592, 596, 599]);
const REVIEWED_STAGE_ACTIONS = new Set([40, 578]);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const vector = value => Array.isArray(value) && value.length === 3 && value.every(v => Number.isFinite(v) && Math.abs(v) <= 10);

/** Reviewed offline plans are bound to the exact donor and immutable master. */
export function validateReviewedContactPlan(plan, { actionId, sourceSha256, masterSha256 }) {
  if (plan.version !== 1 || plan.actionId !== actionId || !REVIEWED_ACTIONS.has(actionId)) throw new Error('Invalid reviewed contact plan identity');
  if (!hash(sourceSha256) || !hash(masterSha256) || plan.sourceSha256 !== sourceSha256 || plan.masterSha256 !== masterSha256) throw new Error('Reviewed contact plan source or master hash changed');
  if (!hash(plan.convertedSha256) || plan.geometricLegs !== true || plan.fps !== 30 || !Number.isFinite(plan.sourceDuration) || plan.sourceDuration <= 0 || plan.sourceDuration > 120) throw new Error('Invalid reviewed contact plan contract');
  if (REVIEWED_STAGE_ACTIONS.has(actionId) !== (plan.stageSplit === true) || (plan.stageSplit && (!hash(plan.virtualClipSha256) || !hash(plan.stageMetadataSha256)))) throw new Error('Invalid reviewed stage split contract');
  const count = Math.ceil(plan.sourceDuration * plan.fps) + 1;
  if (![plan.plannedRootPath, plan.plannedContactFrames, plan.plannedPoleAngles].every(v => Array.isArray(v) && v.length === count)) throw new Error('Reviewed contact plan sample count changed');
  for (let index = 0; index < count; index++) {
    const root = plan.plannedRootPath[index], contacts = plan.plannedContactFrames[index], angles = plan.plannedPoleAngles[index];
    if (!vector(root) || Math.hypot(root[0], root[2]) > 2) throw new Error('Reviewed contact root exceeds bounded model space');
    if (!contacts || typeof contacts !== 'object' || Array.isArray(contacts) || Object.keys(contacts).some(side => side !== 'L' && side !== 'R')) throw new Error('Invalid reviewed contact sides');
    for (const contact of Object.values(contacts)) {
      if (!contact || !vector(contact.goal) || ![contact.sourceIndex, contact.targetIndex].every(v => Number.isSafeInteger(v) && v >= 0 && v < 100000)) throw new Error('Invalid reviewed skin contact');
    }
    if (!angles || !['L', 'R'].every(side => Number.isFinite(angles[side]) && Math.abs(angles[side]) <= Math.PI)) throw new Error('Invalid reviewed knee-plane angles');
  }
  return plan;
}

export function loadReviewedContactPlan(identity) {
  if (!REVIEWED_ACTIONS.has(identity.actionId)) return undefined;
  const bytes = fs.readFileSync(new URL(`./contact-plans/${identity.actionId}.json`, import.meta.url));
  if (bytes.length > 1_000_000) throw new Error('Reviewed contact plan is too large');
  const plan = validateReviewedContactPlan(JSON.parse(bytes.toString('utf8')), identity);
  return { ...plan, planSha256: createHash('sha256').update(bytes).digest('hex') };
}
