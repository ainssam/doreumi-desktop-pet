export const SNOWMAN_RADII = { base: .28, head: .16 } as const;
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;

/** Avatar-floor coordinates, shared by the hand solver and the visible prop.
 * The snowman stays beside the short right arm instead of requiring long arms
 * or pushing a central ball through the character's stomach. */
export function sampleSnowmanMotion(seconds: number) {
  const t = Math.max(0, Math.min(7, seconds)), working = ease(t / .55) * ease((6.5 - t) / .65);
  const rolling = ease((t - .45) / .25) * (1 - ease((t - 2.45) / .3));
  const rollTravel = .07 * rolling * (1 - Math.cos(Math.PI * 2 * (t - .6)));
  const lift = ease((t - 2.65) / 1.1), low = 1 - ease((t - 2.5) / 1.1);
  const basePosition: [number, number, number] = [-.64, .28, .34 + rollTravel];
  const headPosition: [number, number, number] = [-.65 + .01 * lift, mix(.65, .72, lift) + .13 * Math.sin(Math.PI * lift), mix(.29, .34, lift)];
  const pat = ease((t - 3.9) / .35) * (1 - ease((t - 5.55) / .3));
  const patHeight = .07 * (.5 + .5 * Math.sin(Math.PI * 2 * (t - 4.15) / .55));
  const carrying = ease((t - 2.55) / .35), showing = ease((t - 5.65) / .55);
  const handPosition: [number, number, number] = [
    mix(mix(-.66, headPosition[0] - .01, carrying), -.83, showing),
    mix(mix(.515, headPosition[1] - .14, carrying) + pat * (.24 + patHeight), .82, showing),
    mix(mix(basePosition[2] - .055, headPosition[2] - .03, carrying), .11, showing),
  ];
  const opacity = ease(t / .25) * ease((7 - t) / .4);
  return { phase: t < 2.65 ? 'roll' : t < 3.9 ? 'lift' : t < 5.75 ? 'pat' : 'show', basePosition, headPosition, handPosition, ballAngle: -rollTravel / SNOWMAN_RADII.base, headOpacity: ease((t - 2.55) / .25) * opacity, opacity, working, crouch: working * (.15 + .90 * low), lean: working * (.12 + .26 * low) };
}
