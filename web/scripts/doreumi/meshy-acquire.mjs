#!/usr/bin/env node
/** Resumable, budget-bounded acquisition of the user's 524 approved Meshy actions.
 * Credentials are loaded in memory. Raw receipts and signed URLs stay in ignored
 * .artifacts; public provenance never claims downloaded motion has been reviewed.
 *
 * node scripts/doreumi/meshy-acquire.mjs status
 * node scripts/doreumi/meshy-acquire.mjs run --phase=pilot --key-file=/private/.env.local
 * node scripts/doreumi/meshy-acquire.mjs accept-pilot --evidence=/local/report.json
 * node scripts/doreumi/meshy-acquire.mjs run --phase=all --key-file=/private/.env.local
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.meshy.ai/openapi/v1';
const CACHE = path.join(ROOT, '.artifacts/doreumi-meshy');
const LEDGER = path.join(CACHE, 'ledger.json');
const PUBLIC_MANIFEST = path.join(ROOT, 'public/doreumi/motions/meshy-source-manifest.json');
const APPROVED_MAX = 1577;
const RESERVE = 180;
export const PILOT_IDS = [0, 22, 25, 28, 30, 36, 62, 74, 268, 318];
const now = () => new Date().toISOString();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function makeBatches(motions) {
  const approved = new Set(motions.map(item => item.actionId));
  if (approved.size !== 524 || motions.some(item => item.sourceCategory === 'Fighting')) {
    throw new Error('Approved catalog must contain exactly 524 unique non-Fighting actions.');
  }
  if (PILOT_IDS.some(id => !approved.has(id))) throw new Error('Pilot does not match the approved catalog.');
  const remaining = [...approved].filter(id => !PILOT_IDS.includes(id)).sort((a, b) => a - b);
  const groups = [PILOT_IDS];
  for (let index = 0; index < remaining.length; index += 10) groups.push(remaining.slice(index, index + 10));
  return groups.map((actionIds, index) => ({ id: `batch-${String(index).padStart(3, '0')}`,
    actionIds, expectedCredits: actionIds.length * 3, status: 'not_submitted' }));
}

export function assertBudget(ledger, transaction, balance) {
  if (!Number.isFinite(balance) || balance < 0) throw new Error('Invalid balance response.');
  const extra = ledger.budget?.recoveryRigCredits ?? 0;
  if (![0, 5].includes(extra)) throw new Error('Unexpected recovery credit authorization.');
  const committed = [ledger.rig, ...(ledger.recoveryRig ? [ledger.recoveryRig] : []), ...ledger.batches].filter(item => item !== transaction &&
    !['not_submitted', 'rejected', 'FAILED', 'CANCELED'].includes(item.status))
    .reduce((sum, item) => sum + (item.consumedCredits ?? item.expectedCredits), 0);
  if (committed + transaction.expectedCredits > APPROVED_MAX + extra) throw new Error('Approved credit budget would be exceeded.');
  if (balance - transaction.expectedCredits < RESERVE - extra) throw new Error(`Reserved ${RESERVE - extra} account credits would be spent.`);
  if (transaction.status !== 'not_submitted') throw new Error('Transaction is already submitted or uncertain; refusing a duplicate POST.');
}

export function inspectGlb(bytes, expectedClips) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error('Downloaded file is not a complete GLB 2.0.');
  }
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryStart = 20 + jsonLength + 8;
  const duration = sampler => {
    const accessor = doc.accessors?.[sampler.input];
    if (!accessor || accessor.componentType !== 5126 || accessor.type !== 'SCALAR') throw new Error('Invalid animation time accessor.');
    if (Number.isFinite(accessor.max?.[0])) return accessor.max[0];
    const view = doc.bufferViews?.[accessor.bufferView];
    if (!view || !accessor.count) throw new Error('Missing animation time buffer.');
    const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + (accessor.count - 1) * (view.byteStride ?? 4);
    if (offset + 4 > bytes.length) throw new Error('Animation time buffer exceeds the GLB.');
    return bytes.readFloatLE(offset);
  };
  const clips = doc.animations ?? [];
  if (expectedClips !== undefined && clips.length !== expectedClips) {
    throw new Error(`Expected ${expectedClips} independent clips; received ${clips.length}.`);
  }
  if (!doc.skins?.length || !doc.nodes?.length) throw new Error('Source GLB contains no skin or skeleton.');
  const skeleton = doc.skins.flatMap(skin => skin.joints.map(index => doc.nodes[index]?.name ?? `node_${index}`));
  for (const clip of clips) {
    if (!clip.channels?.length || !clip.samplers?.length) throw new Error('Source clip contains no animation.');
    let longest = 0;
    for (const sampler of clip.samplers) {
      const accessor = doc.accessors?.[sampler.input];
      const last = duration(sampler);
      if (!accessor?.count || !Number.isFinite(last) || last < 0) throw new Error('Source clip has invalid key times.');
      longest = Math.max(longest, last);
    }
    if (expectedClips !== undefined && !(longest > 0)) throw new Error('Source clip has no positive duration.');
  }
  return { bytes: bytes.length, sha256: digest(bytes), joints: [...new Set(skeleton)],
    clips: clips.map((clip, index) => ({ index, name: clip.name ?? `clip_${index}`,
      duration: Math.max(...clip.samplers.map(duration)) })) };
}

function atomicJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}`;
  const handle = fs.openSync(temp, 'w', mode);
  try { fs.writeFileSync(handle, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(handle); }
  finally { fs.closeSync(handle); }
  fs.renameSync(temp, file);
  fs.chmodSync(file, mode);
}

function loadKey(file) {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY.trim();
  if (!file) throw new Error('Set MESHY_API_KEY or provide --key-file; credentials are never logged.');
  const line = fs.readFileSync(path.resolve(file), 'utf8').split(/\r?\n/)
    .find(value => /^\s*(?:export\s+)?MESHY_API_KEY\s*=/.test(value));
  if (!line) throw new Error('The supplied key file has no MESHY_API_KEY.');
  const key = line.replace(/^\s*(?:export\s+)?MESHY_API_KEY\s*=\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!key || /\s/.test(key)) throw new Error('Invalid API key format.');
  return key;
}

function lock() {
  fs.mkdirSync(CACHE, { recursive: true, mode: 0o700 });
  const file = path.join(CACHE, 'runner.lock');
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now() }), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = readJson(file);
    try { process.kill(previous.pid, 0); throw new Error(`Acquisition runner ${previous.pid} is still active.`); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    fs.unlinkSync(file);
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: now() }), { flag: 'wx', mode: 0o600 });
  }
  return () => { if (fs.existsSync(file) && readJson(file).pid === process.pid) fs.unlinkSync(file); };
}

function report(ledger, catalog) {
  const batches = new Map(ledger.batches.flatMap(batch => batch.actionIds.map(id => [id, batch])));
  const derivations = new Map((ledger.derivations ?? []).map(item => [item.actionId, item]));
  const motions = catalog.motions.map(item => {
    const batch = batches.get(item.actionId);
    const derivation = derivations.get(item.actionId), sourceBatch = derivation ? batches.get(derivation.baseSourceActionId) : batch;
    const sourceActionId = derivation?.baseSourceActionId ?? item.actionId;
    const clip = sourceBatch.structure?.clips?.[sourceBatch.actionIds.indexOf(sourceActionId)];
    return { ...item, acquisition: batch.status === 'downloaded' ? 'downloaded' : batch.status,
      batchId: batch.id, sourceRigId: sourceBatch.rigId ?? 'donor-rig', ...(derivation ? { derivation: {
        type: 'local_inplace', requestedActionId: item.actionId, baseSourceActionId: sourceActionId,
        sourceBatchId: sourceBatch.id, failedBatchId: batch.id, reason: derivation.reason } } : {}),
      ...(clip ? { sourceClipName: clip.name, sourceDuration: clip.duration, duration: clip.duration,
        sourceSha256: sourceBatch.structure.sha256 } : {}), retarget: 'pending', visualReview: 'pending' };
  });
  const counts = { approved: motions.length, submitted: motions.filter(item => item.acquisition !== 'not_submitted').length,
    downloaded: motions.filter(item => item.acquisition === 'downloaded').length,
    locallyDerived: derivations.size, retargeted: 0, visuallyPassed: 0, connected: 0 };
  // Retarget owns its own per-ID evidence; an acquisition refresh must not erase it.
  if (fs.existsSync(PUBLIC_MANIFEST)) {
    const old = new Map((readJson(PUBLIC_MANIFEST).motions ?? []).map(item => [item.actionId, item]));
    for (const item of motions) {
      const previous = old.get(item.actionId);
      if (previous?.retarget === 'converted' && previous.sourceSha256 === item.sourceSha256) {
        for (const key of ['retarget', 'url', 'duration', 'targetRigSignature', 'convertedSha256', 'retargetEvidence']) {
          if (previous[key] !== undefined) item[key] = previous[key];
        }
      }
    }
    counts.retargeted = motions.filter(item => item.retarget === 'converted').length;
  }
  atomicJson(PUBLIC_MANIFEST, { version: 1, updatedAt: now(), source: catalog.source,
    scope: 'All 524 user-approved non-Fighting source actions', counts, motions }, 0o644);
  return counts;
}

async function main() {
  const command = process.argv[2] ?? 'status';
  const options = Object.fromEntries(process.argv.slice(3).filter(arg => arg.startsWith('--')).map(arg => {
    const index = arg.indexOf('='); return index < 0 ? [arg.slice(2), true] : [arg.slice(2, index), arg.slice(index + 1)];
  }));
  const catalogPath = path.join(ROOT, 'scripts/doreumi/meshy-library.json');
  const catalog = readJson(catalogPath);
  const catalogSha256 = digest(fs.readFileSync(catalogPath));
  if (command === 'status') {
    if (!fs.existsSync(LEDGER)) return console.log(JSON.stringify({ approved: catalog.approvedCount, downloaded: 0, ledger: 'not_initialized' }));
    const ledger = readJson(LEDGER);
    const counts = Object.fromEntries(['not_submitted', 'submitting', 'submission_unknown', 'PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'downloaded', 'FAILED', 'CANCELED']
      .map(status => [status, ledger.batches.filter(batch => batch.status === status).reduce((sum, batch) => sum + batch.actionIds.length, 0)]));
    return console.log(JSON.stringify({ rig: ledger.rig.status, pilotAccepted: ledger.pilotAccepted ?? false,
      balance: ledger.latestBalance, balanceCheckedAt: ledger.balanceCheckedAt, counts,
      locallyDerived: ledger.derivations?.length ?? 0, apiAcquisitionClosedAt: ledger.apiAcquisitionClosedAt,
      targetCounts: fs.existsSync(PUBLIC_MANIFEST) ? readJson(PUBLIC_MANIFEST).counts : undefined, updatedAt: ledger.updatedAt }, null, 2));
  }
  const release = lock();
  let ledger;
  let heartbeat;
  try {
    ledger = fs.existsSync(LEDGER) ? readJson(LEDGER) : { version: 1, createdAt: now(), catalogSha256,
      budget: { approvedMax: APPROVED_MAX, reserve: RESERVE }, rig: { id: 'donor-rig', expectedCredits: 5, status: 'not_submitted' },
      batches: makeBatches(catalog.motions) };
    if (ledger.catalogSha256 !== catalogSha256) throw new Error('Approved catalog changed since the ledger was initialized.');
    const save = () => { ledger.updatedAt = now(); atomicJson(LEDGER, ledger); report(ledger, catalog); };
    save();
    if (command === 'accept-pilot') {
      if (ledger.batches[0].status !== 'downloaded' || !options.evidence) throw new Error('Downloaded pilot and --evidence report are required.');
      const evidence = readJson(path.resolve(options.evidence));
      if (evidence.pass !== true || !PILOT_IDS.every(id => evidence.actionIds?.includes(id))) throw new Error('Pilot evidence must pass and cover every pilot action.');
      ledger.pilotAccepted = { at: now(), evidenceSha256: digest(fs.readFileSync(path.resolve(options.evidence))) };
      save(); return console.log('Pilot evidence accepted. Acquisition may resume.');
    }
    if (command === 'derive-inplace') {
      const normalize = name => name.toLowerCase().replace(/_?in_?place$/, '').replace(/[^a-z0-9]/g, '');
      const downloaded = new Set(ledger.batches.filter(batch => batch.status === 'downloaded').flatMap(batch => batch.actionIds));
      const derivations = [];
      for (const batch of ledger.batches.filter(batch => batch.status === 'FAILED')) {
        if (batch.consumedCredits !== 0 || batch.actionIds.length !== 1) throw new Error('Derivation requires an isolated confirmed zero-cost failed action.');
        const actionId = batch.actionIds[0], item = catalog.motions.find(item => item.actionId === actionId);
        if (!/_?in_?place$/i.test(item.sourceName)) throw new Error('Only exact-name in-place variants may use this recovery.');
        const matches = catalog.motions.filter(candidate => downloaded.has(candidate.actionId) && normalize(candidate.sourceName) === normalize(item.sourceName));
        if (matches.length !== 1) throw new Error(`No unique downloaded base source for ${actionId}.`);
        derivations.push({ actionId, baseSourceActionId: matches[0].actionId, operation: 'remove_horizontal_root_motion',
          failedBatchId: batch.id, createdAt: now(), reason: 'Exact-name Meshy in-place variant failed on two donor rigs; derive from the acquired original action without horizontal root travel.' });
      }
      ledger.derivations = derivations;
      ledger.apiAcquisitionClosedAt = now();
      ledger.apiAcquisitionClosureReason = 'All requested behaviors have direct sources or exact-name local derivations; further paid retries are not authorized.';
      save();
      return console.log(JSON.stringify({ event: 'offline_inplace_recovery_registered', directlyDownloaded: downloaded.size, locallyDerived: derivations.length, paidRequests: 0 }));
    }
    if (!['run', 'balance', 'retry-failed', 'split-failed', 'prepare-recovery-rig', 'reassign-recovery'].includes(command)) throw new Error('Unknown acquisition command.');
    if (ledger.apiAcquisitionClosedAt && command !== 'balance') throw new Error('Paid acquisition is closed. Use status or offline retargeting; no further request was sent.');
    const key = loadKey(options['key-file']);
    async function api(method, endpoint, body) {
      const tries = method === 'GET' ? 3 : 1;
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          const response = await fetch(API + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}) });
          if (!response.ok) {
            const error = new Error(`${method} ${endpoint.split('?')[0]} returned HTTP ${response.status}.`);
            error.httpStatus = response.status;
            if (method === 'GET' && [429, 500, 502, 503, 504].includes(response.status) && attempt + 1 < tries) { await sleep(2000 * (attempt + 1)); continue; }
            throw error;
          }
          return await response.json();
        } catch (error) {
          if (method !== 'GET' || error.httpStatus || attempt + 1 >= tries) {
            if (error.httpStatus) throw error;
            throw new Error(`${method} ${endpoint.split('?')[0]} network/response failure; no paid request was retried.`);
          }
          await sleep(2000 * (attempt + 1));
        }
      }
    }
    async function balance() {
      const response = await api('GET', '/balance');
      const value = response.balance ?? response.result?.balance;
      if (!Number.isFinite(value)) throw new Error('Balance endpoint did not return a number.');
      ledger.latestBalance = value; ledger.balanceCheckedAt = now(); save(); return value;
    }
    const initialBalance = await balance();
    if (command === 'balance') return console.log(JSON.stringify({ balance: initialBalance, reserve: RESERVE }));
    if (['retry-failed', 'split-failed', 'reassign-recovery'].includes(command)) {
      const batch = ledger.batches.find(item => item.id === options.batch);
      if (!batch || batch.status !== 'FAILED' || !options.reason || !batch.taskId) throw new Error('A terminal failed batch and explicit reconciliation reason are required.');
      if (command === 'retry-failed' && (batch.attemptHistory?.length ?? 0) >= 1) throw new Error('This batch has already had its one bounded retry. Inspect the specific actions before another recovery strategy.');
      const task = await api('GET', `/animations/${batch.taskId}`);
      if (task.status !== 'FAILED' || task.consumed_credits !== 0) throw new Error('Retry requires a confirmed terminal failure with zero consumed credits.');
      const extra = ledger.budget?.recoveryRigCredits ?? 0;
      const spent = [ledger.rig, ...(ledger.recoveryRig ? [ledger.recoveryRig] : []), ...ledger.batches].reduce((sum, item) => sum + (item.consumedCredits ?? 0), 0);
      const pendingCredits = ledger.batches.filter(item => item.status !== 'downloaded').reduce((sum, item) => sum + item.expectedCredits, 0);
      if (spent + pendingCredits > APPROVED_MAX + extra || initialBalance - pendingCredits < RESERVE - extra) throw new Error('Reconciled balance cannot fund the complete remaining approved scope.');
      const receipt = `receipts/${batch.id}-attempt-${(batch.attemptHistory?.length ?? 0) + 1}.json`; atomicJson(path.join(CACHE, receipt), task);
      const history = { ...batch, receipt, reconciledAt: now(), reason: String(options.reason), balanceAfterRefund: initialBalance };
      if (command === 'reassign-recovery') {
        if (ledger.recoveryRig?.status !== 'downloaded' || batch.rigId === ledger.recoveryRig.id) throw new Error('One attempt on a prepared different recovery rig is required.');
        const fresh = { id: batch.id, actionIds: batch.actionIds, expectedCredits: batch.expectedCredits, status: 'not_submitted',
          requestMode: 'action_id', rigId: ledger.recoveryRig.id, attemptHistory: [...(batch.attemptHistory ?? []), history] };
        ledger.batches[ledger.batches.indexOf(batch)] = fresh; save();
        return console.log(JSON.stringify({ event: 'recovery_rig_assigned', batch: batch.id, rig: fresh.rigId, balance: initialBalance }));
      }
      if (command === 'split-failed') {
        if (batch.actionIds.length < 2) throw new Error('Cannot split a single-action task.');
        const children = batch.actionIds.map(actionId => ({ id: `${batch.id}-a${actionId}`, actionIds: [actionId], expectedCredits: 3, status: 'not_submitted', splitFrom: batch.id }));
        (ledger.retiredBatches ??= []).push({ ...history, resolution: 'split_to_isolate_source_action_failures', children: children.map(item => item.id) });
        ledger.batches.splice(ledger.batches.indexOf(batch), 1, ...children); save();
        return console.log(JSON.stringify({ event: 'terminal_failure_split', batch: batch.id, uniqueActions: children.length, previousConsumedCredits: 0, balance: initialBalance }));
      }
      if (options['request-mode'] && (options['request-mode'] !== 'single' || batch.actionIds.length !== 1)) throw new Error('Scalar request mode requires one action.');
      const fresh = { id: batch.id, actionIds: batch.actionIds, expectedCredits: batch.expectedCredits, status: 'not_submitted', attemptHistory: [history],
        ...(options['request-mode'] === 'single' ? { requestMode: 'action_id' } : {}) };
      ledger.batches[ledger.batches.indexOf(batch)] = fresh; save();
      return console.log(JSON.stringify({ event: 'terminal_failure_reconciled', batch: fresh.id, previousConsumedCredits: 0, attemptsAllowed: 1, balance: initialBalance }));
    }
    const phase = options.phase ?? 'pilot';
    if (!['pilot', 'all'].includes(phase)) throw new Error('--phase must be pilot or all.');
    if (phase === 'all' && !ledger.pilotAccepted) throw new Error('Pilot must pass before bulk acquisition.');
    if (!ledger.liveCatalogCheckedAt) {
      const live = await api('GET', '/animations/library');
      const list = Array.isArray(live) ? live : live.result ?? live.data;
      if (!Array.isArray(list)) throw new Error('Unexpected library response.');
      const byId = new Map(list.map(item => [item.action_id, item]));
      for (const item of catalog.motions) {
        const remote = byId.get(item.actionId);
        if (!remote || remote.category !== item.sourceCategory || remote.sub_category !== item.sourceSubCategory) {
          throw new Error(`Catalog action ${item.actionId} was retired or reclassified; review scope before spending.`);
        }
      }
      atomicJson(path.join(CACHE, 'live-catalog.json'), list);
      ledger.liveCatalogCheckedAt = now(); ledger.liveCatalogCount = list.length; save();
    }
    heartbeat = setInterval(() => {
      const downloaded = ledger.batches.filter(batch => batch.status === 'downloaded').reduce((sum, batch) => sum + batch.actionIds.length, 0);
      console.log(JSON.stringify({ event: 'heartbeat', downloaded, approved: 524,
        active: [ledger.rig, ...(ledger.recoveryRig ? [ledger.recoveryRig] : []), ...ledger.batches].filter(item => ['PENDING', 'IN_PROGRESS', 'submitting'].includes(item.status)).map(item => ({ id: item.id, status: item.status, progress: item.progress })), at: now() }));
    }, 30000);
    // Serialize balance -> intent -> POST receipts even while task polling runs in parallel.
    // A rejected/uncertain request closes the queue until an operator inspects it.
    let submissionQueue = Promise.resolve(), submissionsBlocked = false;
    async function submitOnce(transaction, endpoint, body) {
      if (submissionsBlocked) throw new Error('A previous submission failed; no further paid requests were sent.');
      const available = await balance();
      assertBudget(ledger, transaction, available);
      transaction.status = 'submitting'; transaction.submittedAt = now();
      transaction.requestSha256 = digest(JSON.stringify(body)); save();
      try {
        const response = await api('POST', endpoint, body);
        if (typeof response.result !== 'string' || !response.result) throw new Error('Missing task receipt.');
        transaction.taskId = response.result; transaction.status = 'PENDING'; save();
        console.log(JSON.stringify({ event: 'submitted', id: transaction.id, actions: transaction.actionIds?.length ?? 0, reservedCredits: transaction.expectedCredits }));
      } catch (error) {
        submissionsBlocked = true;
        transaction.status = error.httpStatus && error.httpStatus < 500 ? 'rejected' : 'submission_unknown';
        transaction.failure = error.message; save(); throw error;
      }
    }
    function submit(transaction, endpoint, body) {
      const pending = submissionQueue.then(() => submitOnce(transaction, endpoint, body));
      submissionQueue = pending.catch(() => {});
      return pending;
    }
    async function poll(transaction, endpoint) {
      const started = Date.now();
      let lastChange = Date.now(), signature = '';
      for (;;) {
        const task = await api('GET', `${endpoint}/${transaction.taskId}`);
        const next = `${task.status}:${task.progress}`;
        if (next !== signature) { signature = next; lastChange = Date.now(); }
        transaction.status = task.status; transaction.progress = task.progress;
        if (Number.isFinite(task.consumed_credits)) transaction.consumedCredits = task.consumed_credits;
        transaction.lastPolledAt = now();
        atomicJson(path.join(CACHE, 'receipts', `${transaction.id}.json`), task); save();
        if (task.status === 'SUCCEEDED') return task;
        if (['FAILED', 'CANCELED'].includes(task.status)) throw new Error(`${transaction.id} ended ${task.status}; inspect receipt before any new paid request.`);
        if (Date.now() - lastChange > 10 * 60000 || Date.now() - started > 25 * 60000) {
          throw new Error(`${transaction.id} STALLED; task id retained. Resume polls the same task without another POST.`);
        }
        await sleep(7000);
      }
    }
    async function download(url, file) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'meshy.ai' || parsed.hostname.endsWith('.meshy.ai'))) {
        throw new Error('Refusing an unexpected asset download host.');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(120000) });
          if (!response.ok) throw new Error(`Asset download HTTP ${response.status}.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          const structure = inspectGlb(bytes);
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          const temp = `${file}.part`; fs.writeFileSync(temp, bytes, { mode: 0o600 }); fs.renameSync(temp, file);
          return structure;
        } catch (error) { if (attempt === 2) throw new Error(`Asset download failed: ${error.message.replace(/https?:\S+/g, '[redacted URL]')}`); await sleep(2000 * (attempt + 1)); }
      }
    }
    const donorPath = path.join(CACHE, 'donor/donor.glb');
    const donor = fs.readFileSync(donorPath), donorSha256 = digest(donor);
    if (ledger.donorSha256 && ledger.donorSha256 !== donorSha256) throw new Error('Fixed donor changed; cannot mix source skeletons.');
    ledger.donorSha256 = donorSha256; save();
    if (ledger.rig.status === 'not_submitted') await submit(ledger.rig, '/rigging', {
      model_url: `data:model/gltf-binary;base64,${donor.toString('base64')}`, height_meters: 1.82,
    });
    if (['submitting', 'submission_unknown', 'rejected', 'FAILED', 'CANCELED'].includes(ledger.rig.status)) {
      throw new Error(`Donor rig is ${ledger.rig.status}; not submitting a replacement automatically.`);
    }
    if (ledger.rig.status !== 'downloaded') {
      const task = await poll(ledger.rig, '/rigging');
      const file = path.join(CACHE, 'donor/rigged.glb');
      ledger.rig.structure = await download(task.result.rigged_character_glb_url, file);
      ledger.rig.status = 'downloaded'; ledger.rig.file = path.relative(CACHE, file); save();
      console.log(JSON.stringify({ event: 'donor_ready', joints: ledger.rig.structure.joints.length, bytes: ledger.rig.structure.bytes }));
    }
    if (command === 'prepare-recovery-rig') {
      if (options['approved-extra-credits'] !== '5') throw new Error('Recovery requires explicit authorization for five extra rig credits.');
      const recoveryPath = path.join(CACHE, 'recovery-donor/donor.glb'), recoveryDonor = fs.readFileSync(recoveryPath), recoverySha = digest(recoveryDonor);
      if (ledger.recoveryRig && ledger.recoveryRig.donorSha256 !== recoverySha) throw new Error('Recovery donor is fixed once prepared.');
      ledger.budget.recoveryRigCredits = 5;
      ledger.budget.recoveryAuthorization = { at: now(), reason: 'Parent approved one alternate standard T-pose donor within existing 1757-credit balance; no purchase', finalReserve: 175 };
      ledger.recoveryRig ??= { id: 'recovery-rig', donorSha256: recoverySha, expectedCredits: 5, status: 'not_submitted' }; save();
      const recovery = ledger.recoveryRig;
      if (recovery.status === 'not_submitted') await submit(recovery, '/rigging', { model_url: `data:model/gltf-binary;base64,${recoveryDonor.toString('base64')}`, height_meters: 1.82 });
      if (['submitting', 'submission_unknown', 'rejected', 'FAILED', 'CANCELED'].includes(recovery.status)) throw new Error('Recovery rig did not complete; no automatic paid retry.');
      if (recovery.status !== 'downloaded') {
        const task = await poll(recovery, '/rigging'), file = path.join(CACHE, 'recovery-donor/rigged.glb');
        recovery.structure = await download(task.result.rigged_character_glb_url, file); recovery.file = path.relative(CACHE, file); recovery.status = 'downloaded'; save();
      }
      await balance(); return console.log(JSON.stringify({ event: 'recovery_rig_ready', joints: recovery.structure.joints.length, balance: ledger.latestBalance }));
    }
    const wanted = phase === 'pilot' ? ledger.batches.slice(0, 1) : ledger.batches;
    const workers = Math.min(4, Math.max(1, Number(options.workers ?? 3)));
    let index = 0, stopped = false;
    const terminalFailures = [];
    async function worker() {
      while (!stopped && index < wanted.length) {
        const batch = wanted[index++];
        try {
          const file = path.join(CACHE, 'raw', `${batch.id}.glb`);
          if (batch.status === 'downloaded') {
            const structure = inspectGlb(fs.readFileSync(file), batch.actionIds.length);
            if (structure.sha256 !== batch.structure.sha256) throw new Error(`${batch.id} cache checksum mismatch.`);
            continue;
          }
          const sourceRig = batch.rigId && batch.rigId === ledger.recoveryRig?.id ? ledger.recoveryRig : ledger.rig;
          if (batch.status === 'not_submitted') await submit(batch, '/animations', { rig_task_id: sourceRig.taskId,
            ...(batch.requestMode === 'action_id' ? { action_id: batch.actionIds[0] } : { action_ids: batch.actionIds }) });
          if (!batch.taskId || ['submitting', 'submission_unknown', 'rejected', 'FAILED', 'CANCELED'].includes(batch.status)) {
            throw new Error(`${batch.id} is ${batch.status}; no automatic POST retry.`);
          }
          const task = await poll(batch, '/animations');
          await download(task.result.animation_glb_url, file);
          batch.structure = inspectGlb(fs.readFileSync(file), batch.actionIds.length);
          batch.file = path.relative(CACHE, file); batch.status = 'downloaded'; batch.downloadedAt = now(); save();
          console.log(JSON.stringify({ event: 'downloaded', id: batch.id, actions: batch.actionIds.length,
            downloaded: ledger.batches.filter(item => item.status === 'downloaded').reduce((sum, item) => sum + item.actionIds.length, 0), bytes: batch.structure.bytes }));
        } catch (error) {
          // A known, refunded terminal task does not invalidate independent approved actions.
          if (batch.status === 'FAILED' && batch.consumedCredits === 0) {
            terminalFailures.push(batch.id); console.log(JSON.stringify({ event: 'terminal_failure', id: batch.id, consumedCredits: 0 })); continue;
          }
          stopped = true; throw error;
        }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: workers }, worker));
    const failed = results.find(result => result.status === 'rejected');
    await balance();
    if (failed) throw failed.reason;
    if (terminalFailures.length) throw new Error(`${terminalFailures.length} terminal zero-cost tasks require action-specific reconciliation; all other scheduled batches were processed.`);
    console.log(JSON.stringify({ event: 'phase_complete', phase, counts: report(ledger, catalog), balance: ledger.latestBalance }));
  } finally { clearInterval(heartbeat); release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: 'stopped', reason: error.message })); process.exitCode = 1; });
}
