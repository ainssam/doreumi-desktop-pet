/** Main visual lane only. One browser/context/page, sequential widths and states.
 * node scripts/doreumi/motion-qa.mjs --base-url=http://127.0.0.1:3000 [--animate]
 * Optional CDP_URL attaches to the main-controlled browser instead of launching one.
 * --stop-file=PATH stops after the current action with an incomplete report (exit 2).
 */
import { chromium } from 'playwright';
import { access, readFile, mkdir, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { parseDoreumiTravel } from '../../src/lib/doreumi/motion-travel.ts';
import { parseDoreumiEnvironment } from '../../src/lib/doreumi/motion-environment-contract.ts';
import { parseMaterialDiagnostic, instrumentMaterialDiagnostic, parseUvDiagnostic, instrumentUvDiagnostic } from './qa-material-diagnostic.mjs';
import { validateSkinCandidateModel, validateSkinCandidateSource, validateSkinCandidateContact } from './qa-skin-candidate.mjs';

const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base-url', 'http://127.0.0.1:3000');
const output = path.resolve(arg('output', '.collab-backend-react/doreumi-motion'));
const animate = process.argv.includes('--animate');
const cameraInterruptions = process.argv.includes('--camera-interruptions');
if (cameraInterruptions && (!process.argv.includes('--isolated-component') || !process.argv.includes('--library'))) throw Error('Camera interruption review requires the isolated library runtime');
const angles = arg('angles', '0').split(',').map(Number);
const fractions = arg('fractions', '0,.25,.5,.75,1').split(',').map(Number);
const playbackRate = Number(arg('speed', '1'));
if (!Number.isFinite(playbackRate) || playbackRate < .1 || playbackRate > 3) throw Error('Invalid playback rate');
const materialDiagnostic = parseMaterialDiagnostic(arg('material-diagnostic', 'production'), process.argv.includes('--isolated-component'));
const uvDiagnostic = parseUvDiagnostic(arg('uv-diagnostic', 'production'), process.argv.includes('--isolated-component'));
const expressionMode = process.argv.includes('--ambient-expression') ? 'production-motion-mood' : arg('expression', 'neutral');
const stopFile = arg('stop-file', '');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile('public/doreumi/manifest.json', 'utf8'));
const testedModel = await readFile(arg('model-file', 'public/doreumi/doreumi-master.glb'));
const modelSha256 = createHash('sha256').update(testedModel).digest('hex');
const testedRegistryBytes = await readFile('public/doreumi/motions/registry.json');
const testedRegistry = JSON.parse(testedRegistryBytes);
const sourceRegistrySha256 = createHash('sha256').update(testedRegistryBytes).digest('hex');
let registrySha256 = sourceRegistrySha256;
let clipOverrideEvidence = null;
let runtimeBundleSha256 = null;
const testedClips = new Map();
const clipHashes = {};
const clipOverride = arg('clip-override', '');
if (process.argv.includes('--skin-candidate') && (!clipOverride || !process.argv.includes('--isolated-component') || !process.argv.includes('--library')))
  throw Error('Skin candidate preview requires an isolated library clip override');
let overrideBytes;
if (clipOverride) {
  if (!process.argv.includes('--isolated-component') || !process.argv.includes('--library')) throw Error('Clip preview requires isolated-component and library mode');
  const requested = arg('actions', '').split(',').filter(Boolean);
  if (requested.length !== 1) throw Error('Clip preview requires exactly one explicit action');
  const allowed = await realpath('.artifacts/doreumi-contact-audit');
  const filename = await realpath(clipOverride);
  if (!filename.startsWith(allowed + path.sep) || !filename.endsWith('.json')) throw Error('Clip preview is limited to local contact-audit JSON candidates');
  overrideBytes = await readFile(filename);
  const clip = JSON.parse(overrideBytes), hash = createHash('sha256').update(overrideBytes).digest('hex');
  const candidateBytes = await readFile(path.join(path.dirname(filename), 'manifest.json'));
  const candidate = JSON.parse(candidateBytes);
  const imported = candidate.motions?.find(item => `meshy:${item.actionId}` === requested[0]);
  const motion = testedRegistry.motions.find(item => item.id === requested[0]);
  const contact = JSON.parse(await readFile(path.join(path.dirname(filename), 'contact.json'), 'utf8'));
  const sources = JSON.parse(await readFile('public/doreumi/motions/meshy-source-manifest.json', 'utf8'));
  const contract = JSON.parse(await readFile('public/doreumi/rig-contract.json', 'utf8'));
  const original = sources.motions.find(item => item.actionId === imported?.actionId);
  const contactClip = Array.isArray(contact.clips) ? contact.clips.find(item => item.actionId === imported?.actionId) : contact;
  let skinCandidateProof;
  if (process.argv.includes('--skin-candidate')) {
    const modelPath = await realpath(arg('model-file', ''));
    if (!modelPath.startsWith(allowed + path.sep) || !modelPath.endsWith('.glb')) throw Error('Skin candidate model must stay inside local contact-audit artifacts');
    if (!motion || !imported || !original || !contactClip || candidate.masterSha256 !== modelSha256
      || candidate.parentMasterSha256 !== motion.masterSha256 || contact.parentMasterSha256 !== motion.masterSha256
      || imported.retargetEvidence?.masterSha256 !== modelSha256
      || imported.retargetEvidence?.skinCandidate?.candidateMasterSha256 !== modelSha256
      || imported.retargetEvidence?.skinCandidate?.parentMasterSha256 !== motion.masterSha256
      || contactClip.sourceSha256 !== original.sourceSha256)
      throw Error('Skin candidate preview provenance mismatch');
    skinCandidateProof = await validateSkinCandidateModel(await readFile('public/doreumi/doreumi-master.glb'), testedModel,
      { parentMasterSha256: motion.masterSha256, masterSha256: modelSha256, rigSignature: contract.rigSignature });
    const ledger = JSON.parse(await readFile('.artifacts/doreumi-meshy/ledger.json', 'utf8'));
    const sourceBatch = ledger.batches?.find(batch => batch.status === 'downloaded' && batch.actionIds?.includes(imported.actionId) && batch.id === original.batchId);
    if (!sourceBatch?.file) throw Error('Skin candidate is missing its acquired donor');
    const sourceRoot = await realpath('.artifacts/doreumi-meshy'), sourcePath = await realpath(path.join(sourceRoot, sourceBatch.file));
    if (!sourcePath.startsWith(sourceRoot + path.sep) || !sourcePath.endsWith('.glb')) throw Error('Skin candidate donor must remain in its acquisition directory');
    const sourceProof = await validateSkinCandidateSource(await readFile(sourcePath), original.sourceSha256);
    validateSkinCandidateContact(imported, contactClip, clip, contract, { ...skinCandidateProof, ...sourceProof });
    skinCandidateProof = { ...skinCandidateProof, ...sourceProof };
  }
  if (candidate.candidate !== true || !motion || !imported || !original || clip.name !== motion.id || imported.convertedSha256 !== hash
    || contact.modelSha256 !== modelSha256 || motion.masterSha256 !== (skinCandidateProof?.parentMasterSha256 ?? modelSha256) || contactClip?.clipSha256 !== hash
    || !/^[a-f0-9]{64}$/.test(original.sourceSha256) || imported.sourceSha256 !== original.sourceSha256
    || !contract.rigSignature || imported.targetRigSignature !== contract.rigSignature
    || ((Array.isArray(contact.clips) || contactClip.sourceSha256 !== undefined) && contactClip.sourceSha256 !== original.sourceSha256)
    || (contact.manifestSha256 !== undefined && contact.manifestSha256 !== createHash('sha256').update(candidateBytes).digest('hex')))
    throw Error('Clip preview candidate/contact/source/master/rig provenance mismatch');
  const framing = imported.retargetEvidence?.framing, planar = imported.retargetEvidence?.planarSupport;
  if ([imported.duration, imported.retargetEvidence?.duration].some(duration => duration !== undefined
    && (!Number.isFinite(duration) || Math.abs(duration - clip.duration) > 1e-5)))
    throw Error('Clip preview duration metadata mismatch');
  const tracking = framing?.tracking;
  if (!framing || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 180
    || !Number.isFinite(framing.halfHeight) || framing.halfHeight < 1 || framing.halfHeight > 10
    || !Number.isFinite(framing.centerY) || Math.abs(framing.centerY) > 10
    || (tracking !== undefined && (!tracking || !Array.isArray(tracking.times) || !Array.isArray(tracking.centerY)
      || tracking.times.length < 2 || tracking.times.length > 10802 || tracking.times.length !== tracking.centerY.length
      || tracking.times[0] !== 0 || Math.abs(tracking.times.at(-1) - clip.duration) > 1e-5
      || tracking.times.some((time, index) => !Number.isFinite(time) || time < 0 || time > clip.duration + 1e-5
        || (index > 0 && time <= tracking.times[index - 1]) || !Number.isFinite(tracking.centerY[index]) || Math.abs(tracking.centerY[index]) > 10))))
    throw Error('Clip preview has invalid framing or duration');
  const travel = imported.retargetEvidence?.semantics?.travel;
  if (travel) {
    parseDoreumiTravel(travel, clip.duration);
    if (planar) throw Error('Stage preview must split planar support into travel');
    const rootTrack = clip.tracks.find(track => track.name === 'DoreumiRig.position');
    if (!rootTrack || rootTrack.values.some((value, index) => index % 3 !== 1 && (!Number.isFinite(value) || Math.abs(value) > 1e-8))) throw Error('Stage preview contains duplicate root XZ travel');
  } else if (planar) {
    if (!Number.isFinite(planar.maxOffset) || planar.maxOffset < 0 || planar.maxOffset > 2) throw Error('Clip preview has invalid planar evidence');
  } else if (skinCandidateProof && imported.actionId === 451) {
    // Its exact stationary root and actual fixed palm support were verified by
    // validateSkinCandidateContact. The general override remains unchanged.
  } else {
    // The source502 cycle is entirely airborne. Its explicit authored flight
    // has no planar support to split, and must not invent a contact report.
    const flight = imported.retargetEvidence?.airborneFall, support = contactClip?.supportPhases;
    const rootTrack = clip.tracks.find(track => track.name === 'DoreumiRig.position');
    const finiteRange = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
    const timing = imported.retargetEvidence;
    if (imported.actionId !== 502 || flight?.version !== 2 || flight.authoredRoot !== true || flight.sourceRootIsBallistic !== false
      || flight.sourceTimeRetimed !== true || flight.cameraPolicy !== 'fixed-ground' || framing.tracking !== undefined
      || !finiteRange(flight.sourceTimeScale, 1, 16) || !finiteRange(flight.playbackSourceDuration, .01, 10)
      || !finiteRange(flight.sourceCoreDuration, .01, 120)
      || Math.abs(flight.sourceTimeScale * flight.playbackSourceDuration - flight.sourceCoreDuration) > 1e-5
      || timing.sourceTimeScale !== flight.sourceTimeScale || timing.playbackSourceDuration !== flight.playbackSourceDuration
      || timing.sourceDuration !== flight.sourceCoreDuration || !finiteRange(timing.entryDuration, 0, clip.duration) || !finiteRange(timing.exitDuration, 0, clip.duration)
      || Math.abs(timing.entryDuration + timing.playbackSourceDuration + timing.exitDuration - clip.duration) > 1e-5
      || !finiteRange(flight.takeoff, .001, clip.duration) || !finiteRange(flight.impact, flight.takeoff + .001, clip.duration - .001)
      || timing.entryDuration < flight.takeoff || timing.entryDuration + timing.playbackSourceDuration > flight.impact
      || flight.verifiedSourceSha256 !== original.sourceSha256 || flight.verifiedMasterSha256 !== modelSha256
      || flight.airborneSupport !== 'none' || flight.palmContactClaimed !== false || contactClip?.airborneSupport !== 'none' || contactClip.palmContactClaimed !== false
      || contactClip?.sourceAirborne?.confirmed !== true || contactClip.sourceAirborne.originalRootIsBallistic !== false
      || !finiteRange(contactClip.sourceAirborne.minimumSkinY - contactClip.sourceAirborne.restFloor, .2, 10)
      || !finiteRange(contactClip?.bounds?.minY, -.001, .01) || !finiteRange(contactClip.bounds.maxY, .01, 10)
      || !finiteRange(contactClip?.minimumCoreSkinY, .05, 10) || contactClip?.fps !== 120
      || !finiteRange(contactClip?.maximumRootBallisticError, 0, .00001) || !finiteRange(contactClip?.maximumPreservedCoreQuaternionError, 0, .001)
      || !finiteRange(contract.height, .1, 10) || !Array.isArray(support) || support.length !== 2
      || support.some((phase, index) => !phase || !Number.isSafeInteger(phase.samples) || !finiteRange(phase.samples, Math.ceil((phase.to - phase.from) * 120), 100000)
        || phase.from !== (index === 0 ? 0 : flight.impact) || phase.to !== (index === 0 ? flight.takeoff : clip.duration)
        || !finiteRange(phase.minimumFootY, -.001, .02) || !finiteRange(phase.maximumFootMinimumY, 0, .02)
        || !finiteRange(phase.maximumMaterialPointDrift, 0, contract.height * .01))
      || !rootTrack || rootTrack.values.some((value, index) => index % 3 !== 1 && (!Number.isFinite(value) || Math.abs(value) > 1e-8)))
      throw Error('Clip preview has invalid authored airborne support evidence');
  }
  const environmentSupport = imported.retargetEvidence.environmentSupport;
  if (environmentSupport !== undefined && (!parseDoreumiEnvironment(environmentSupport, imported.actionId) || travel || !planar))
    throw Error('Clip preview has invalid fixed environment');
  Object.assign(motion, { duration: clip.duration, convertedSha256: hash, masterSha256: modelSha256, frame: framing, planarSupport: planar ? { version: 1, maxOffset: planar.maxOffset } : undefined, travel, environmentSupport, entryDuration: imported.retargetEvidence.entryDuration, exitDuration: imported.retargetEvidence.exitDuration, review: 'pending', ambient: false });
  registrySha256 = createHash('sha256').update(JSON.stringify(testedRegistry)).digest('hex');
  clipOverrideEvidence = { id: motion.id, file: filename, sha256: hash, sourceRegistrySha256, candidateHelperSha256: candidate.helperSha256, ...(skinCandidateProof ? { skinCandidateProof } : {}) };
}

if (process.argv.includes('--library')) {
  const requested = arg('actions', '').split(',').filter(Boolean);
  for (const motion of testedRegistry.motions.filter(item => item.url && (!requested.length || requested.includes(item.id)))) {
    const bytes = clipOverrideEvidence?.id === motion.id ? overrideBytes : await readFile(path.join('public', motion.url));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== motion.convertedSha256) throw Error(`Refresh registry before reviewing changed clip ${motion.id}`);
    testedClips.set(motion.url, bytes); clipHashes[motion.id] = hash;
  }
}
if (process.argv.includes('--validate-inputs-only')) { console.log(JSON.stringify({ modelSha256, registrySha256, clipHashes, clipOverrideEvidence, materialDiagnostic, uvDiagnostic, diagnosticOnly: materialDiagnostic !== 'production' || uvDiagnostic !== 'production', browserStarted: false })); process.exit(0); }
const browser = process.env.CDP_URL ? await chromium.connectOverCDP(process.env.CDP_URL) : await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', ...(animate ? { recordVideo: { dir: path.join(output, 'video'), size: { width: 1280, height: 1000 } } } : {}) });
// Render the actual review component without starting a second development server.
// This supplements, rather than replaces, the integrated Responsively application checks.
if (process.argv.includes('--isolated-component')) {
  const { build } = await import('esbuild');
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Review from './src/app/dev/doreumi-motion/review.tsx'; createRoot(document.getElementById('root')).render(React.createElement(Review));`, resolveDir: process.cwd(), sourcefile: 'motion-review-entry.tsx', loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', format: 'esm', jsx: 'automatic', loader: { '.module.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"' },
    plugins: cameraInterruptions || animate || materialDiagnostic !== 'production' || uvDiagnostic !== 'production' ? [{ name: 'observe-rendered-camera', setup(builder) {
      builder.onLoad({ filter: /motion-runtime\.ts$/ }, async args => {
        const source = instrumentUvDiagnostic(instrumentMaterialDiagnostic(await readFile(args.path, 'utf8'), materialDiagnostic), uvDiagnostic), marker = 'renderer.render(scene, camera); renderedFrames++;';
        if (!source.includes(marker)) throw Error('Runtime camera observation hook changed');
        return { contents: source.replace(marker, marker + ' window.__DOREUMI_CAMERA_CAPTURE__?.(canvas);'), loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }] : [] });
  const files = new Map(bundle.outputFiles.map(file => [path.basename(file.path), file.contents]));
  runtimeBundleSha256 = createHash('sha256').update(files.get('stdin.js')).digest('hex');
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/dev/doreumi-motion') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{font-family:Arial,sans-serif;word-break:keep-all;overflow-wrap:anywhere}body{margin:0;background:#fbf8f1;color:#24242b}*{box-sizing:border-box}</style><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script type="module" src="/stdin.js"></script>` });
    const file = files.get(url.pathname.slice(1));
    if (file) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: Buffer.from(file) });
    if (url.pathname.startsWith('/doreumi/') && !url.pathname.includes('..')) {
      if (url.pathname === '/doreumi/doreumi-master.glb') return route.fulfill({ contentType: 'application/octet-stream', body: testedModel });
      if (url.pathname === '/doreumi/motions/registry.json') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(testedRegistry) });
      if (testedClips.has(url.pathname)) return route.fulfill({ contentType: 'application/json', body: testedClips.get(url.pathname) });
      try { return route.fulfill({ contentType: url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.webp') ? 'image/webp' : 'application/octet-stream', body: await readFile(path.join(process.cwd(), 'public', url.pathname)) }); } catch {}
    }
    return route.fulfill({ status: 404, body: '' });
  });
}
const page = await context.newPage();
const errors = [], failures = [], samples = [], expressions = [], transitions = [], sizes = [], playbackSamples = [];
let checkedActions = [];
const completedActionIds = [], gracefulStop = Symbol('graceful-stop'), samplesComplete = Symbol('samples-complete');
async function writeReport(name, report) {
  const destination = path.join(output, name), temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(report, null, 2));
  await rename(temporary, destination);
}
async function checkpoint(status = 'running', error) {
  const report = { checkedAt: new Date().toISOString(), base, modelSha256, registrySha256, clipOverrideEvidence, runtimeBundleSha256, runtimeFrozen: runtimeBundleSha256 !== null, materialDiagnostic, uvDiagnostic, diagnosticOnly: materialDiagnostic !== 'production' || uvDiagnostic !== 'production', clipHashes, source: manifest.source,
    status, complete: false, pass: false, finalChecksCompleted: false, animationPlaybackRecorded: animate, playbackRate, expressionMode, angles, fractions,
    naturalnessReview: 'pending-human-visual-inspection', requestedActionIds: checkedActions.map(action => action.id), completedActionIds: [...completedActionIds],
    counts: { actions: completedActionIds.length, requestedActions: checkedActions.length, samples: samples.length, expressions: expressions.length },
    samples, expressions, transitions, sizes, playbackSamples, errors, failures, ...(error ? { interruption: String(error) } : {}) };
  await writeReport('checkpoint.json', report);
  if (status !== 'running') await writeReport('report.json', report);
  return report;
}
async function stopRequested() {
  if (!stopFile) return false;
  try { await access(stopFile); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error' && /THREE|WebGL|shader|doreumi/i.test(message.text())) errors.push(message.text()); });
const inspect = () => page.evaluate(() => window.__DOREUMI_QA__.inspect());
function assert(condition, message) { if (!condition) failures.push(message); }
async function snapshot(name) {
  const file = path.join(output, `${name}.png`);
  // Read the rendered WebGL pixels in the same task. Locator screenshots wait
  // for layout stability per frame, making a 524-clip contact sheet need hours.
  const data = await page.evaluate(() => window.__DOREUMI_QA__.capture());
  await sharp(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).flatten({ background: '#fbf8f1' }).png().toFile(file);
  return file;
}
async function sheet(files, name, columns) {
  const tile = 180, composites = [];
  for (let i = 0; i < files.length; i++) composites.push({ input: await sharp(files[i]).resize(tile, tile, { fit: 'contain', background: '#fbf8f1' }).png().toBuffer(), left: (i % columns) * tile, top: Math.floor(i / columns) * tile });
  await sharp({ create: { width: columns * tile, height: Math.ceil(files.length / columns) * tile, channels: 3, background: '#fbf8f1' } }).composite(composites).jpeg({ quality: 88 }).toFile(path.join(output, name));
}
try {
  await page.goto(new URL('/dev/doreumi-motion', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-doreumi-stage] [data-doreumi-avatar="ready"]', { timeout: 60000 });
  const stageSize = Number(arg('stage-size', '0'));
  if (stageSize > 0) await page.locator('[data-doreumi-stage]').evaluate((element, size) => { element.style.width = `${size}px`; element.style.height = `${size}px`; }, stageSize);
  if (process.argv.includes('--skeleton')) await page.evaluate(() => window.__DOREUMI_QA__.skeleton(true));
  await page.evaluate(([season, speed]) => { window.__DOREUMI_QA__.season(season); window.__DOREUMI_QA__.speed(speed); }, [arg('season', 'everyday'), playbackRate]);
  const requestedActions = arg('actions', '').split(',').filter(Boolean);
  const imported = process.argv.includes('--library') ? testedRegistry.motions.filter(item => item.url) : [];
  checkedActions = [...(process.argv.includes('--library-only') ? [] : manifest.actions), ...imported]
    .filter(action => (!requestedActions.length || requestedActions.includes(action.id))
      && (!process.argv.includes('--prop-free') || !action.props?.length)
      && (!process.argv.includes('--with-props') || action.props?.length));
  if (!checkedActions.length) throw Error('No matching actions requested');
  await checkpoint();
  for (const action of checkedActions) {
    await page.evaluate(id => window.__DOREUMI_QA__.load(id), action.id);
    if (process.argv.includes('--ambient-expression') && action.id.startsWith('meshy:')) {
      await page.evaluate(motion => window.__DOREUMI_QA__.ambientExpression(motion), action);
    } else {
      await page.evaluate(expression => window.__DOREUMI_QA__.expression(expression), arg('expression', 'neutral'));
    }
    const frames = [];
    for (const angle of angles) {
      await page.evaluate(degrees => window.__DOREUMI_QA__.angle(degrees), angle);
      for (const fraction of fractions) {
      await page.evaluate(([id, time]) => window.__DOREUMI_QA__.seek(id, time), [action.id, action.duration * fraction]);
      if (['MegaphoneSpeak', 'CarryBag'].includes(action.id)) await page.waitForFunction(() => { const s = window.__DOREUMI_QA__.inspect(); return !!s?.prop || !!s?.propError; }, undefined, { timeout: 15000 });
      const state = await inspect();
      assert(state.finite, `${action.id}/${fraction}: nonfinite geometry`);
      assert(state.bodyWorldBounds.min[1] >= -.0214, `${action.id}/${fraction}: body penetrates floor by ${-state.bodyWorldBounds.min[1]}`);
      assert(!state.propError, `${action.id}: ${state.propError}`);
      assert(state.bounds.min[0] >= -.99 && state.bounds.max[0] <= .99 && state.bounds.min[1] >= -.99 && state.bounds.max[1] <= .99, `${action.id}/${fraction}: clipped ${JSON.stringify(state.bounds)}`);
      assert(!state.motionError, `${action.id}: ${state.motionError}`);
      frames.push(await snapshot(`action-${action.id.replace(':', '-')}-${angle}-${fraction}`)); samples.push({ id: action.id, angle, fraction, ...state });
      }
    }
    await sheet(frames, `motion-${action.id.replace(':', '-')}.jpg`, fractions.length);
    if (animate) {
      if (!process.argv.includes('--isolated-component')) {
        await page.evaluate(id => { window.__DOREUMI_QA__.seek(id, 0); window.__DOREUMI_QA__.play(id); }, action.id);
        await page.waitForTimeout((action.duration / playbackRate + .5) * 1000);
      } else {
        // Capture actual rendered frames and runtime time together. WebM file
        // birth times are asynchronous and cannot locate a clip's recovery.
        await page.evaluate(({ id, duration, rate }) => {
          if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(rate) || rate < .1 || rate > 3) throw Error('Invalid playback capture clock');
          window.__DOREUMI_QA__.seek(id, 0);
          const started = performance.now(), frames = [];
          let previous = -Infinity, seenAction = false, stableIdleAt = null;
          const run = window.__DOREUMI_PLAYBACK_RUN__ = { frames, done: false, error: null, coverage: null };
          const stop = error => { run.error = error; run.done = true; window.__DOREUMI_CAMERA_CAPTURE__ = undefined; };
          window.__DOREUMI_CAMERA_CAPTURE__ = canvas => {
            const now = performance.now();
            // Once the motion has settled into Idle, keep recording the
            // camera's real-time zoom rather than slowing that clock too.
            if (now - previous < (stableIdleAt === null ? 250 / rate : 250)) return;
            previous = now;
            if (frames.length >= 1000) { stop('Playback capture exceeded 1000 frames'); return; }
            try {
              if (![canvas.width, canvas.height].every(size => Number.isFinite(size) && size > 0 && size <= 8192)) throw Error('Invalid playback canvas dimensions');
              const state = window.__DOREUMI_QA__.inspect();
              seenAction ||= state.action === id;
              frames.push({ elapsed: (now - started) / 1000, state, data: canvas.toDataURL('image/png') });
              const imported = id.startsWith('meshy:');
              if (imported) {
                const stable = seenAction && state.action === 'Idle' && state.activeActions === 1 && !state.pending;
                stableIdleAt = stable ? stableIdleAt ?? (now - started) / 1000 : null;
              }
              const finished = imported
                ? stableIdleAt !== null && (now - started) / 1000 - stableIdleAt >= 2
                : now - started >= (duration / rate + .5) * 1000;
              if (!finished) return;
              if (imported) {
                const observed = frames.filter(frame => frame.state.action === id), times = observed.map(frame => frame.state.time);
                const tolerance = .25 + .1; // Scheduled source sampling interval plus rendered-frame jitter.
                run.coverage = { firstTime: times[0], lastTime: times.at(-1), duration, tolerance, observedFrames: times.length,
                  monotonic: times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= duration + 1e-4 && (!index || time >= times[index - 1] - 1e-6)),
                  finalAction: state.action, finalActiveActions: state.activeActions, stableIdleAt,
                  settledIdleSeconds: (now - started) / 1000 - stableIdleAt };
                if (times.length < 2 || !run.coverage.monotonic || times[0] > .1 || times.at(-1) < duration - tolerance)
                  throw Error('Playback did not cover the imported clip from start through recovery');
              }
              stop(null);
            } catch (error) { stop(String(error)); }
          };
          window.__DOREUMI_QA__.play(id);
        }, { id: action.id, duration: action.duration, rate: playbackRate });
        await page.waitForFunction(() => window.__DOREUMI_PLAYBACK_RUN__?.done, undefined,
          { timeout: Math.ceil((action.duration / playbackRate * 2 + 10) * 1000) });
        const run = await page.evaluate(() => window.__DOREUMI_PLAYBACK_RUN__);
        const captured = run.frames;
        assert(!run.error, `${action.id}/playback: ${run.error}`);
        assert(captured.length >= 2, `${action.id}/playback: insufficient rendered frames`);
        const files = [], states = [];
        for (const [index, { data, state, elapsed }] of captured.entries()) {
          assert(state.finite && !state.motionError, `${action.id}/playback/${index}: invalid rendered state`);
          assert(state.bounds.min[0] >= -1 && state.bounds.max[0] <= 1 && state.bounds.min[1] >= -1 && state.bounds.max[1] <= 1,
            `${action.id}/playback/${index}: clipped ${JSON.stringify(state.bounds)}`);
          const file = path.join(output, `playback-${action.id.replace(':', '-')}-${index}.png`);
          await sharp(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).flatten({ background: '#fbf8f1' }).png().toFile(file);
          files.push(file); states.push({ elapsed, ...state });
        }
        await sheet(files, `playback-${action.id.replace(':', '-')}.jpg`, 8);
        playbackSamples.push({ id: action.id, rate: playbackRate, basis: 'actual-rendered-frame-and-runtime-state', coverage: run.coverage, error: run.error, states, frames: files });
      }
    }
    completedActionIds.push(action.id);
    await checkpoint();
    console.log(`Visual samples: ${action.id}`);
    if (await stopRequested()) throw gracefulStop;
  }
  if (cameraInterruptions) {
    for (const action of checkedActions.filter(item => item.frame?.tracking)) {
      const track = action.frame.tracking, peak = track.centerY.indexOf(Math.max(...track.centerY));
      for (const to of ['Think', 'Dragged']) {
        await page.evaluate(([id, time]) => window.__DOREUMI_QA__.seek(id, time), [action.id, track.times[peak]]);
        await page.evaluate(to => {
          const started = performance.now(), frames = [];
          window.__DOREUMI_CAMERA_RUN__ = frames;
          window.__DOREUMI_CAMERA_CAPTURE__ = canvas => {
            if (frames.length >= 180) return;
            const state = window.__DOREUMI_QA__.inspect();
            // Read the just-rendered pixels without capture(), which would
            // render again with immediate framing and hide camera lag.
            frames.push({ elapsed: (performance.now() - started) / 1000, state, data: canvas.toDataURL('image/png') });
          };
          window.__DOREUMI_QA__.play(to);
        }, to);
        await page.waitForTimeout(800 / playbackRate);
        const captured = await page.evaluate(() => {
          window.__DOREUMI_CAMERA_CAPTURE__ = undefined;
          return window.__DOREUMI_CAMERA_RUN__;
        });
        assert(captured.length >= 6, `${action.id} -> ${to}: insufficient rendered transition frames`);
        const files = [], states = [];
        for (const [index, { data, state, elapsed }] of captured.entries()) {
          assert(state.finite && !state.motionError, `${action.id} -> ${to}/${index}: invalid rendered state`);
          assert(state.bounds.min[0] >= -1 && state.bounds.max[0] <= 1 && state.bounds.min[1] >= -1 && state.bounds.max[1] <= 1,
            `${action.id} -> ${to}/${index}: clipped ${JSON.stringify(state.bounds)}`);
          const file = path.join(output, `camera-${action.id.replace(':', '-')}-${to}-${index}.png`);
          await sharp(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).flatten({ background: '#fbf8f1' }).png().toFile(file);
          files.push(file); states.push({ elapsed, ...state });
        }
        await sheet(files, `camera-${action.id.replace(':', '-')}-${to}.jpg`, 9);
        transitions.push({ kind: 'tracked-camera-interruption', from: action.id, to, sourceTime: track.times[peak], states, frames: files });
        await checkpoint();
      }
    }
  }
  if (process.argv.includes('--motion-samples-only')) throw samplesComplete;
  await page.evaluate(() => window.__DOREUMI_QA__.angle(0));
  await page.evaluate(() => window.__DOREUMI_QA__.seek('Idle', 0));
  for (const expression of manifest.expressions) {
    await page.evaluate(id => window.__DOREUMI_QA__.expression(id), expression.id);
    const state = await inspect(); assert(state.expression === expression.id, `Expression failed: ${expression.id}`);
    expressions.push({ id: expression.id, file: await snapshot(`expression-${expression.id}`) });
  }
  await sheet(expressions.map(e => e.file), 'expressions-all.jpg', 6);
  await page.evaluate(() => window.__DOREUMI_QA__.expression('neutral'));
  for (const from of ['Sit', 'Lie', 'Code', 'Read']) {
    await page.evaluate(name => { window.__DOREUMI_QA__.seek(name, 0); window.__DOREUMI_QA__.play(name); }, from);
    await page.waitForFunction(() => window.__DOREUMI_QA__.inspect()?.phase === 'hold', undefined, { timeout: 60000, polling: 'raf' });
    const held = await inspect();
    assert(held.phase === 'hold' && held.time < .15, `${from}: missed hold-start regression window`);
    // Request at the start of the hold loop, where recovery used to be skipped.
    await page.evaluate(() => window.__DOREUMI_QA__.play('Run'));
    const start = await inspect(), frames = [], states = [];
    for (let index = 0; index < 9; index++) {
      if (index) await page.waitForTimeout(200 / playbackRate);
      states.push(await inspect());
      frames.push(await snapshot(`transition-${from}-Run-${index}`));
    }
    await sheet(frames, `transition-${from}-Run.jpg`, 9);
    const end = await inspect();
    assert(start.recovering && end.action === 'Run' && !end.recovering, `${from} -> Run recovery failed`);
    transitions.push({ from, held, start, end, states, frames });
  }
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(() => window.__DOREUMI_QA__.seek('Wave', 1.8));
    const state = await inspect();
    const geometry = await page.evaluate(() => {
      const selects = [...document.querySelectorAll('select')].map(e => { const r = e.getBoundingClientRect(); return { top: r.top, height: r.height, width: r.width }; });
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, selects };
    });
    assert(geometry.overflow <= 1, `${width}px horizontal overflow`);
    assert(Math.abs(geometry.selects[0].top - geometry.selects[1].top) <= 1 && Math.abs(geometry.selects[0].height - geometry.selects[1].height) <= 1 && Math.abs(geometry.selects[0].width - geometry.selects[1].width) <= 1, `${width}px selector alignment`);
    sizes.push({ width, state, geometry, file: await snapshot(`viewport-${width}`) });
  }
  await page.evaluate(() => { window.__DOREUMI_QA__.play('Idle'); window.__DOREUMI_QA__.active(false); });
  await page.waitForFunction(() => window.__DOREUMI_QA__.inspect()?.paused === true);
  const paused = await inspect(); await page.waitForTimeout(200); const pausedAfter = await inspect();
  assert(paused.renderedFrames === pausedAfter.renderedFrames && paused.time === pausedAfter.time, 'Inactive avatar kept animating');
  await page.evaluate(() => window.__DOREUMI_QA__.active(true));
  await page.waitForFunction(() => window.__DOREUMI_QA__.inspect()?.paused === false);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => window.__DOREUMI_QA__.inspect()?.paused === true); const reduced = await inspect(); await page.waitForTimeout(200); const reducedAfter = await inspect();
  assert(reduced.renderedFrames === reducedAfter.renderedFrames, 'Reduced-motion avatar kept animating');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const lost = await page.evaluate(() => { const canvas = document.querySelector('[data-doreumi-stage] canvas'); const gl = canvas?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) return false; ext.loseContext(); return true; });
  if (lost) { await page.waitForSelector('[data-doreumi-stage] [data-doreumi-avatar="fallback"]'); await page.screenshot({ path: path.join(output, 'webgl-fallback.png'), fullPage: false }); }
  assert(lost, 'Context-loss fallback could not be exercised');
  assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`);
  const report = { checkedAt: new Date().toISOString(), base, modelSha256, clipHashes, source: manifest.source, animationPlaybackRecorded: animate, playbackRate, expressionMode, angles, naturalnessReview: 'pending-human-visual-inspection', counts: { actions: checkedActions.length, samples: samples.length, expressions: expressions.length }, samples, expressions, transitions, sizes, playbackSamples, paused, pausedAfter, reduced, reducedAfter, errors, failures, pass: failures.length === 0 };
  Object.assign(report, { registrySha256, clipOverrideEvidence, runtimeBundleSha256, runtimeFrozen: runtimeBundleSha256 !== null, status: 'complete', complete: true, finalChecksCompleted: true, requestedActionIds: checkedActions.map(action => action.id), completedActionIds, fractions });
  await writeReport('report.json', report);
  await writeReport('checkpoint.json', report);
  console.log(JSON.stringify({ pass: report.pass, failures, output }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  if (error === samplesComplete) {
    const report = await checkpoint('motion-samples-complete');
    Object.assign(report, { scope: 'motion-samples-only', complete: true, pass: failures.length === 0 && errors.length === 0 });
    await writeReport('report.json', report); await writeReport('checkpoint.json', report);
    console.log(JSON.stringify({ scope: report.scope, pass: report.pass, failures, output }));
    if (!report.pass) process.exitCode = 1;
  } else {
  await checkpoint(error === gracefulStop ? 'stopped' : 'interrupted', error === gracefulStop ? undefined : error);
  if (error !== gracefulStop) throw error;
  console.log(JSON.stringify({ status: 'stopped', complete: false, pass: false, completedActionIds, output }, null, 2));
  process.exitCode = 2;
  }
} finally {
  try { await context.close(); }
  finally { if (!process.env.CDP_URL) await browser.close(); }
}
