import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { chooseAmbientMotion, expressionForMotion } from '../src/lib/doreumi/motion-library.ts';
import { HOME_AMBIENT_ACTIONS as QUIET, SEASONAL_AMBIENT_ACTIONS as SEASONAL } from '../src/lib/doreumi/ambient-actions.ts';

const source = fs.readFileSync(new URL('../src/components/doreumi/useDoreumiPersonality.ts', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace('export function useDoreumiPersonality', 'function useDoreumiPersonality');
function harness(imported = true, options = {}) {
  const timers = [], poses = [], effects = [], listeners = new Map(); let now = 0;
  const media = { matches: false, addEventListener: (name, fn) => listeners.set(`media:${name}`, fn), removeEventListener() {} };
  const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} };
  const context = vm.createContext({ AbortController, Math: Object.assign(Object.create(Math), { random: () => 0 }),
    useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => [value, pose => poses.push({ at: now, ...pose })], useEffect: fn => effects.push(fn),
    setTimeout: (fn, ms) => { const timer = { fn, at: now + ms }; timers.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cancelled = true; },
    window: { matchMedia: () => media }, document, fetchMotionLibrary: async () => ({ motions: options.entries ?? [] }),
    canPlayMotion: options.canPlay, doreumiSeason: () => 'everyday',
    QUIET, SEASONAL,
    expressionForMotion,
    chooseAmbientMotion: options.entries ? (entries, recent) => chooseAmbientMotion(entries, recent, () => 0) : () => imported ? { id: 'meshy:27', duration: 1.5, expression: 'smile' } : null,
  });
  const result = vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + ';useDoreumiPersonality(true, canPlayMotion);', context);
  const cleanup = effects.map(fn => fn());
  const advance = target => { for (;;) { const timer = timers.filter(t => !t.cancelled && !t.ran && t.at <= target).sort((a, b) => a.at - b.at)[0]; if (!timer) break; now = timer.at; timer.ran = true; timer.fn(); } now = target; };
  const frame = (action, time = 0, paused = false) => result.onMotionFrame({ action, time, paused, duration: 1.5, pixelsPerUnit: 100 });
  return { poses, advance, frame, cleanup, media, document, listeners };
}

test('a slow first clip download does not consume playback duration, and repeated frames do not reset expiry', () => {
  const h = harness(); h.advance(1200); assert.equal(h.poses.at(-1).action, 'meshy:27');
  h.frame('Idle'); h.advance(3200); assert.equal(h.poses.at(-1).action, 'meshy:27');
  h.frame('meshy:27', .1); h.advance(3700); h.frame('meshy:27', .6);
  h.advance(4599); assert.equal(h.poses.at(-1).action, 'meshy:27');
  h.advance(4600); assert.equal(h.poses.at(-1).action, 'Idle');
});

test('the actual director refuses an approved motion without runway and selects an available motion or local fallback', async () => {
  const entry = id => ({ id: `meshy:${id}`, label: 'walk', sourceActionId: id, duration: 3, family: 'walk', review: 'passed', ambient: true, url: `/doreumi/motions/meshy-${id}.json` });
  for (const allowed of [1, null]) {
    const seen = [], h = harness(true, { entries: [entry(518), entry(1)], canPlay: motion => { seen.push(motion.sourceActionId); return motion.sourceActionId === allowed; } });
    await Promise.resolve(); h.advance(1200);
    assert.deepEqual(seen, [518, 1]);
    assert.equal(h.poses.at(-1).action, allowed === 1 ? 'meshy:1' : 'Code');
    assert.equal(h.poses.some(pose => pose.action === 'meshy:518'), false);
    h.cleanup.forEach(fn => fn());
  }
});
test('local Code receives its full hold after actual playback starts', () => {
  const h = harness(false); h.advance(1200); assert.equal(h.poses.at(-1).action, 'Code');
  h.advance(5200); h.frame('Code'); h.advance(15199); assert.equal(h.poses.at(-1).action, 'Code');
  h.advance(15200); assert.equal(h.poses.at(-1).action, 'Idle');
});
test('a load that never starts expires after 30 seconds and schedules another attempt', () => {
  const h = harness(); h.advance(31199); assert.equal(h.poses.at(-1).action, 'meshy:27');
  h.advance(31200); assert.equal(h.poses.at(-1).action, 'Idle'); h.advance(32400); assert.equal(h.poses.at(-1).action, 'meshy:27');
});
test('hidden, reduced motion, and unmount cancel pending performances', () => {
  for (const kind of ['hidden', 'reduced', 'unmount']) {
    const h = harness(); h.advance(1200);
    if (kind === 'hidden') { h.document.hidden = true; h.listeners.get('visibilitychange')(); }
    if (kind === 'reduced') { h.media.matches = true; h.listeners.get('media:change')(); }
    if (kind === 'paused') h.frame('meshy:27', 0, true);
    if (kind === 'unmount') h.cleanup.forEach(fn => fn());
    const count = h.poses.length; h.frame('meshy:27'); h.advance(100000); assert.equal(h.poses.length, count, kind);
    if (kind !== 'unmount') assert.equal(h.poses.at(-1).action, 'Idle');
  }
});

test('paused frames cancel idle and active timers and the first resumed frame schedules one new performance', () => {
  for (const pauseAt of [600, 1200]) {
    const h = harness(); h.advance(pauseAt); h.frame('meshy:27', 0, true);
    const count = h.poses.length;
    h.advance(100000); assert.equal(h.poses.length, count);
    h.frame('Idle', 0, true); assert.equal(h.poses.length, count);
    h.frame('Idle'); h.advance(100600); h.frame('Idle');
    h.advance(101199); assert.equal(h.poses.at(-1).action, 'Idle');
    h.advance(101200); assert.equal(h.poses.at(-1).action, 'meshy:27');
    h.cleanup.forEach(fn => fn());
  }
});

test('resuming while hidden or reduced motion stays idle until that constraint clears', () => {
  for (const kind of ['hidden', 'reduced']) {
    const h = harness(); h.advance(1200); h.frame('meshy:27', 0, true);
    if (kind === 'hidden') h.document.hidden = true; else h.media.matches = true;
    h.frame('Idle'); h.advance(100000); assert.equal(h.poses.at(-1).action, 'Idle');
    if (kind === 'hidden') { h.document.hidden = false; h.listeners.get('visibilitychange')(); }
    else { h.media.matches = false; h.listeners.get('media:change')(); }
    h.advance(120000); assert.equal(h.poses.at(-1).action, 'meshy:27');
    h.cleanup.forEach(fn => fn());
  }
});

test('every authored action the director picks exists and is approved in the manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/doreumi/manifest.json', import.meta.url), 'utf8'));
  const picked = [...QUIET, ...Object.values(SEASONAL)].map(item => item.action);
  assert.ok(picked.length >= 16);
  for (const action of picked) assert.equal(manifest.actions.find(a => a.id === action)?.approval, 'approved', action);
});
