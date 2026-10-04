import type { DoreumiAction, DoreumiExpression } from './motion-catalog';
import type { doreumiSeason } from './seasons';

export type AuthoredAmbientAction = {
  action: Exclude<DoreumiAction, `meshy:${number}`>;
  expression: DoreumiExpression;
  seconds: number | [number, number];
};

/** The home director and shop use the same approved authored performances. */
export const HOME_AMBIENT_ACTIONS: AuthoredAmbientAction[] = [
  { action: 'Code', expression: 'focused', seconds: [10, 18] },
  { action: 'Read', expression: 'curious', seconds: [9, 16] },
  { action: 'Sit', expression: 'smile', seconds: [7, 12] },
  { action: 'Lie', expression: 'sleepy', seconds: [8, 14] },
  { action: 'HeadTilt', expression: 'confused', seconds: 4 },
  { action: 'Stretch', expression: 'yawning', seconds: 5 },
  { action: 'Joy', expression: 'sparkly', seconds: 4 },
  { action: 'Wave', expression: 'greeting_smile', seconds: 3.6 },
  { action: 'Think', expression: 'skeptical', seconds: 6 },
  { action: 'Cheer', expression: 'sparkly', seconds: 4 },
  { action: 'Jump', expression: 'laugh', seconds: 2.8 },
  { action: 'Showcase', expression: 'proud', seconds: 7.8 },
  { action: 'Bow', expression: 'greeting_smile', seconds: 4 },
  { action: 'Roll', expression: 'laugh', seconds: 4 },
  { action: 'PeekLeft', expression: 'curious', seconds: 5 },
  { action: 'PeekRight', expression: 'curious', seconds: 5 },
];

export const SEASONAL_AMBIENT_ACTIONS: Partial<Record<ReturnType<typeof doreumiSeason>, AuthoredAmbientAction>> = {
  seollal: { action: 'NewYearBow', expression: 'greeting_smile', seconds: 7 },
  christmas: { action: 'Snowman', expression: 'laugh', seconds: 7 },
};
