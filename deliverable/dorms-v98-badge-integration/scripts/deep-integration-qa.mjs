import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { COMBOS } from '../src/combos.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseUrl = process.env.DOREUMI_BASE_URL ?? `http://127.0.0.1:${process.env.DOREUMI_PORT ?? 43198}`;
const out = 'evidence/deep-qa';
await mkdir(out, { recursive: true });
const report = { success: false, errors: [], expressions: [], actions: [], combinations: [], badges: [], simultaneous: [], seasonal: [] };
const browser = await chromium.launch({ headless: true });

async function capture(page, name) {
  await page.evaluate(async () => {
    const r = window.__v98;
    await r.viewer.renderer.compileAsync(r.viewer.scene, r.viewer.camera);
    r.viewer.renderer.render(r.viewer.scene, r.viewer.camera);
  });
  const data = await page.locator('#scene').evaluate((canvas) => canvas.toDataURL());
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  await writeFile(`${out}/${name}.png`, bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => report.errors.push({ type: 'page', message: String(error) }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() });
  });
  page.on('requestfailed', (request) => report.errors.push({ type: 'request', url: request.url(), message: request.failure()?.errorText }));
  await page.goto(`${baseUrl}/`);
  await page.waitForFunction(() => window.__v98?.getState().ready);
  const manifest = await page.evaluate(() => window.__v98.manifest);
  assert.equal(manifest.expressions.length, 34);
  assert.equal(manifest.actions.length, 21);
  assert.equal(manifest.props.filter((prop) => prop.slot).length, 17);
  assert.equal(manifest.badges.length, 20);

  await page.evaluate(() => { const r = window.__v98; r.reset(); r.setView('front'); r.setZoom(1.55); });
  for (const asset of manifest.expressions) {
    await page.evaluate((id) => window.__v98.selectExpression(id), asset.id);
    const state = await page.evaluate(() => window.__v98.getState());
    assert.equal(state.expression, asset.id);
    assert.equal(state.material.expressionId, asset.id);
    assert.equal(state.material.newEyeOrMouthDrawn, false);
    const hash = await capture(page, `expression-${asset.id}`);
    report.expressions.push({ id: asset.id, label: asset.label, version: asset.version, hash, material: state.material });
  }

  await page.evaluate(() => { const r = window.__v98; r.reset(); r.setView('quarter'); r.setZoom(1.35); });
  for (let actionIndex = 0; actionIndex < manifest.actions.length; actionIndex += 1) {
    const action = manifest.actions[actionIndex];
    const samples = [];
    await page.evaluate((name) => window.__v98.play(name), action);
    for (const percent of [0, 25, 50, 75, 100]) {
      const sample = await page.evaluate((position) => {
        const r = window.__v98;
        const T = r.THREE;
        r.seek(position);
        r.viewer.model.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(r.viewer.model, true);
        const bones = [];
        r.viewer.model.traverse((object) => {
          if (object.isBone) bones.push({ name: object.name, q: object.quaternion.toArray(), p: object.position.toArray() });
        });
        return { percent: position, min: box.min.toArray(), max: box.max.toArray(), floor: r.viewer.floor.position.y, bones };
      }, percent);
      assert.ok([...sample.min, ...sample.max].every(Number.isFinite));
      assert.ok(sample.min[1] >= sample.floor - 0.035, `${action} floor penetration ${sample.min[1] - sample.floor}`);
      for (const bone of sample.bones) {
        assert.ok([...bone.q, ...bone.p].every(Number.isFinite), `${action} non-finite ${bone.name}`);
        assert.ok(Math.abs(Math.hypot(...bone.q) - 1) < 0.002, `${action} quaternion ${bone.name}`);
      }
      samples.push(sample);
    }
    if (actionIndex % 3 === 0) {
      for (const view of ['front', 'side']) {
        await page.evaluate((view) => { window.__v98.setView(view); window.__v98.seek(50); }, view);
        await capture(page, `action-${action}-${view}`);
      }
    }
    report.actions.push({ action, samples });
  }

  for (const combo of COMBOS) {
    await page.evaluate(async (selected) => {
      const { COMBO_STEPS } = await import('/src/combos.mjs');
      const r = window.__v98;
      for (const step of COMBO_STEPS(r, selected)) await step();
      r.setZoom(1.3);
    }, combo);
    const samples = [];
    for (const percent of [0, 35, 70, 100]) {
      const state = await page.evaluate((position) => { const r = window.__v98; r.seek(position); return r.getState(); }, percent);
      assert.equal(state.model.active, combo.action);
      if (combo.head) {
        assert.equal(state.attachments.head?.id, combo.head);
        assert.ok(state.attachments.head.visible);
        assert.ok(state.attachments.head.contactError < 1e-5);
      }
      if (combo.hand) {
        assert.equal(state.attachments.hand?.id, combo.hand);
        assert.ok(state.attachments.hand.visible);
        assert.ok(state.attachments.hand.contactError < 1e-5);
      }
      if (combo.scene) {
        assert.equal(state.sceneProp?.id, combo.scene);
        assert.ok(state.sceneProp.visible);
        assert.ok(Math.abs(state.sceneProp.bottom - state.sceneProp.support) < 1e-5);
      }
      samples.push({ percent, head: state.attachments.head, hand: state.attachments.hand, scene: state.sceneProp });
    }
    for (const view of ['front', 'side']) {
      await page.evaluate((view) => { window.__v98.setView(view); window.__v98.seek(50); }, view);
      await capture(page, `combo-${combo.id}-${view}`);
    }
    report.combinations.push({ id: combo.id, action: combo.action, samples });
  }

  await page.evaluate(() => { const r = window.__v98; r.reset(); r.setCandidateMode(true); r.setView('front'); r.setZoom(1.35); });
  for (const asset of manifest.badges) {
    await page.evaluate((id) => window.__v98.selectBadge(id), asset.id);
    const state = await page.evaluate(() => window.__v98.getState());
    assert.equal(state.badge?.id, asset.id);
    assert.ok(state.badge.visible);
    assert.ok(Math.abs(state.badge.surfaceGap - 0.006) < 1e-5);
    assert.ok(state.badge.textures.every((texture) => texture.width === 2048 && texture.height === 2048
      && !texture.normalMap && !texture.metalnessMap && texture.metalness === 0 && Math.abs(texture.roughness - 0.38) < 1e-6));
    await capture(page, `badge-${asset.id}-front`);
    report.badges.push({ id: asset.id, state: state.badge });
  }

  const simultaneous = [
    { id: 'winter-tools', expression: 'greeting_smile', action: 'CarryBag', head: 'santa-hat', hand: 'christmas-gift-sack', badge: 'hello', season: 'winter', effect: 'red' },
    { id: 'wand-badge', expression: 'cheering', action: 'Cheer', head: 'seollal-hairpin', hand: 'magic-wand', badge: 'maker', effect: 'purple' },
    { id: 'code-badge', expression: 'focused', action: 'Code', scene: 'laptop', badge: 'code', effect: 'cyan' },
  ];
  for (const combination of simultaneous) {
    await page.evaluate(async (selected) => {
      const r = window.__v98;
      r.reset(); r.setCandidateMode(true);
      await r.selectExpression(selected.expression);
      if (selected.head) await r.selectProp('head', selected.head);
      if (selected.hand) await r.selectProp('hand', selected.hand);
      if (selected.scene) await r.selectProp('scene', selected.scene);
      await r.selectBadge(selected.badge);
      if (selected.season) r.setSeason(selected.season);
      r.setEffect(selected.effect); r.play(selected.action); r.seek(50); r.setZoom(1.3);
    }, combination);
    const state = await page.evaluate(() => window.__v98.getState());
    assert.equal(state.badge?.id, combination.badge);
    assert.equal(state.model.active, combination.action);
    assert.ok(Math.abs(state.badge.surfaceGap - 0.006) < 1e-5);
    if (combination.head) assert.equal(state.attachments.head?.id, combination.head);
    if (combination.hand) assert.equal(state.attachments.hand?.id, combination.hand);
    if (combination.scene) assert.equal(state.sceneProp?.id, combination.scene);
    for (const view of ['front', 'quarter', 'side']) {
      await page.evaluate((view) => window.__v98.setView(view), view);
      await capture(page, `simultaneous-${combination.id}-${view}`);
    }
    report.simultaneous.push({ id: combination.id, state });
  }

  const seasonal = [
    { id: 'spring-think', expression: 'thinking', action: 'Think', season: 'spring', effect: 'purple' },
    { id: 'summer-wave', expression: 'greeting_smile', action: 'Wave', season: 'summer', effect: 'cyan' },
    { id: 'autumn-moon', expression: 'relieved', action: 'Wave', season: 'autumn', effect: 'orange', head: 'chuseok-hairpin' },
    { id: 'winter-santa', expression: 'greeting_smile', action: 'CarryBag', season: 'winter', effect: 'red', head: 'santa-hat', hand: 'christmas-gift-sack' },
  ];
  for (const combination of seasonal) {
    await page.evaluate(async (selected) => {
      const r = window.__v98;
      r.reset(); r.setCandidateMode(true);
      await r.selectExpression(selected.expression); r.setEffect(selected.effect); r.setSeason(selected.season);
      if (selected.head) await r.selectProp('head', selected.head);
      if (selected.hand) await r.selectProp('hand', selected.hand);
      r.play(selected.action); r.seek(50); r.setView('front'); r.setZoom(1.3);
    }, combination);
    const state = await page.evaluate(() => window.__v98.getState());
    assert.equal(state.expression, combination.expression);
    assert.equal(state.model.active, combination.action);
    assert.equal(state.season, combination.season);
    assert.equal(state.effect, combination.effect);
    await capture(page, `season-${combination.id}`);
    report.seasonal.push({ id: combination.id, state });
  }

  await page.evaluate(() => window.__v98.selectBadge(''));
  assert.equal(await page.evaluate(() => window.__v98.getState().badge), null);
  report.expressionUniqueHashes = new Set(report.expressions.map((item) => item.hash)).size;
  assert.ok(report.expressionUniqueHashes >= 30, 'too many expressions rendered identically');
  report.invariants = await page.evaluate(() => window.__v98.invariants());
  assert.ok(report.invariants.unchanged);
  assert.deepEqual(report.errors, []);
  report.success = true;
} catch (error) {
  report.error = String(error);
  console.error(error);
} finally {
  await writeFile('reports/deep-integration-validation.json', JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ success: report.success, error: report.error, errors: report.errors.length,
  expressions: report.expressions.length, unique: report.expressionUniqueHashes, actions: report.actions.length,
  combinations: report.combinations.length, badges: report.badges.length, simultaneous: report.simultaneous.length,
  seasonal: report.seasonal.length }));
if (!report.success) process.exitCode = 1;
