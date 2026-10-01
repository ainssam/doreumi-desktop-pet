import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMotionLibrary, chooseAmbientMotion, type LibraryMotion } from '../src/lib/doreumi/motion-library.ts';
import { doreumiSeason } from '../src/lib/doreumi/seasons.ts';

const item = (id: number, family = 'play'): LibraryMotion => ({ id: `meshy:${id}`, sourceActionId: id, label: `motion ${id}`, duration: 3, family, review: 'passed', ambient: true, url: `/doreumi/motions/meshy-${id}.json` });
test('the random director never promotes pending, failed, excluded, unavailable or unsupported prop clips', () => {
  const entries: LibraryMotion[] = [item(1), { ...item(2), review: 'pending' }, { ...item(3), review: 'failed' }, { ...item(4), ambient: false }, { ...item(5), url: undefined }, { ...item(6), props: ['chair'] }];
  for (let seed = 0; seed < 100; seed++) assert.equal(chooseAmbientMotion(entries, [], () => seed / 100)?.id, 'meshy:1');
  assert.equal(chooseAmbientMotion(entries, ['meshy:1']), null);
});
test('supported props require the reviewed action and respect explicit exclusions', () => {
  const phone = { ...item(29), props: ['phone'] };
  assert.equal(chooseAmbientMotion([phone], [])?.id, 'meshy:29');
  for (const entry of [
    { ...phone, review: 'pending' as const },
    { ...phone, exclusionReason: 'contact review failed' },
    { ...item(1), props: ['phone'] },
    { ...phone, props: ['weapon'] },
    { ...phone, props: ['phone', 'chair'] },
  ]) assert.equal(chooseAmbientMotion([entry], []), null);
  assert.throws(() => parseMotionLibrary({ version: 1, motions: [{ ...phone, props: 'phone' }] }));
});
test('family selection reaches every eligible ID and avoids the recent history', () => {
  const entries = [item(1), item(2), item(3, 'walk'), item(4, 'walk')];
  const seen = new Set<string>();
  for (const family of [.1, .9]) for (const member of [.1, .9]) { let call = 0; seen.add(chooseAmbientMotion(entries, [], () => call++ ? member : family)!.id); }
  assert.equal(seen.size, 4);
  assert.equal(chooseAmbientMotion(entries, ['meshy:1', 'meshy:2', 'meshy:3'], () => 0)?.id, 'meshy:4');
});
test('registry rejects duplicate IDs, outside URLs and mismatched provenance', () => {
  for (const motions of [[item(1), item(1)], [{ ...item(1), url: 'https://example.com/clip.json' }], [{ ...item(1), sourceActionId: 2 }]]) assert.throws(() => parseMotionLibrary({ version: 1, motions }));
});
test('season dates use KST inclusive boundaries without inventing unknown lunar dates', () => {
  assert.equal(doreumiSeason(new Date('2026-09-21T14:59:59Z')), 'everyday');
  assert.equal(doreumiSeason(new Date('2026-09-21T15:00:00Z')), 'chuseok');
  assert.equal(doreumiSeason(new Date('2026-09-28T14:59:59Z')), 'chuseok');
  assert.equal(doreumiSeason(new Date('2026-09-28T15:00:00Z')), 'everyday');
  assert.equal(doreumiSeason(new Date('2027-02-06T15:00:00Z')), 'seollal');
  assert.equal(doreumiSeason(new Date('2026-12-17T15:00:00Z')), 'christmas');
  assert.equal(doreumiSeason(new Date('2035-09-25T00:00:00Z')), 'everyday');
});
