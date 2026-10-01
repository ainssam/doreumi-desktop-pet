export type EnvironmentAnchor = { action: string; x: number; y: number; cancelled: boolean };

/** A page move interrupts a fixed surface action instead of carrying its wall. */
export function stepEnvironmentAnchor(previous: EnvironmentAnchor | null, action: string | null, x: number, y: number, enabled: boolean): EnvironmentAnchor | null {
  if (!action) return null;
  const prior = previous?.action === action ? previous : null;
  const valid = Number.isFinite(x) && Number.isFinite(y);
  return {
    action, x: prior?.x ?? x, y: prior?.y ?? y,
    cancelled: !!prior?.cancelled || !enabled || !valid || !!prior && Math.hypot(x - prior.x, y - prior.y) > .5,
  };
}
