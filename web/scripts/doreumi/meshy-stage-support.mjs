import { reconstructInplaceGroundFrame } from './meshy-inplace-ground.mjs';
import { AnimationClip } from 'three';
import { sourceGraph, targetGraph, samplerFor, sampleChannel, updateNode, serializeClip } from './meshy-retarget.mjs';
import { bakePhaseAwareTravel } from './meshy-phase-travel.mjs';
import { sourceTailEvidence, sourceTailSampleTime } from './meshy-source-tail.mjs';

/** The source clock used for contact classification must match the source
 * clock that produced the virtual clip, including an audited damaged key. */
export function stageSourceSampleTime(clipName, evidence, metadata, time) {
  if (clipName !== 'meshy:463') return time;
  if (metadata?.actionId !== 463) throw new Error('Stage463 requires its verified source metadata');
  const repair = sourceTailEvidence(metadata, evidence.sourceDuration);
  if (JSON.stringify(evidence.sourceTailRepair) !== JSON.stringify(repair))
    throw new Error('Stage463 source-tail repair differs from its virtual clip');
  return sourceTailSampleTime(metadata, time, evidence.sourceDuration);
}

/** Recompute stage motion from virtual-root support, never replay a stored travel curve. */
export function splitReviewedStageSupport({ json, evidence: originalEvidence, document, animation, contract, support, sourceSampler, targetSampler, metadata, reconstructInplaceGround = false }) {
  const evidence = structuredClone(originalEvidence), clip = AnimationClip.parse(json);
  if (!evidence.planarSupport || !sourceSampler || !targetSampler) throw new Error('Stage support requires actual source and target skin samplers');
  const root = clip.tracks.find(track => track.name === 'DoreumiRig.position');
  if (!root) throw new Error('Stage support requires a virtual root track');
  for (let index = 0; index < root.values.length; index += 3) { root.values[index] = 0; root.values[index + 2] = 0; }
  const source = sourceGraph(document), channels = animation.listChannels().map(channel => samplerFor(channel, source));
  const times = Array.from({ length: Math.ceil(evidence.sourceDuration * 30) + 1 }, (_, index) => Math.min(index / 30, evidence.sourceDuration));
  let sourceFeet = [], sourceRoots = [];
  for (const time of times) {
    const sourceTime = stageSourceSampleTime(clip.name, evidence, metadata, time);
    for (const channel of channels) channel.node[{ rotation: 'quaternion', translation: 'position', scale: 'scale' }[channel.path]].fromArray(sampleChannel(channel, sourceTime));
    source.ordered.forEach(updateNode);
    sourceFeet.push(sourceSampler.sample(source)); sourceRoots.push(source.byName.get('Hips').worldPosition.toArray());
  }
  if (reconstructInplaceGround) {
    const staggerGait = clip.name === 'meshy:650' && metadata?.actionId === 650 && metadata?.sourceName === 'Mummy_Stagger_inplace';
    if (!evidence.semantics?.inPlaceSource || (evidence.semantics.kind !== 'locomotion' && !staggerGait)) throw new Error('Ground-frame reconstruction requires an explicit inplace locomotion source');
    const ground = reconstructInplaceGroundFrame({ times, sourceFeet, sourceRoots, sourceFloor: evidence.planarSupport.sourceFloor });
    sourceFeet = ground.sourceFeet; sourceRoots = ground.sourceRoots; evidence.inplaceGroundFrame = ground.evidence;
    if (staggerGait) evidence.semantics.kind = 'locomotion';
  }
  const travel = bakePhaseAwareTravel({ clip, evidence, contract, sourceTimes: times, sourceFeet, sourceRoots,
    sourceVertexIds: sourceSampler.vertexIds, sourceFloor: evidence.planarSupport.sourceFloor, targetSampler, preservePhaseTimePrecision: reconstructInplaceGround });
  if (travel.contactEvidence.missingTargetContactPairs !== 0) throw new Error('Reviewed stage lost source-planted contact');
  const target = targetGraph(contract), tracks = clip.tracks.map(track => ({ node: target.byName.get(track.name.split('.')[0]), key: track.name.split('.')[1], sample: track.createInterpolant() }));
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, radius: 0 };
  for (let index = 0; index <= Math.ceil(clip.duration * 30); index++) {
    const time = Math.min(index / 30, clip.duration);
    for (const track of tracks) track.node[track.key].fromArray(track.sample.evaluate(time));
    target.ordered.forEach(updateNode);
    const frame = support.measure(target, true);
    for (const key of ['minX', 'minY', 'minZ']) bounds[key] = Math.min(bounds[key], frame[key]);
    for (const key of ['maxX', 'maxY', 'maxZ', 'radius']) bounds[key] = Math.max(bounds[key], frame[key]);
  }
  evidence.virtualSupport = evidence.planarSupport; delete evidence.planarSupport;
  evidence.rootPolicy = 'virtual-root actual skin support solved offline; horizontal root removed and source-phase stage travel rebaked';
  evidence.bounds = bounds;
  evidence.framing = { halfHeight: Math.max((bounds.maxY - bounds.minY) / 2 + .16, bounds.radius + .16), centerY: (bounds.minY + bounds.maxY) / 2 };
  evidence.semantics.travel = travel;
  return { json: serializeClip(clip), evidence };
}
