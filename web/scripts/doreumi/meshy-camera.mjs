import { AnimationClip } from 'three';

/** Measure final serialized animation, so framing follows exactly the shipped skin. */
export function buildTrackedCamera(json, graph, support, updateNode) {
  const clip = AnimationClip.parse(json);
  const tracks = clip.tracks.map(track => ({ node: graph.byName.get(track.name.split('.')[0]),
    property: track.name.split('.')[1], sample: track.createInterpolant() }));
  const times = [], centers = [];
  let halfHeight = 1;
  for (let index = 0; index <= Math.ceil(clip.duration * 60); index++) {
    const time = Math.min(clip.duration, index / 60);
    for (const track of tracks) track.node[track.property].fromArray(track.sample.evaluate(time));
    graph.ordered.forEach(updateNode);
    const bounds = support.measure(graph, true), center = (bounds.minY + bounds.maxY) / 2;
    halfHeight = Math.max(halfHeight, (bounds.maxY - bounds.minY) / 2 + .16, bounds.radius + .16);
    if (!Number.isFinite(center) || !Number.isFinite(halfHeight) || Math.abs(center) > 10 || halfHeight > 10) throw Error('Unbounded tracked camera');
    if (times.length && time - times.at(-1) < 1e-6) { times[times.length - 1] = time; centers[centers.length - 1] = center; }
    else { times.push(time); centers.push(center); }
  }
  return { halfHeight, centerY: centers[0], tracking: { times, centerY: centers } };
}
