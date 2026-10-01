export type DoreumiTravelContactPhase = {
  start: number; end: number; side: 'L' | 'R'; vertex: number; sourceVertex: number;
  sourceMaxSpeed: number; sourceMaxHeight: number; targetMaxHeight: number;
};
export type DoreumiTravelContactEvidence = {
  version: 1; basis: 'source-and-target-skin'; mesh: string; vertexCount: number;
  sourceFloor: number; sourceTolerance: number; targetFloor: number; targetTolerance: number;
  stationarySpeed: number; phases: DoreumiTravelContactPhase[];
};
export type DoreumiTravel = {
  version: 1;
  times: number[];
  positionsXZ: [number, number][];
  source: 'source-root' | 'target-stance';
  direction: [number, number];
  contactEvidence?: DoreumiTravelContactEvidence;
};

export type DoreumiStageFrame = {
  action: string;
  time: number;
  duration: number;
  paused: boolean;
  pixelsPerUnit: number;
  travel?: DoreumiTravel | null;
  fixedEnvironment?: boolean;
};
export type DoreumiStageDecision = { yaw: number; stop?: boolean };
export type DoreumiStageHandler = (frame: DoreumiStageFrame) => DoreumiStageDecision | void;

/** The renderer and host accept only a finite, ordered, animation-time curve.
 * A missing curve leaves a stationary action in its current position. */
export function parseDoreumiTravel(value: unknown, duration?: number): DoreumiTravel | undefined {
  if (value === undefined || value === null) return undefined;
  const travel = value as Partial<DoreumiTravel>;
  if (travel.version !== 1 || !['source-root', 'target-stance'].includes(travel.source ?? '')
    || !Array.isArray(travel.times) || travel.times.length < 2 || travel.times.length > 16384
    || !Array.isArray(travel.positionsXZ) || travel.positionsXZ.length !== travel.times.length
    || !Array.isArray(travel.direction) || travel.direction.length !== 2 || !travel.direction.every(Number.isFinite)
    || Math.hypot(...travel.direction) < 1e-6
    || travel.times[0] !== 0 || !travel.times.every((time, i, times) => Number.isFinite(time) && time >= 0 && time <= 180 && (!i || time > times[i - 1]))
    || !travel.positionsXZ.every(point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && Math.abs(value) <= 500))
    || Math.hypot(...travel.positionsXZ[0]) > 1e-4
    || (duration !== undefined && (!Number.isFinite(duration) || Math.abs(travel.times.at(-1)! - duration) > 1e-3))) throw new Error('Invalid Doreumi travel curve');
  if (travel.contactEvidence !== undefined) validateContactEvidence(travel.contactEvidence, travel.times.at(-1)!);
  return travel as DoreumiTravel;
}

function validateContactEvidence(value: DoreumiTravelContactEvidence, duration: number) {
  const contact = value as Partial<DoreumiTravelContactEvidence>;
  if (!contact || contact.version !== 1 || contact.basis !== 'source-and-target-skin'
    || typeof contact.mesh !== 'string' || !/^[A-Za-z0-9_ .:-]{1,80}$/.test(contact.mesh)
    || !Number.isInteger(contact.vertexCount) || contact.vertexCount! < 1 || contact.vertexCount! > 2_000_000
    || ![contact.sourceFloor, contact.targetFloor].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 500)
    || ![contact.sourceTolerance, contact.targetTolerance].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= .5)
    || typeof contact.stationarySpeed !== 'number' || !Number.isFinite(contact.stationarySpeed) || contact.stationarySpeed <= 0 || contact.stationarySpeed > 1
    || !Array.isArray(contact.phases) || contact.phases.length > 65_536) throw new Error('Invalid Doreumi skin contact evidence');
  const endBySide = { L: 0, R: 0 };
  for (const phase of contact.phases) {
    if (!phase || !['L', 'R'].includes(phase.side)
      || ![phase.start, phase.end, phase.sourceMaxSpeed, phase.sourceMaxHeight, phase.targetMaxHeight].every(Number.isFinite)
      || phase.start < 0 || phase.end <= phase.start || phase.end > duration + 1e-6
      || phase.start < endBySide[phase.side] - 1e-6
      || !Number.isInteger(phase.vertex) || phase.vertex < 0 || phase.vertex >= contact.vertexCount!
      || !Number.isInteger(phase.sourceVertex) || phase.sourceVertex < 0 || phase.sourceVertex >= 2_000_000
      || phase.sourceMaxSpeed < 0 || phase.sourceMaxSpeed > contact.stationarySpeed + 1e-6
      || Math.abs(phase.sourceMaxHeight) > contact.sourceTolerance! + 1e-6
      || Math.abs(phase.targetMaxHeight) > contact.targetTolerance! + 1e-6) throw new Error('Invalid Doreumi skin contact phase');
    endBySide[phase.side] = phase.end;
  }
}

export function sampleDoreumiTravel(travel: DoreumiTravel, seconds: number): [number, number] {
  const time = Math.max(0, Math.min(travel.times.at(-1)!, Number.isFinite(seconds) ? seconds : 0));
  let left = 0, right = travel.times.length - 1;
  while (right - left > 1) { const middle = (left + right) >>> 1; if (travel.times[middle] <= time) left = middle; else right = middle; }
  const fraction = (time - travel.times[left]) / (travel.times[right] - travel.times[left]);
  return [0, 1].map(axis => travel.positionsXZ[left][axis] * (1 - fraction) + travel.positionsXZ[right][axis] * fraction) as [number, number];
}

export function projectTravelPoint(point: readonly [number, number], yaw: number) {
  return point[0] * Math.cos(yaw) + point[1] * Math.sin(yaw);
}

/** Rotates source forward/back/strafe travel onto the viewport's horizontal
 * axis without changing the character's facing relative to that source gait. */
export function stageTravelYaw(travel: DoreumiTravel, direction: 'left' | 'right') {
  const yaw = Math.atan2(travel.direction[1], travel.direction[0]) + (direction === 'left' ? Math.PI : 0);
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}
