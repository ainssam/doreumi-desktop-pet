/** Merge acquisition facts without silently promoting or preserving stale reviews. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { motionMetadataSha256 } from './motion-metadata.mjs';
import { parseDoreumiEnvironment } from '../../src/lib/doreumi/motion-environment-contract.ts';
const file = 'public/doreumi/motions/registry.json';
const source = JSON.parse(await readFile('public/doreumi/motions/meshy-source-manifest.json', 'utf8'));
const registry = JSON.parse(await readFile(file, 'utf8'));
const masterSha256 = createHash('sha256').update(await readFile('public/doreumi/doreumi-master.glb')).digest('hex');
for (const entry of registry.motions) {
  const imported = source.motions.find(item => item.actionId === entry.sourceActionId);
  if (!imported?.url || imported.retarget !== 'converted') continue;
  const metadataSha256 = motionMetadataSha256(imported);
  const environment = imported.retargetEvidence?.environmentSupport;
  const validEnvironment = environment !== undefined && !!parseDoreumiEnvironment(environment, entry.sourceActionId)
    && !!imported.retargetEvidence?.planarSupport && !imported.retargetEvidence?.semantics?.travel;
  if (environment !== undefined && !validEnvironment) throw Error(`Invalid fixed environment for ${entry.id}`);
  if (entry.convertedSha256 !== imported.convertedSha256 || entry.masterSha256 !== masterSha256 || entry.metadataSha256 !== metadataSha256) {
    entry.review = 'pending'; entry.ambient = false; entry.evidence = [];
  }
  entry.metadataSha256 = metadataSha256;
  const semantics = imported.retargetEvidence?.semantics;
  const props = [...new Set([...(semantics?.requiresProps ?? []), ...(semantics?.contextAudit?.dependencies ?? [])])];
  entry.entryDuration = imported.retargetEvidence?.entryDuration;
  entry.exitDuration = imported.retargetEvidence?.exitDuration;
  entry.sourceQuality = imported.sourceQuality;
  entry.environmentSupport = environment;
  entry.planarSupport = imported.retargetEvidence?.planarSupport ? { version: 1, maxOffset: imported.retargetEvidence.planarSupport.maxOffset } : undefined;
  Object.assign(entry, { url: imported.url, duration: imported.retargetEvidence?.duration ?? imported.duration, frame: imported.retargetEvidence?.framing, semantics: semantics ? { ...semantics, travel: undefined } : undefined, travel: semantics?.travel, props, derivation: imported.derivation, convertedSha256: imported.convertedSha256, targetRigSignature: imported.targetRigSignature, masterSha256 });
  if (imported.sourceQuality?.status === 'constant-animation') entry.exclusionReason = 'The acquired source animation has constant channels; its named action is unavailable in the supplied clip.';
  else if (entry.props?.some(prop => ['weapon', 'cannon'].includes(prop))) entry.exclusionReason = 'Weapon-dependent source motion is retained for provenance but excluded from the friendly ambient character.';
  else if (entry.props?.includes('door')) entry.exclusionReason = 'Requires a fixed doorway; the floating page companion has no room doorway to interact with.';
  else if (semantics?.contextAudit?.status === 'inappropriate-ambient-context') entry.exclusionReason = `Inappropriate ambient context: ${props.join(', ')}.`;
  else if (semantics?.contextAudit?.floatingStageContext === 'fixed-environment-excluded' && !validEnvironment) entry.exclusionReason = semantics.contextAudit.ambientExclusionReason;
  else if (['The acquired source animation has constant channels;', 'Requires a fixed doorway;', 'Weapon-dependent source motion', 'Inappropriate ambient context:', 'A floating page companion has no fixed '].some(prefix => entry.exclusionReason?.startsWith(prefix))) delete entry.exclusionReason;
  if (entry.exclusionReason) entry.ambient = false;
}
await writeFile(file, JSON.stringify(registry, null, 2) + '\n');
console.log(JSON.stringify({ registered: registry.motions.length, converted: registry.motions.filter(item => item.url).length, passed: registry.motions.filter(item => item.review === 'passed').length, ambient: registry.motions.filter(item => item.review === 'passed' && item.ambient).length }));
