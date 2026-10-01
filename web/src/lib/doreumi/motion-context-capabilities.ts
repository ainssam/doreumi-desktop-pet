import type { DoreumiTravel } from '@/lib/doreumi/motion-travel';
import { parseDoreumiEnvironment, type DoreumiLowLedge } from '@/lib/doreumi/motion-environment-contract';

export type DoreumiContextProp = 'phone' | 'chair' | 'bag' | 'umbrella' | 'bucket' | 'carried-object' | 'kettlebell'
  | 'jump-rope' | 'mirror' | 'cup' | 'exercise-weight' | 'baseball' | 'soccer-ball' | 'fruit-basket' | 'radish' | 'pickup-item' | 'seating-surface' | 'torch' | 'walker' | 'climbing-surface';
export type DoreumiContextMotion = { sourceActionId: number; props?: readonly string[]; entryDuration?: number; exitDuration?: number; travel?: DoreumiTravel; environmentSupport?: DoreumiLowLedge };

/** Capability alone never replaces the registry's visual review for ambient playback. */
export const DOREUMI_CONTEXT_ACTIONS: Readonly<Record<Exclude<DoreumiContextProp, 'climbing-surface'>, readonly number[]>> = {
  phone: [29, 50, 122, 124, 312, 676, 693], chair: [32, 33, 272, 364],
  'carried-object': [284, 551, 611], kettlebell: [327, 598], bucket: [552, 612],
  umbrella: [565, 695], bag: [43, 635],
  'jump-rope': [46], mirror: [48], cup: [342, 343], 'seating-surface': [299, 343, 354],
  'exercise-weight': [320, 331], baseball: [393], 'soccer-ball': [410],
  'fruit-basket': [277, 278], radish: [283], 'pickup-item': [273, 274, 275, 276, 280, 281, 282],
  torch: [337, 520, 521, 522, 578, 624, 625],
  walker: [567, 696],
};
const EXCLUDED = new Set(['weapon', 'cannon', 'door']);
const SUPPORTED = new Set<string>([...Object.keys(DOREUMI_CONTEXT_ACTIONS), 'climbing-surface']);

export function contextPropsSupport(props: readonly string[] = [], sourceActionId?: number, environmentSupport?: DoreumiLowLedge): { supported: boolean; reason: string | null } {
  const excluded = props.find(prop => EXCLUDED.has(prop));
  if (excluded) return { supported: false, reason: `inappropriate-ambient-context:${excluded}` };
  const unknown = props.find(prop => !SUPPORTED.has(prop));
  if (unknown) return { supported: false, reason: `unsupported-context-prop:${unknown}` };
  const unique = new Set(props);
  if (unique.has('climbing-surface') && !parseDoreumiEnvironment(environmentSupport, sourceActionId ?? -1)) return { supported: false, reason: 'missing-adapted-environment-metadata' };
  const seatedCup = sourceActionId === 343 && unique.size === 2 && unique.has('cup') && unique.has('seating-surface');
  if (unique.size > 1 && !seatedCup) return { supported: false, reason: 'multiple-context-props-require-review' };
  if (sourceActionId === 343 && unique.size && !seatedCup) return { supported: false, reason: 'seated-drink-requires-cup-and-seat' };
  if (sourceActionId !== undefined) {
    if (!Number.isSafeInteger(sourceActionId) || sourceActionId < 0) return { supported: false, reason: 'invalid-context-action' };
    const mismatch = props.find(prop => prop !== 'climbing-surface' && !DOREUMI_CONTEXT_ACTIONS[prop as keyof typeof DOREUMI_CONTEXT_ACTIONS].includes(sourceActionId));
    if (mismatch) return { supported: false, reason: `unsupported-context-action:${sourceActionId}:${mismatch}` };
  }
  return { supported: true, reason: null };
}
