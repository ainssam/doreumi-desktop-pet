#!/usr/bin/env node
/** Offline validation of paid raw motion. Passing is not a visual QA approval. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.artifacts/doreumi-meshy');
export const SOURCE_MAP = Object.freeze({
  body: 'Hips', torso: 'Spine', head: 'Head',
  shoulderL: 'LeftShoulder', shoulderR: 'RightShoulder',
  armL: 'LeftArm', armR: 'RightArm', elbowL: 'LeftForeArm', elbowR: 'RightForeArm',
  wristL: 'LeftHand', wristR: 'RightHand', thighL: 'LeftUpLeg', thighR: 'RightUpLeg',
  kneeL: 'LeftLeg', kneeR: 'RightLeg', footL: 'LeftFoot', footR: 'RightFoot',
});

export function validateSource(document, reference, actionIds) {
  const animations = document.getRoot().listAnimations();
  const joints = document.getRoot().listSkins()[0]?.listJoints() ?? [];
  const referenceNodes = new Map(reference.getRoot().listNodes().map(node => [node.getName(), node]));
  const sourceNodes = new Map(joints.map(node => [node.getName(), node]));
  if (animations.length !== actionIds.length) throw new Error('Action count does not match animation count.');
  if (joints.length !== reference.getRoot().listSkins()[0]?.listJoints().length) throw new Error('Source joint count changed.');
  for (const name of Object.values(SOURCE_MAP)) if (!sourceNodes.has(name)) throw new Error(`Missing semantic source joint ${name}.`);
  let maxRestDifference = 0;
  for (const node of joints) {
    const rest = referenceNodes.get(node.getName());
    if (!rest || node.getParentNode()?.getName() !== rest.getParentNode()?.getName()) throw new Error('Source skeleton hierarchy changed.');
    const delta = Math.max(...node.getWorldMatrix().map((value, index) => Math.abs(value - rest.getWorldMatrix()[index])));
    if (!Number.isFinite(delta) || delta > 1e-4) throw new Error(`Rest pose changed for ${node.getName()}.`);
    maxRestDifference = Math.max(maxRestDifference, delta);
  }
  const clips = animations.map((animation, index) => {
    let duration = 0, keyCount = 0, maxQuaternionError = 0;
    if (!animation.listChannels().length) throw new Error('Empty animation.');
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler();
      const input = sampler.getInput(), output = sampler.getOutput();
      const times = input.getArray(), values = output.getArray();
      if (!times?.length || !values?.length || !Array.from(times).every(Number.isFinite) || !Array.from(values).every(Number.isFinite)) {
        throw new Error(`Non-finite or empty key data in ${animation.getName()}.`);
      }
      if (times[0] < 0 || Array.from(times).some((time, i) => i > 0 && time <= times[i - 1])) throw new Error('Key times must increase.');
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.getInterpolation())) throw new Error('Unknown interpolation.');
      const size = output.getElementSize(), cubic = sampler.getInterpolation() === 'CUBICSPLINE';
      if (values.length !== times.length * size * (cubic ? 3 : 1)) throw new Error('Sampler input/output length mismatch.');
      if (!sourceNodes.has(channel.getTargetNode()?.getName()) || !['translation', 'rotation', 'scale'].includes(channel.getTargetPath())) {
        throw new Error('Unexpected source animation target.');
      }
      if (channel.getTargetPath() === 'rotation') {
        for (let i = 0; i < times.length; i++) {
          const offset = (i * (cubic ? 3 : 1) + (cubic ? 1 : 0)) * 4;
          const error = Math.abs(Math.hypot(...values.slice(offset, offset + 4)) - 1);
          if (error > 0.002) throw new Error('Invalid rotation quaternion.');
          maxQuaternionError = Math.max(maxQuaternionError, error);
        }
      }
      duration = Math.max(duration, times.at(-1)); keyCount += times.length;
    }
    if (!(duration > 0 && duration <= 300)) throw new Error('Unsupported clip duration.');
    return { actionId: actionIds[index], name: animation.getName(), duration, channels: animation.listChannels().length, keyCount, maxQuaternionError };
  });
  return { pass: true, kind: 'source_structure_only', actionIds, jointCount: joints.length, maxRestDifference, clips };
}

async function main() {
  const ledger = JSON.parse(fs.readFileSync(path.join(CACHE, 'ledger.json'), 'utf8'));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const reference = await io.read(path.join(CACHE, ledger.rig.file));
  const selected = process.argv[2] ?? 'all';
  const batches = ledger.batches.filter(batch => batch.status === 'downloaded' && (selected === 'all' || batch.id === selected));
  if (!batches.length) throw new Error('No downloaded batch matches the request.');
  for (const batch of batches) {
    const file = path.join(CACHE, batch.file);
    const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sourceSha256 !== batch.structure.sha256) throw new Error('Raw asset checksum changed.');
    const evidence = { ...validateSource(await io.read(file), reference, batch.actionIds), batchId: batch.id, sourceSha256, checkedAt: new Date().toISOString() };
    const output = path.join(CACHE, 'evidence', `${batch.id}-structure.json`);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ batch: batch.id, pass: evidence.pass, clips: evidence.clips.length, maxRestDifference: evidence.maxRestDifference }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
