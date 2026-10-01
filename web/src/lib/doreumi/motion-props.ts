import * as THREE from 'three';
import { SNOWMAN_RADII } from '@/lib/doreumi/motion-snowman';
import { DOREUMI_LAP } from '@/lib/doreumi/motion-lap';

const material = (color: number, roughness = .7) => new THREE.MeshStandardMaterial({ color, roughness });
export function createSnowmanProp() {
  const root = new THREE.Group(); root.name = 'Doreumi_snowman';
  const snow = material(0xf6fafc, 1), coal = material(0x344050), carrot = material(0xd78d49);
  const base = new THREE.Mesh(new THREE.SphereGeometry(SNOWMAN_RADII.base, 24, 16), snow);
  const head = new THREE.Group();
  head.add(new THREE.Mesh(new THREE.SphereGeometry(SNOWMAN_RADII.head, 24, 16), snow.clone()));
  for (const x of [-.052, .052]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.018, 12, 8), coal); eye.position.set(x, .035, .147); head.add(eye); }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.024, .11, 12), carrot); nose.rotation.x = Math.PI / 2; nose.position.set(0, -.006, .184); head.add(nose);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(.12, .026, 8, 24), material(0x8cadb1)); scarf.rotation.x = Math.PI / 2; scarf.position.y = -.105; head.add(scarf);
  root.add(base, head); root.userData.base = base; root.userData.head = head;
  return root;
}
function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], surface: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surface); mesh.position.set(...position); parent.add(mesh); return mesh;
}

/** The lap socket and palms share the rig; no screen-space prop following. */
export function createLapProp(kind: 'laptop' | 'book'): THREE.Group {
  const group = new THREE.Group(); group.name = `Doreumi_${kind}`;
  if (kind === 'laptop') {
    const navy = material(0x414967), keys = material(0xdce3ed), screen = material(0x1c2941);
    box(group, [.66, .035, .4], [0, 0, 0], navy);
    box(group, [.52, .007, .20], [0, .021, -.025], keys);
    const key = material(0x707e9a);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) box(group, [.041, .006, .04], [(col - 4) * .052, .028, row * .055 - .085], key);
    box(group, [.13, .006, .055], [0, .022, -.145], keys);
    const lid = new THREE.Group(); lid.position.set(0, .0175, .18); lid.rotation.x = .20; group.add(lid);
    group.userData.lid = lid;
    box(lid, [.66, .38, .025], [0, .19, 0], navy);
    box(lid, [.59, .31, .006], [0, .19, -.016], screen);
    const codeColors = [material(0x91d2bf), material(0xa4b9e9), material(0xe6bc8e)];
    for (let row = 0; row < 6; row++) box(lid, [.13 + (row % 3) * .07, .012, .004], [-.1 + (row % 2) * .04, .30 - row * .038, -.021], codeColors[row % 3]);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(.042, 24), keys); badge.position.set(0, .20, .014); lid.add(badge);
  } else {
    const cover = material(0x618d89), paper = material(0xfff5dc), print = material(0xb1a994);
    // Readers tip the far edge up toward their eyes; the hinge stays on the near edge
    // so the palms keep resting on the pages.
    const tilt = new THREE.Group(); tilt.position.z = DOREUMI_LAP.bookHingeZ; tilt.rotation.x = -DOREUMI_LAP.bookTilt; group.add(tilt);
    const pages = new THREE.Group(); pages.position.z = -DOREUMI_LAP.bookHingeZ; tilt.add(pages);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Group(); leaf.rotation.z = side * .09; pages.add(leaf);
      box(leaf, [.30, .022, .34], [side * .151, 0, 0], cover);
      box(leaf, [.279, .021, .317], [side * .148, .021, 0], paper);
      for (let row = 0; row < 5; row++) box(leaf, [.19 - (row % 2) * .025, .002, .006], [side * .15, .033, -.11 + row * .047], print);
    }
  }
  // The short, wide mascot reaches the outer keys without stretching its arms.
  group.scale.x = 1.55;
  return group;
}
