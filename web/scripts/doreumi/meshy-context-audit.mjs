/** Catalog-wide semantic audit of the approved 524 non-Fighting entries.
 * These dependencies are conservative review gates, not claims that a prop is implemented.
 * Entries remain available for explicit inspection even when ambient context is missing.
 */
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
const RULES = [
  { ids: [46], dependency: 'jump-rope', reason: 'A skipping rope must pass the hands and clear both feet in phase.' },
  { ids: [48], dependency: 'mirror', reason: 'The named mirror-viewing action needs a visible reflective target.' },
  { ids: [52, 53, 57, 58, 60, 268, 299, 300, 302, 304, 305, 307, 354, 355, 356, 357, 358, 359, 360, 361], dependency: 'seating-surface', reason: 'Seated/standing transitions need a support surface or an explicitly reviewed floor-sitting adaptation.' },
  { ids: [259, 260, 261, 262], dependency: 'pushable-object', reason: 'Pushing requires a target and palm contact; no object is inferred from empty space.' },
  { ids: [263], dependency: 'desk', reason: 'Sleep_on_Desk requires support under the upper body.' },
  { ids: [273, 274, 275, 276, 280, 281, 282], dependency: 'pickup-item', reason: 'Pickup/throw/inspect actions need an item with ground, held, and release phases.' },
  { ids: [277, 278], dependency: 'fruit-basket', reason: 'The named fruit and basket must be visible and grasped.' },
  { ids: [283], dependency: 'radish', reason: 'Pull_Radish requires an anchored vegetable and a release event.' },
  { ids: [320, 331], dependency: 'exercise-weight', reason: 'Curl/high-pull exercise requires a weight or an explicitly reviewed empty-hand exercise adaptation.' },
  { ids: [323], dependency: 'golf-club', reason: 'The named golf swing requires a club and a contact/release context.' },
  { ids: [335, 514, 542, 545, 547, 560, 627, 672, 681, 682, 684], dependency: 'weapon', reason: 'Axe, bow, spear, and grenade names are weapon contexts even outside Meshy Fighting.' },
  { ids: [337, 520, 521, 522, 578, 624, 625], dependency: 'torch', reason: 'A torch grip needs a held light source and an appropriate scene.' },
  { ids: [342, 343], dependency: 'cup', reason: 'Drinking requires a cup/bottle with a mouth contact interval.' },
  { ids: [343], dependency: 'seating-surface', reason: 'Sit_and_Drink also needs reviewed seat support.' },
  { ids: [371], dependency: 'bed', reason: 'Sit_Lie_Bed needs bed support through the transition.' },
  { ids: [390], dependency: 'balance-pole', reason: 'Stand_on_Pole_and_Balance needs the named support pole.' },
  { ids: [393], dependency: 'baseball', reason: 'Pitching needs a ball and a timed release.' },
  { ids: [410], dependency: 'soccer-ball', reason: 'The foot must contact a visible ball at the kick.' },
  { ids: [389, 398, 419, 421, 465], dependency: 'interaction-target', reason: 'The catch/grip/throw target is unspecified and must be reviewed before ambient playback.' },
  { ids: [411], dependency: 'inappropriate-gesture', reason: 'Neck_Slashing_Gesture is unsuitable for spontaneous friendly mascot behavior.' },
  { ids: [425, 427, 428, 429, 430, 431, 432, 433, 467, 471, 472, 640, 641, 642, 651], dependency: 'obstacle', reason: 'Vault/jump-over movement requires an obstacle with correct support and clearance.' },
  { ids: [426], dependency: 'cover', reason: 'Roll_Behind_Cover requires cover in the scene.' },
  { ids: [470, 501], dependency: 'launch-platform', reason: 'The original clip starts standing on an elevated surface; entry needs a platform and a supported approach before the drop.' },
  { ids: range(434, 438), dependency: 'ladder', reason: 'Ladder rungs must meet the original short limbs without stretching.' },
  { ids: [407, 439, 440, 444, 445, 446, 447, 448, 450, 475, 476, 482, 486, 487, 488, 489, 492, 493, 497, 498, 499, 500, 619, 620], dependency: 'climbing-surface', reason: 'Wall/climb/hang movement needs a surface and hand/foot support; flat stage grounding is insufficient.' },
  { ids: [441, 442], dependency: 'stairs', reason: 'Stair steps need matching foot heights and horizontal travel.' },
  { ids: [449, 477, 479, 480, 481, 494, 496], dependency: 'rope', reason: 'Rope climbing/hanging needs tensioned rope and grip contact.' },
  { ids: [478, 483, 484, 485, 491, 495], dependency: 'bar', reason: 'Hanging/swinging needs a bar and fixed grip support.' },
  { ids: [458], dependency: 'unicycle', reason: 'Unicycle_Jump_Dismount needs the named vehicle and a dismount transition.' },
  { ids: [564, 677], dependency: 'tightrope', reason: 'Tightrope_Walk needs the named support rather than free-air balancing.' },
  { ids: [567, 696], dependency: 'walker', reason: 'Walker-assisted gait requires visible hand support and synchronized walker travel.' },
  { ids: [568, 569, 570], dependency: 'water', reason: 'Swimming requires water and buoyancy context, not floor-foot stage travel.' },
];
const FIXED_SCENE = new Set(['desk', 'bed', 'balance-pole', 'obstacle', 'cover', 'launch-platform', 'ladder', 'climbing-surface', 'stairs', 'rope', 'bar', 'unicycle', 'tightrope', 'water']);

export function auditMotionContext(metadata, existingProps = []) {
  const rules = RULES.filter(rule => rule.ids.includes(metadata.actionId));
  const dependencies = [...new Set([...existingProps, ...rules.map(rule => rule.dependency)])];
  const inappropriate = dependencies.some(value => ['weapon', 'cannon', 'door', 'inappropriate-gesture'].includes(value));
  const fixedScene = dependencies.filter(value => FIXED_SCENE.has(value));
  return {
    version: 1, catalogLabelReviewed: true,
    status: inappropriate ? 'inappropriate-ambient-context' : dependencies.length ? 'requires-context' : 'self-contained-candidate',
    dependencies, notes: rules.map(rule => rule.reason),
    floatingStageContext: inappropriate ? 'inappropriate' : fixedScene.length ? 'fixed-environment-excluded' : dependencies.length ? 'portable-context-pending' : 'self-contained-candidate',
    ...(fixedScene.length ? { ambientExclusionReason: `A floating page companion has no fixed ${fixedScene.join('/')} environment.` } : {}),
    visualReviewRequired: true,
  };
}
