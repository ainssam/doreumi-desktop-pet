import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The avatar sizes its canvas with a copy of the runtime margins (to keep the runtime lazily loaded).
test('avatar canvas margins match the runtime stable framing', () => {
  const runtime = fs.readFileSync(new URL('../src/lib/doreumi/motion-runtime.ts', import.meta.url), 'utf8');
  const avatar = fs.readFileSync(new URL('../src/components/doreumi/DoreumiAvatar.tsx', import.meta.url), 'utf8');
  const read = source => { const m = /\{\s*top:\s*([.\d]+),\s*bottom:\s*([.\d]+),\s*side:\s*([.\d]+)\s*\}/.exec(source); return m && m.slice(1).map(Number); };
  assert.deepEqual(read(avatar), read(runtime.slice(runtime.indexOf('DOREUMI_STABLE_FRAMING'))));
});

// Every approved ambient motion must fit inside the enlarged canvas when the camera stays on the standing frame.
test('the margins hold the tallest and lowest approved ambient motions', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('../public/doreumi/motions/registry.json', import.meta.url), 'utf8'));
  const motions = (registry.motions ?? registry).filter(m => m.ambient && m.review === 'passed' && m.frame);
  const standing = { centerY: 1.14, halfHeight: 1.34 }, stable = { top: .32, bottom: .25 };
  const top = standing.centerY + standing.halfHeight + stable.top * 2 * standing.halfHeight;
  const bottom = standing.centerY - standing.halfHeight - stable.bottom * 2 * standing.halfHeight;
  for (const m of motions) {
    const centers = m.frame.tracking?.centerY ?? [m.frame.centerY];
    assert.ok(Math.max(...centers) + m.frame.halfHeight <= top + 1e-6, `${m.id} top`);
    assert.ok(Math.min(...centers) - m.frame.halfHeight >= bottom - 1e-6, `${m.id} bottom`);
  }
});
