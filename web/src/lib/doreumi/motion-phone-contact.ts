/** Fixed material points on the unchanged master mesh, measured on its palm faces.
 * Runtime placement and offline wrist adaptation share the same contact frame.
 */
export const PHONE_PALM_CONTACTS = [
  { vertex: 77749, localUp: [1, -1, 0] as const },
  { vertex: 1033, localUp: [-1, -1, 0] as const },
] as const;
