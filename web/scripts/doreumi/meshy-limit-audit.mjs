#!/usr/bin/env node
/** Raw-source sweep for discontinuities introduced specifically by rest limits.
 * This recreates the original independent shortest-slerp limiter, even when a
 * shipping clip has already been corrected. It never changes public assets.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Quaternion, Vector3 } from 'three';
import { DOREUMI_JOINT_LIMITS, sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode, restDeltaQuaternion, localFromWorld } from './meshy-retarget.mjs';
import { SOURCE_MAP } from './meshy-validate-source.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read('public/doreumi/motions/meshy-source-manifest.json'), ledger = read('.artifacts/doreumi-meshy/ledger.json'), contract = read('public/doreumi/rig-contract.json');
const ids = process.argv.find(arg => arg.startsWith('--actions='))?.slice(10).split(',').map(Number);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), radians = Math.PI / 180;
const report = { version: 1, complete: false, fps: 30, method: 'Original retarget world/local mapping and independent rest slerp, sampled across every raw source clip. Records steps where the limit adds more than 15 degrees to the raw local step.', completedIds: [], clips: [] };
const output = '.artifacts/doreumi-contact-audit/limit-catalog.json';
function checkpoint() { fs.mkdirSync('.artifacts/doreumi-contact-audit', { recursive: true }); const temporary = `${output}.tmp-${process.pid}`; fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n'); fs.renameSync(temporary, output); }
let cached;
for (const item of manifest.motions.filter(item => !ids || ids.includes(item.actionId))) {
  const baseId = item.derivation?.baseSourceActionId ?? item.actionId;
  const batch = ledger.batches.find(batch => batch.actionIds.includes(baseId) && batch.file);
  if (!batch) throw new Error(`Missing raw source ${baseId}`);
  if (cached?.id !== batch.id) {
    const bytes = fs.readFileSync(`.artifacts/doreumi-meshy/${batch.file}`);
    cached = { id: batch.id, document: await io.readBinary(bytes), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  if (cached.sha256 !== item.sourceSha256) throw new Error(`Source checksum mismatch ${item.actionId}`);
  const source = sourceGraph(cached.document), target = targetGraph(contract), previous = new Map();
  const animation = cached.document.getRoot().listAnimations()[batch.actionIds.indexOf(baseId)];
  const channels = animation.listChannels().map(channel => samplerFor(channel, source));
  const duration = Math.max(...channels.map(channel => channel.times.at(-1))), events = [];
  for (let frame = 0; frame <= Math.ceil(duration * 30); frame++) {
    const time = Math.min(duration, frame / 30);
    for (const channel of channels) channel.node[{ rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.path]].fromArray(sampleChannel(channel, time));
    source.ordered.forEach(updateNode);
    for (const node of target.ordered) {
      const original = source.byName.get(SOURCE_MAP[node.name]);
      if (original) {
        node.quaternion.copy(localFromWorld(restDeltaQuaternion(original.worldQuaternion, original.restWorldQuaternion, node.restWorldQuaternion), node.parent?.worldQuaternion));
        const raw = node.quaternion.clone(), limit = DOREUMI_JOINT_LIMITS[node.name], angle = node.restLocalQuaternion.angleTo(raw);
        if (limit && angle > limit * radians) node.quaternion.copy(node.restLocalQuaternion.clone().slerp(raw, limit * radians / angle));
        const before = previous.get(node.name);
        if (before && limit) {
          const rawStep = before.raw.angleTo(raw) / radians, limitedStep = before.limited.angleTo(node.quaternion) / radians;
          if (limitedStep > rawStep + 15) {
            const relative = node.restLocalQuaternion.clone().invert().multiply(raw), prevRelative = node.restLocalQuaternion.clone().invert().multiply(before.raw);
            if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
            if (prevRelative.w < 0) prevRelative.set(-prevRelative.x, -prevRelative.y, -prevRelative.z, -prevRelative.w);
            const axisDot = new Vector3(relative.x, relative.y, relative.z).normalize().dot(new Vector3(prevRelative.x, prevRelative.y, prevRelative.z).normalize());
            events.push({ bone: node.name, time, rawStep, limitedStep, addedDegrees: limitedStep - rawStep, rawAngle: angle / radians, previousRawAngle: node.restLocalQuaternion.angleTo(before.raw) / radians, axisDot });
          }
        }
        previous.set(node.name, { raw, limited: node.quaternion.clone() });
      }
      updateNode(node);
    }
  }
  report.clips.push({ actionId: item.actionId, sourceActionId: baseId, sourceName: item.sourceName, sourceSha256: cached.sha256, duration, events }); report.completedIds.push(item.actionId);
  if (events.length || report.completedIds.length % 25 === 0) { checkpoint(); console.log(JSON.stringify({ complete: report.completedIds.length, actionId: item.actionId, events: events.length })); }
}
report.complete = true; report.affectedIds = report.clips.filter(item => item.events.length).map(item => item.actionId); checkpoint();
console.log(JSON.stringify({ complete: report.completedIds.length, affectedIds: report.affectedIds, output }));
