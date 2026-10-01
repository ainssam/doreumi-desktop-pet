import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DoreumiLowLedge } from '@/lib/doreumi/motion-environment-contract';

type Points = { L: THREE.Vector3; R: THREE.Vector3 };
type Contact = { target: string; targetPoint: THREE.Vector3; propPoint: THREE.Vector3; distance: number };

/** Fixed support geometry. Hand/foot poses never move or resize the surface. */
export function createDoreumiEnvironmentProp(config: DoreumiLowLedge) {
  const root = new THREE.Group(); root.name = 'Doreumi_low_climbing_wall';
  const g = config.geometry;
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8dbcd, roughness: .88 });
  const mint = new THREE.MeshStandardMaterial({ color: 0x98b9ac, roughness: .8 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb69270, roughness: .73 });
  const geometries = new Set<THREE.BufferGeometry>();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); root.add(mesh); geometries.add(geometry); return mesh;
  };
  add(new RoundedBoxGeometry(g.width, g.wallTop, g.depth, 4, .035), stone, [0, g.wallTop / 2, g.frontZ + g.depth / 2]);
  add(new RoundedBoxGeometry(g.width, g.footstepTop, g.footstepBackZ - g.footstepFrontZ, 4, .022), mint,
    [0, g.footstepTop / 2, (g.footstepFrontZ + g.footstepBackZ) / 2]);
  for (const [minimum, maximum] of g.rails) {
    const rail = add(new THREE.CylinderGeometry(g.railRadius, g.railRadius, maximum - minimum, 20), wood,
      [(minimum + maximum) / 2, g.top - g.railRadius, g.railZ]); rail.rotation.z = Math.PI / 2;
    const outer = Math.abs(minimum) > Math.abs(maximum) ? minimum : maximum;
    const bracket = add(new THREE.CylinderGeometry(.014, .014, g.frontZ + g.depth / 2 - g.railZ, 12), wood,
      [outer, g.top - g.railRadius, (g.railZ + g.frontZ + g.depth / 2) / 2]); bracket.rotation.x = Math.PI / 2;
  }
  const nearestRail = (point: THREE.Vector3, floor: number) => {
    const candidates = g.rails.map(([minimum, maximum]) => {
      const axis = new THREE.Vector3(THREE.MathUtils.clamp(point.x, minimum, maximum), floor + g.top - g.railRadius, g.railZ);
      const radial = point.clone().sub(axis).setX(0);
      if (radial.lengthSq() < 1e-12) radial.set(0, 1, 0);
      return radial.normalize().multiplyScalar(g.railRadius).add(axis);
    });
    return candidates.sort((a, b) => a.distanceToSquared(point) - b.distanceToSquared(point))[0];
  };
  const update = ({ floor, opacity, hands, feet }: { floor: number; opacity: number; hands: Points; feet: Points }) => {
    root.position.set(0, floor, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    root.visible = opacity > .001;
    for (const material of [stone, mint, wood]) { material.opacity = opacity; material.transparent = opacity < 1; material.depthWrite = opacity > .95; }
    const contacts: Contact[] = [];
    for (const side of ['L', 'R'] as const) {
      const hand = hands[side], palmSurface = nearestRail(hand, floor);
      contacts.push({ target: `palm${side}-skin`, targetPoint: hand.clone(), propPoint: palmSurface, distance: hand.distanceTo(palmSurface) });
      const foot = feet[side], step = new THREE.Vector3(THREE.MathUtils.clamp(foot.x, -g.width / 2, g.width / 2), floor + g.footstepTop,
        THREE.MathUtils.clamp(foot.z, g.footstepFrontZ, g.footstepBackZ));
      const ground = foot.clone().setY(floor), surface = ground.distanceToSquared(foot) < step.distanceToSquared(foot) ? ground : step;
      contacts.push({ target: `sole${side}-skin`, targetPoint: foot.clone(), propPoint: surface, distance: foot.distanceTo(surface) });
    }
    root.updateMatrixWorld(true);
    return { phase: 'supported' as const, contacts };
  };
  const dispose = () => { root.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); [stone, mint, wood].forEach(material => material.dispose()); };
  return { root, frame: { halfHeight: 1.64, centerY: 1.05 }, update, dispose };
}
