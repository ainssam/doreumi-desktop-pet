import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseUrl = process.env.DOREUMI_BASE_URL ?? `http://127.0.0.1:${process.env.DOREUMI_PORT ?? 43198}`;
const browser = await chromium.launch({ headless: true });
const frames = 'evidence/motion-frames';
await mkdir(frames, { recursive: true });
const report = { success: false, errors: [], samples: [] };
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => report.errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('requestfailed', (request) => report.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`${baseUrl}/`);
  await page.waitForFunction(() => window.__v98?.getState().ready);
  await page.evaluate(async () => {
    const r = window.__v98;
    r.reset(); r.setCandidateMode(true);
    await r.selectExpression('cheering');
    await r.selectProp('head', 'seollal-hairpin');
    await r.selectProp('hand', 'magic-wand');
    await r.selectBadge('maker');
    r.setEffect('purple'); r.play('Cheer'); r.setView('quarter'); r.setZoom(1.45);
  });
  for (let index = 0; index < 36; index += 1) {
    const percent = (index % 18) / 17 * 100;
    const state = await page.evaluate((position) => {
      const r = window.__v98;
      r.seek(position);
      r.viewer.renderer.render(r.viewer.scene, r.viewer.camera);
      return r.getState();
    }, percent);
    assert.equal(state.model.active, 'Cheer');
    assert.equal(state.attachments.head?.id, 'seollal-hairpin');
    assert.equal(state.attachments.hand?.id, 'magic-wand');
    assert.equal(state.badge?.id, 'maker');
    assert.ok(state.attachments.head.contactError < 1e-5);
    assert.ok(state.attachments.hand.contactError < 1e-5);
    assert.ok(Math.abs(state.badge.surfaceGap - 0.006) < 1e-5);
    const data = await page.locator('#scene').evaluate((canvas) => canvas.toDataURL());
    await writeFile(`${frames}/frame-${String(index).padStart(3, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
    report.samples.push({ index, percent, headContactError: state.attachments.head.contactError,
      handContactError: state.attachments.hand.contactError, badgeSurfaceGap: state.badge.surfaceGap });
  }
  assert.deepEqual(report.errors, []);
  report.success = true;
} catch (error) {
  report.error = String(error);
  console.error(error);
} finally {
  await writeFile('reports/motion-evidence.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ success: report.success, frames: report.samples.length, errors: report.errors }));
if (!report.success) process.exitCode = 1;
