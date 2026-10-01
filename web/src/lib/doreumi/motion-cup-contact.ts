import { Matrix4, Quaternion, Vector3 } from 'three';

/** Neutral mouth centre from the rendered face projection, sampled on the
 * unchanged master skin (vertex 36403), including its head/torso blend. */
export const CUP_MOUTH = { vertex: 36403, influences: [
  { bone: 'head', weight: .7363969087600708, local: [.004462851486079833, .1301716622780429, .34595863573774466] },
  { bone: 'torso', weight: .2636030912399292, local: [.004462851486079833, .5451716688345538, .3709586361102737] },
] } as const;
// Source sip timing, with a slightly longer release for the short fixed-length
// arm. One C1 envelope is shared by the baked hand and the runtime cup tilt.
const SIP_PHASES: Record<number, [number, number, number, number]> = {
  342: [2.7, 3.7, 5, 5.75],
  343: [3.5, 4.3, 6.8, 7.7],
};
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
export function cupSipWeight(actionId: number, sourceTime: number) {
  const phase = SIP_PHASES[actionId]; if (!phase) return 0;
  return smooth((sourceTime - phase[0]) / (phase[1] - phase[0])) * (1 - smooth((sourceTime - phase[2]) / (phase[3] - phase[2])));
}
export function cupOrientation(right: Vector3, heading: Vector3, sip: number, side: number) {
  const x = right.clone().multiplyScalar(side ? 1 : -1), tilt = sip * 20 * Math.PI / 180;
  const y = new Vector3(0, Math.cos(tilt), 0).addScaledVector(heading, -Math.sin(tilt)), z = x.clone().cross(y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
export const cupGripLocal = () => new Vector3(-.172, 0, 0);
export const cupRimLocal = (side: number) => new Vector3(0, .1, side ? -.085 : .085);
