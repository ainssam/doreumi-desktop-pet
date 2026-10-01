import type { DoreumiExpression } from './motion-catalog';
import { parseDoreumiTravel, type DoreumiTravel } from '@/lib/doreumi/motion-travel';
import { contextPropsSupport } from '@/lib/doreumi/motion-context-capabilities';
import { validMotionFrame, type MotionFrame } from '@/lib/doreumi/motion-camera';
import { parseDoreumiEnvironment, type DoreumiLowLedge } from '@/lib/doreumi/motion-environment-contract';

export type LibraryMotion = {
  id: `meshy:${number}`; label: string; family: string; duration: number;
  sourceActionId: number; url?: string; review: 'pending' | 'passed' | 'failed';
  ambient: boolean; exclusionReason?: string; props?: string[]; evidence?: string[];
  expression?: DoreumiExpression;
  frame?: MotionFrame;
  travel?: DoreumiTravel;
  entryDuration?: number; exitDuration?: number;
  planarSupport?: { version: 1; maxOffset: number };
  environmentSupport?: DoreumiLowLedge;
};
export type MotionLibrary = { version: 1; motions: LibraryMotion[] };

/** Only local, animation-only assets. A source library entry is not a review pass. */
export function parseMotionLibrary(value: unknown): MotionLibrary {
  const data = value as Partial<MotionLibrary> | null;
  if (data?.version !== 1 || !Array.isArray(data.motions)) throw new Error('Invalid motion registry');
  const ids = new Set<string>();
  for (const entry of data.motions) {
    if (!entry || !/^meshy:\d{1,4}$/.test(entry.id) || ids.has(entry.id)
      || !Number.isInteger(entry.sourceActionId) || entry.id !== `meshy:${entry.sourceActionId}`
      || typeof entry.label !== 'string' || typeof entry.family !== 'string'
      || !Number.isFinite(entry.duration) || entry.duration < 0 || entry.duration > 180
      || !['pending', 'passed', 'failed'].includes(entry.review) || typeof entry.ambient !== 'boolean'
      || (entry.props !== undefined && (!Array.isArray(entry.props) || entry.props.some(prop => typeof prop !== 'string')))
      || [entry.entryDuration, entry.exitDuration].some(seconds => seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0 || seconds > entry.duration))
      || (entry.planarSupport !== undefined && (entry.planarSupport.version !== 1 || !Number.isFinite(entry.planarSupport.maxOffset) || entry.planarSupport.maxOffset < 0 || entry.planarSupport.maxOffset > 2 || entry.travel !== undefined))
      || (entry.frame !== undefined && (!entry.frame || !validMotionFrame(entry.frame, entry.duration)))
      || (entry.url !== undefined && !/^\/doreumi\/motions\/[a-zA-Z0-9_-]+\.json$/.test(entry.url))) {
      throw new Error('Invalid motion entry');
    }
    ids.add(entry.id);
    parseDoreumiTravel(entry.travel, entry.duration);
    if (entry.environmentSupport !== undefined && (!parseDoreumiEnvironment(entry.environmentSupport, entry.sourceActionId)
      || entry.travel !== undefined || !entry.planarSupport)) throw new Error('Invalid motion environment');
  }
  return data as MotionLibrary;
}

/** Same-origin motion assets are still size-capped before parsing. */
export const MOTION_REGISTRY_MAX_BYTES = 8_000_000;
export const MOTION_CLIP_MAX_BYTES = 2_000_000;
export async function boundedMotionText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Motion asset too large');
  const text = await response.text();
  if (text.length > maxBytes) throw new Error('Motion asset too large');
  return text;
}

export async function fetchMotionLibrary(signal?: AbortSignal): Promise<MotionLibrary> {
  const response = await fetch('/doreumi/motions/registry.json', { signal });
  if (!response.ok) throw new Error(`Motion registry ${response.status}`);
  return parseMotionLibrary(JSON.parse(await boundedMotionText(response, MOTION_REGISTRY_MAX_BYTES)));
}

/** Match the reviewed performance's mood while retaining explicit art direction. */
export function expressionForMotion(motion: LibraryMotion): DoreumiExpression {
  if (motion.expression) return motion.expression;
  const label = motion.label.toLowerCase();
  if (/heart|love|kiss/.test(label)) return 'love';
  if (/sleep|doz|\bnap\b/.test(label)) return 'sleepy';
  if (/yawn|catching_breath/.test(label)) return 'yawning';
  if (/confus|scratch/.test(label)) return 'confused';
  if (/angry|stomp/.test(label)) return 'annoyed';
  if (/cry|weep|sad/.test(label)) return 'soft_sad';
  if (/victory|cheer|clap/.test(label)) return 'cheering';
  if (/happy|excited|funny|dance|groove/.test(label)) return 'sparkly';
  if (/hello|wave|bow|greet/.test(label)) return 'greeting_smile';
  if (/listen|call|chat|discuss/.test(label)) return 'listening';
  if (/think|ponder/.test(label)) return 'thinking';
  if (/alert|look|scan|peek/.test(label)) return 'curious';
  if (/lift|kettle|squat|exercise/.test(label)) return 'determined';
  return 'smile';
}

/** Family-first sampling keeps 176 walks from crowding out playful gestures. */
export function chooseAmbientMotion(motions: LibraryMotion[], recent: readonly string[], random = Math.random): LibraryMotion | null {
  const eligible = motions.filter(item => item.review === 'passed' && item.ambient && item.url
    && !item.exclusionReason && contextPropsSupport(item.props, item.sourceActionId, item.environmentSupport).supported && !recent.includes(item.id));
  if (!eligible.length) return null;
  const families = [...new Set(eligible.map(item => item.family))];
  const family = families[Math.min(families.length - 1, Math.floor(random() * families.length))];
  const pool = eligible.filter(item => item.family === family);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
