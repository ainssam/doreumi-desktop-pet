import { solveContactAnglePath } from './meshy-contact-path.mjs';

/** Select connected feasible branches over the complete clip, then optimize
 * smooth angles inside those branches. Empty skin-feasible sets remain errors.
 * The branch search is a bounded discretization, not a global-optimum claim. */
export function solveContactIntervalPath(frames, { gridStep = .05, velocityWeight = 80, smoothness = 80 } = {}) {
  if (!Array.isArray(frames) || !frames.length || frames.length > 4000 || !Number.isFinite(gridStep) || gridStep < .025 || gridStep > .25
    || !Number.isFinite(velocityWeight) || velocityWeight < 0 || velocityWeight > 10000) throw new Error('Invalid contact interval path options');
  const normalized = frames.map(frame => {
    if (!Number.isFinite(frame.rawAngle) || Math.abs(frame.rawAngle) > Math.PI || !Array.isArray(frame.intervals) || frame.intervals.length > 16) throw new Error('Invalid contact interval frame');
    const intervals = frame.intervals.map(interval => {
      if (![interval.minimum, interval.maximum].every(Number.isFinite) || interval.minimum > interval.maximum
        || interval.minimum < -Math.PI || interval.maximum > Math.PI) throw new Error('Invalid skin-feasible angle interval');
      return { ...interval };
    }).sort((a, b) => a.minimum - b.minimum);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval.minimum <= last.maximum + 1e-10) last.maximum = Math.max(last.maximum, interval.maximum);
      else merged.push(interval);
    }
    return { rawAngle: frame.rawAngle, intervals: merged };
  });
  const emptyFrames = normalized.flatMap((frame, index) => frame.intervals.length ? [] : [index]);
  if (emptyFrames.length) return { angles: null, report: { feasible: false, reason: 'empty-skin-feasible-interval', emptyFrames } };
  const states = normalized.map(frame => frame.intervals.flatMap((interval, branch) => {
    const count = Math.max(1, Math.ceil((interval.maximum - interval.minimum) / gridStep));
    const values = new Set([Math.max(interval.minimum, Math.min(interval.maximum, frame.rawAngle))]);
    for (let index = 0; index <= count; index++) values.add(interval.minimum + (interval.maximum - interval.minimum) * index / count);
    return [...values].sort((a, b) => a - b).map(angle => ({ angle, branch }));
  }));
  if (states.some(frame => frame.length > 300)) throw new Error('Contact interval grid exceeds bounded state budget');
  const links = [], first = normalized[0];
  let costs = states[0].map(state => (state.angle - first.rawAngle) ** 2);
  for (let index = 1; index < frames.length; index++) {
    const previous = states[index - 1], next = states[index], back = new Uint16Array(next.length);
    const newCosts = next.map((state, current) => {
      let cost = Infinity;
      for (let old = 0; old < previous.length; old++) {
        const candidate = costs[old] + velocityWeight * (state.angle - previous[old].angle) ** 2;
        if (candidate < cost) { cost = candidate; back[current] = old; }
      }
      return cost + (state.angle - normalized[index].rawAngle) ** 2;
    });
    links.push(back); costs = newCosts;
  }
  let current = costs.indexOf(Math.min(...costs));
  const selected = new Array(frames.length);
  for (let index = frames.length - 1; index >= 0; index--) {
    selected[index] = states[index][current].branch;
    if (index) current = links[index - 1][current];
  }
  const constraints = normalized.map((frame, index) => ({ rawAngle: frame.rawAngle, ...frame.intervals[selected[index]] }));
  const solved = solveContactAnglePath(constraints, { smoothness });
  const maximumStep = Math.max(0, ...solved.angles.slice(1).map((angle, index) => Math.abs(angle - solved.angles[index])));
  return { angles: solved.angles, report: { ...solved.report, method: 'bounded-grid-branch-search-then-interval-quadratic-path', gridStep, velocityWeight,
    selectedBranches: selected, maximumStep, emptyFrames: [] } };
}
