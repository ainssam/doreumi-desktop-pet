/** Measured against the fixed-length, 2.14-unit master rig. The different book
 * height accounts for its angled cover, rather than treating it as a laptop. */
export const DOREUMI_LAP = {
  sitSeconds: .9,
  handsStartSeconds: .55,
  handsSeconds: .4,
  appearSeconds: .95,
  fadeSeconds: .25,
  position: [0, .322, .4092] as const,
  bookHeightOffset: -.058,
  rotation: [.2, 0, -.001] as const,
  scale: [.8, 1, .75] as const,
  pelvisPitch: -.65,
  torsoPitch: { Code: .55, Read: .67 },
  handHeight: { Code: .079, Read: .099 },
  handDepth: { Code: -.011, Read: -.045 },
  handWidth: .4,
  typingLift: .005,
  readingLift: .008,
  /** The book's far edge tips up toward the eyes around its near-edge hinge. */
  bookTilt: .45,
  bookHingeZ: -.17,
} as const;

export function lapPropVisibility(time: number, holding = false) {
  if (holding) return 1;
  const t = Math.min(1, Math.max(0, (time - DOREUMI_LAP.appearSeconds) / DOREUMI_LAP.fadeSeconds));
  return t * t * (3 - 2 * t);
}
