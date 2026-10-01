import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { AnimationClip } from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { sourceTailSampleTime, sourceTailEvidence } from '../scripts/doreumi/meshy-source-tail.mjs';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode } from '../scripts/doreumi/meshy-retarget.mjs';
import { loadDoreumiAsset } from '../scripts/doreumi/rig-utils.mjs';

const metadata = { actionId: 463, sourceSha256: '4d4ada0b91b84eca55bcefd07e582555d0822e35cd7e13e432e47209d55eb018' }, duration = 2.3333332538604736;

test('tail repair preserves the earlier jump and original clock with a continuous stop', () => {
  const evidence = sourceTailEvidence(metadata, duration), [start, end] = evidence.timeWarpInterval;
  assert.equal(evidence.playbackSourceDuration, duration);
  assert.equal(evidence.removedSourceKeyTimes.length, 1);
  for (const time of [0, .5, 1, 1.5, 2, start]) assert.equal(sourceTailSampleTime(metadata, time, duration), time);
  let previous = start;
  for (let i = 0; i <= 240; i++) {
    const sample = sourceTailSampleTime(metadata, start + (end - start) * i / 240, duration);
    assert.ok(sample >= previous && sample <= evidence.retainedSourceDuration);
    previous = sample;
  }
  assert.equal(sourceTailSampleTime(metadata, end, duration), evidence.retainedSourceDuration);
  assert.equal(sourceTailSampleTime(metadata, end + 1, duration), evidence.retainedSourceDuration);
  const h = 1e-7, velocityAtStart = (sourceTailSampleTime(metadata, start + h, duration) - start) / h;
  const velocityAtEnd = (sourceTailSampleTime(metadata, end, duration) - sourceTailSampleTime(metadata, end - h, duration)) / h;
  assert.ok(Math.abs(velocityAtStart - 1) < 1e-5);
  assert.ok(Math.abs(velocityAtEnd) < 1e-5);
});

test('repair has exact action scope and refuses an unaudited replacement source', () => {
  for (const actionId of [462, 464, 451, 452, 601, 22, 23, 24]) {
    assert.equal(sourceTailSampleTime({ actionId }, 8.2, 10), 8.2);
    assert.equal(sourceTailEvidence({ actionId }, 10), undefined);
  }
  assert.throws(() => sourceTailSampleTime(metadata, 1, 5), /new source-key audit/);
  assert.throws(() => sourceTailSampleTime(metadata, Number.NaN, duration), /sample time/);
  assert.throws(() => sourceTailSampleTime({ actionId: 463 }, 1, duration), /checksum/);
  assert.throws(() => sourceTailSampleTime({ actionId: 463, sourceSha256: '0'.repeat(64) }, 1, duration), /checksum/);
});

test('actual acquired source loses its isolated final-key spike without changing preceding poses', async context => {
  const ledgerFile = '.artifacts/doreumi-meshy/ledger.json';
  if (!fs.existsSync(ledgerFile)) return context.skip('Offline donor acquisition cache is not present.');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile)), batch = ledger.batches.find(b => b.actionIds.includes(463) && b.file);
  assert.ok(batch, 'Action 463 is required in the local acquisition ledger.');
  const sourceFile = `.artifacts/doreumi-meshy/${batch.file}`;
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'), metadata.sourceSha256);
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(sourceFile);
  const graph = sourceGraph(document), animation = document.getRoot().listAnimations()[batch.actionIds.indexOf(463)];
  const channels = animation.listChannels().map(channel => samplerFor(channel, graph));
  const pose = time => {
    for (const channel of channels) channel.node[{ rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.path]].fromArray(sampleChannel(channel, time));
    graph.ordered.forEach(updateNode);
    return new Map(graph.ordered.map(node => [node.name, { rotation: node.worldQuaternion.clone(), position: node.worldPosition.clone() }]));
  };
  const evidence = sourceTailEvidence(metadata, duration), first = evidence.timeWarpInterval[0];
  for (const t of [0, .5, 1, 1.5, 2, first]) {
    const before = pose(t), after = pose(sourceTailSampleTime(metadata, t, duration));
    for (const [name, old] of before) { assert.deepEqual(after.get(name).rotation, old.rotation); assert.deepEqual(after.get(name).position, old.position); }
  }
  let previous, largestRaw = 0, largestRepaired = 0;
  for (let frame = 0; frame <= 8; frame++) {
    const t = first + (duration - first) * frame / 8, raw = pose(t), repaired = pose(sourceTailSampleTime(metadata, t, duration));
    if (previous) for (const name of ['RightUpLeg', 'RightLeg', 'RightFoot']) {
      largestRaw = Math.max(largestRaw, raw.get(name).rotation.angleTo(previous.raw.get(name).rotation));
      largestRepaired = Math.max(largestRepaired, repaired.get(name).rotation.angleTo(previous.repaired.get(name).rotation));
    }
    previous = { raw, repaired };
  }
  assert.ok(largestRaw > 40 * Math.PI / 180, 'The actual corrupt source tail was not reproduced.');
  assert.ok(largestRepaired < 7 * Math.PI / 180, 'The final valid pose still develops a large world-rotation step.');
  const repairedEnd = pose(sourceTailSampleTime(metadata, duration, duration)), validEnd = pose(evidence.retainedSourceDuration);
  for (const [name, valid] of validEnd) assert.ok(repairedEnd.get(name).rotation.angleTo(valid.rotation) < 1e-7);
  context.diagnostic(JSON.stringify({ largestRawDegrees120Hz: largestRaw * 180 / Math.PI, largestRepairedDegrees120Hz: largestRepaired * 180 / Math.PI }));
});

test('the shipping right-leg tail loses its spike and loads in the actual runtime', async context => {
  const manifest = JSON.parse(fs.readFileSync('public/doreumi/motions/meshy-source-manifest.json'));
  const entry = manifest.motions.find(item => item.actionId === 463), evidence = entry.retargetEvidence;
  assert.equal(evidence.sourceTailRepair.verifiedOriginalSourceSha256, entry.sourceSha256);
  assert.equal(evidence.sourceTailRepair.playbackSourceDuration, evidence.sourceDuration);
  const clip = AnimationClip.parse(JSON.parse(fs.readFileSync(`public${entry.url}`)));
  assert.deepEqual(clip.tracks.filter(track => !track.name.endsWith('.quaternion')).map(track => track.name), ['DoreumiRig.position']);
  const contract = JSON.parse(fs.readFileSync('public/doreumi/rig-contract.json')), graph = targetGraph(contract);
  const tracks = clip.tracks.map(track => ({ node: graph.byName.get(track.name.split('.')[0]), property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const start = evidence.entryDuration + evidence.sourceTailRepair.timeWarpInterval[0];
  let previous, largestWorld = 0, largestLocal = 0, largestRightLegWorld = 0;
  for (let frame = 0; frame <= Math.ceil((clip.duration - start) * 120); frame++) {
    const time = Math.min(clip.duration, start + frame / 120);
    for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(time));
    graph.ordered.forEach(updateNode);
    const pose = graph.ordered.map(node => ({ name: node.name, local: node.quaternion.clone().normalize(), world: node.worldQuaternion.clone().normalize() }));
    if (previous) for (let index = 0; index < pose.length; index++) {
      largestWorld = Math.max(largestWorld, pose[index].world.angleTo(previous[index].world));
      largestLocal = Math.max(largestLocal, pose[index].local.angleTo(previous[index].local));
      if (['thighR', 'kneeR', 'shinR', 'footR'].includes(pose[index].name)) {
        largestRightLegWorld = Math.max(largestRightLegWorld, pose[index].world.angleTo(previous[index].world));
      }
    }
    previous = pose;
  }
  // The original free-arm sweep is faster than four degrees per sample. Keep
  // its world maximum as evidence instead of suppressing that authored motion.
  // The isolated source corruption under repair is the right-leg chain.
  assert.ok(largestRightLegWorld < 4 * Math.PI / 180, 'The repaired right-leg world-rotation spike remains.');
  assert.ok(largestLocal < 4 * Math.PI / 180, 'A local rotation spike remains in the repaired tail/recovery.');
  const { register } = await import('node:module'); register('./alias-hooks.mjs', import.meta.url);
  const { DoreumiMotion } = await import('../src/lib/doreumi/motion.ts');
  const asset = await loadDoreumiAsset('public/doreumi/doreumi-master.glb'), motion = new DoreumiMotion(asset.scene, asset.clips);
  try { assert.doesNotThrow(() => motion.registerClip(clip)); assert.ok(motion.hasClip('meshy:463')); }
  finally { motion.dispose(); }
  context.diagnostic(JSON.stringify({ shippingLargestWorldDegrees120Hz: largestWorld * 180 / Math.PI, shippingLargestLocalDegrees120Hz: largestLocal * 180 / Math.PI,
    shippingRightLegWorldDegrees120Hz: largestRightLegWorld * 180 / Math.PI }));
});
