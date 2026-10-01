import * as THREE from 'three';
import { FRUIT_EVENTS, PORTABLE_EVENTS } from '@/lib/doreumi/motion-portable-events';
import { cupSipWeight, cupOrientation, cupGripLocal, cupRimLocal } from '@/lib/doreumi/motion-cup-contact';

export type PortableKind = 'jump-rope' | 'mirror' | 'cup' | 'exercise-weight' | 'baseball' | 'soccer-ball' | 'fruit-basket' | 'radish' | 'pickup-item' | 'seating-surface' | 'torch' | 'walker';
export const PORTABLE_KINDS = new Set<string>(['jump-rope', 'mirror', 'cup', 'exercise-weight', 'baseball', 'soccer-ball', 'fruit-basket', 'radish', 'pickup-item', 'seating-surface', 'torch', 'walker']);
export const JUMP_ROPE_SOURCE_PEAKS = [10 / 30, 41 / 30, 72 / 30, 103 / 30, 135 / 30, 168 / 30, 201 / 30, 234 / 30] as const;
export type PortablePhase = 'ground' | 'held' | 'supported' | 'released' | 'contained';
export type PortableContact = { target: string; targetPoint: THREE.Vector3; propPoint: THREE.Vector3 };
export type PortableInput = {
  time: number; duration: number; entry: number; opacity: number; floor: number;
  grips: [THREE.Vector3, THREE.Vector3]; bodyPosition: THREE.Vector3;
  heading: THREE.Vector3; right: THREE.Vector3; bodyPoints: readonly THREE.Vector3[];
  mouthPoint?: THREE.Vector3;
  buttPoint?: THREE.Vector3;
  buttPoints?: THREE.Vector3[];
  handPoints?: THREE.Vector3[][];
  stagePosition?: readonly [number, number];
};
const UP = new THREE.Vector3(0, 1, 0);
const WALKER_HANDLE_HEIGHT = .561;
const WALKER_HANDLE_HALF_WIDTH = .619;
const WALKER_GRIP_START = 0;
const clamp = THREE.MathUtils.clamp;
const smooth = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// A narrow front leaves room for the planted feet, with a rounded rear pad.
const cushionWidth = (z: number) => .25 + .75 * smooth((-z + .2) / 1.2);
const vec = (value: readonly number[]) => new THREE.Vector3().fromArray(value);
type Event = { side: number; grab: number; grip: readonly number[]; release?: number; releaseGrip?: readonly number[]; velocity?: readonly number[] };

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position = new THREE.Vector3()) {
  const object = new THREE.Mesh(geometry, material); object.position.copy(position); parent.add(object); return object;
}
function bar(parent: THREE.Object3D, material: THREE.Material, radius = .018) {
  return mesh(parent, new THREE.CylinderGeometry(radius, radius, 1, 8), material);
}
function connect(object: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const direction = b.clone().sub(a), length = direction.length();
  object.position.copy(a).add(b).multiplyScalar(.5); object.scale.y = Math.max(.0001, length);
  object.quaternion.setFromUnitVectors(UP, length ? direction.divideScalar(length) : UP);
}
function ellipsoid(parent: THREE.Object3D, material: THREE.Material, scale: [number, number, number], position = new THREE.Vector3()) {
  const object = mesh(parent, new THREE.SphereGeometry(1, 24, 16), material, position); object.scale.set(...scale); return object;
}
function flameDrop(parent: THREE.Object3D, material: THREE.Material, height: number, width: number, depth: number, bend: number, offsetZ = 0) {
  const geometry = new THREE.SphereGeometry(1, 24, 24), positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const y = positions.getY(index), t = clamp((y + 1) / 2, 0, 1);
    const ring = Math.hypot(positions.getX(index), positions.getZ(index));
    const radius = Math.sin(Math.PI * t) ** .85 * width * (1 - .55 * t);
    const scale = ring > 1e-7 ? radius / ring : 0;
    positions.setXYZ(index, positions.getX(index) * scale + bend * t ** 3, .278 + height * t, positions.getZ(index) * scale * depth + offsetZ);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return mesh(parent, geometry, material);
}
function box(parent: THREE.Object3D, material: THREE.Material, dimensions: [number, number, number], position = new THREE.Vector3()) {
  return mesh(parent, new THREE.BoxGeometry(...dimensions), material, position);
}
function ring(parent: THREE.Object3D, material: THREE.Material, radius: number, thickness: number) {
  return mesh(parent, new THREE.TorusGeometry(radius, thickness, 8, 24), material);
}
function alpha(root: THREE.Object3D, opacity: number) {
  root.visible = opacity > .001;
  root.traverse(object => { if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.transparent = opacity < .999; material.opacity = opacity; material.depthWrite = opacity > .95; } });
}

/** Portable scenery never moves a character joint. Contacts use the caller's
 * deformed skin probes; event positions were measured on the shipping clips. */
export function createPortableContextProp(kind: PortableKind, actionId: number) {
  const root = new THREE.Group(); root.name = `Doreumi_portable_${kind}`;
  const body = new THREE.Group(); root.add(body);
  const material = (color: number, roughness = .7) => new THREE.MeshStandardMaterial({ color, roughness });
  const mint = material(0x91bdb1), cream = material(0xfff0cf), navy = material(0x414967), rose = material(0xe29d91), wood = material(0xb99873);
  const pieces: THREE.Group[] = [], bars: THREE.Mesh[] = [];
  let ropeGeometry: THREE.BufferGeometry | null = null, seat: THREE.Mesh | null = null;
  const walkerWheels: { caster: THREE.Group; spin: THREE.Group; previous: THREE.Vector3 | null; angle: number }[] = [];
  let previousWalkerTime: number | null = null;
  const event: Event | undefined = (PORTABLE_EVENTS as Record<number, Event>)[actionId];
  const fruitEvents = (FRUIT_EVENTS as Record<number, readonly { grab: number; grip: readonly number[]; release: number }[]>)[actionId];
  const part = () => { const value = new THREE.Group(); root.add(value); pieces.push(value); return value; };

  if (kind === 'jump-rope') {
    bars.push(bar(root, mint, .027), bar(root, mint, .027));
    const segments = 48, sides = 6, positions = new Float32Array((segments + 1) * sides * 3), indices: number[] = [];
    for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) { const a = i * sides + j, b = i * sides + (j + 1) % sides, c = a + sides, d = b + sides; indices.push(a, b, c, b, d, c); }
    ropeGeometry = new THREE.BufferGeometry(); ropeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); ropeGeometry.setIndex(indices); mesh(body, ropeGeometry, rose);
  } else if (kind === 'mirror') {
    const rim = ring(body, wood, .43, .035); rim.scale.y = 1.48;
    const silver = material(0xcedfe0, .24); silver.side = THREE.DoubleSide;
    const surface = mesh(body, new THREE.CircleGeometry(.417, 36), silver); surface.scale.y = 1.48;
    const glint = box(body, cream, [.022, .30, .006], new THREE.Vector3(-.16, .14, .008)); glint.rotation.z = -.4;
    const smallGlint = box(body, cream, [.016, .15, .006], new THREE.Vector3(-.09, .20, .008)); smallGlint.rotation.z = -.4;
    bars.push(bar(root, wood, .032)); ellipsoid(root, wood, [.30, .028, .23], new THREE.Vector3(0, .028, 0));
  } else if (kind === 'exercise-weight') {
    for (let side = 0; side < 2; side++) {
      const piece = part(); bars.push(bar(piece, navy, .022)); bars[side].rotation.z = Math.PI / 2; bars[side].scale.y = .22;
      for (const sign of [-1, 1]) { const weight = mesh(piece, new THREE.CylinderGeometry(.075, .075, .052, 16), mint, new THREE.Vector3(sign * .11, 0, 0)); weight.rotation.z = Math.PI / 2; }
    }
  } else if (kind === 'seating-surface') {
    seat = ellipsoid(body, mint, [.35, .11, .30]);
    const positions = seat.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) positions.setX(index, positions.getX(index) * cushionWidth(positions.getZ(index)));
    positions.needsUpdate = true; seat.geometry.computeVertexNormals();
  } else if (kind === 'walker') {
    // The source-grounded short-leg clips have wide, low grips. This rigid rollator
    // keeps one authored width and height rather than stretching with the hands.
    for (const side of [1, -1]) {
      const x = side * WALKER_HANDLE_HALF_WIDTH;
      const grip = mesh(body, new THREE.CylinderGeometry(.049, .049, 1, 24), navy); grip.name = `Doreumi_walker_grip_${side > 0 ? 'L' : 'R'}`;
      connect(grip, new THREE.Vector3(x, WALKER_HANDLE_HEIGHT, WALKER_GRIP_START), new THREE.Vector3(x, WALKER_HANDLE_HEIGHT, .13));
      const handleMount = bar(body, mint, .022); handleMount.name = 'Doreumi_walker_handle_mount';
      connect(handleMount, new THREE.Vector3(x, WALKER_HANDLE_HEIGHT, .13), new THREE.Vector3(x, WALKER_HANDLE_HEIGHT, .22));
      for (const z of [-.25, .43]) {
        const post = bar(body, mint, .022); post.name = 'Doreumi_walker_frame';
        connect(post, new THREE.Vector3(x, .17, z), new THREE.Vector3(x, z < 0 ? .38 : WALKER_HANDLE_HEIGHT, z < 0 ? .33 : .22));
        const caster = new THREE.Group(); caster.name = 'Doreumi_walker_caster'; caster.position.set(x, .085, z); body.add(caster);
        const spin = new THREE.Group(); spin.name = 'Doreumi_walker_wheel'; caster.add(spin);
        const tire = mesh(spin, new THREE.CylinderGeometry(.085, .085, .05, 24), navy); tire.rotation.z = Math.PI / 2;
        const hub = mesh(spin, new THREE.CylinderGeometry(.043, .043, .053, 16), cream); hub.rotation.z = Math.PI / 2;
        for (const sign of [-1, 1]) { const marker = box(spin, mint, [.002, .012, .050], new THREE.Vector3(sign * .027, 0, 0)); marker.rotation.x = .4; }
        walkerWheels.push({ caster, spin, previous: null, angle: 0 });
      }
      const sideBrace = bar(body, mint, .018); sideBrace.name = 'Doreumi_walker_lower_brace';
      connect(sideBrace, new THREE.Vector3(x, .25, -.225), new THREE.Vector3(x, .25, .382));
    }
    const front = bar(body, mint, .022); front.name = 'Doreumi_walker_front_brace';
    connect(front, new THREE.Vector3(-.613, .25, .382), new THREE.Vector3(.613, .25, .382));
  } else if (kind === 'torch') {
    mesh(body, new THREE.CylinderGeometry(.022, .022, .26, 12), wood, new THREE.Vector3(0, .09, 0));
    mesh(body, new THREE.CylinderGeometry(.075, .045, .085, 16), navy, new THREE.Vector3(0, .2475, 0));
    const flame = new THREE.Group(); flame.name = 'Doreumi_torch_flame'; body.add(flame);
    const orange = material(0xff7727); orange.emissive.setHex(0xff6413); orange.emissiveIntensity = .42;
    flameDrop(flame, orange, .37, .123, .82, .052);
    const gold = material(0xffd363); gold.emissive.setHex(0xffb735); gold.emissiveIntensity = .48;
    // The warm core is visible on either side of the bent, pointed silhouette.
    for (const sign of [-1, 1]) flameDrop(flame, gold, .23, .073, .26, .018, sign * .065);
  } else if (kind === 'cup') {
    mesh(body, new THREE.CylinderGeometry(.092, .072, .20, 24), cream);
    const rim = ring(body, mint, .085, .011); rim.rotation.x = Math.PI / 2; rim.position.y = .1;
    const tea = mesh(body, new THREE.CircleGeometry(.078, 24), material(0xb88155), new THREE.Vector3(0, .094, 0)); tea.rotation.x = -Math.PI / 2;
    const handle = ring(body, mint, .052, .013); handle.position.x = -.12;
    const leaf = ellipsoid(body, mint, [.035, .045, .005], new THREE.Vector3(0, .005, .076)); leaf.rotation.z = -.3;
    if (actionId === 343) seat = ellipsoid(root, mint.clone(), [.48, .07, .42]);
  } else if (kind === 'baseball' || kind === 'soccer-ball') {
    const radius = kind === 'baseball' ? .057 : .15;
    ellipsoid(body, cream, [radius, radius, radius]);
    if (kind === 'baseball') {
      for (const sign of [-1, 1]) { const seam = ring(body, rose, .042, .003); seam.position.z = sign * .038; }
    } else {
      const directions = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)];
      for (const direction of directions) { const patch = mesh(body, new THREE.CircleGeometry(.056, 5), navy, direction.clone().multiplyScalar(.149)); patch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); }
    }
  } else if (kind === 'fruit-basket') {
    const basket = part(); mesh(basket, new THREE.CylinderGeometry(.18, .14, .20, 24), wood);
    for (let i = 0; i < 3; i++) { const band = ring(basket, cream, .153 + i * .011, .006); band.rotation.x = Math.PI / 2; band.position.y = -.06 + i * .06; }
    bars.push(bar(root, wood, .013), bar(root, wood, .013));
    for (let i = 0; i < 3; i++) { const fruit = part(); ellipsoid(fruit, (i % 2 ? mint : rose).clone(), [.037, .037, .037]); const leaf = ellipsoid(fruit, mint.clone(), [.027, .008, .014], new THREE.Vector3(.018, .038, 0)); leaf.rotation.z = .4; }
    if (actionId === 278) {
      const planter = part(); mesh(planter, new THREE.CylinderGeometry(.16, .125, .19, 18), cream);
      const trunk = bar(planter, wood, .024); trunk.position.y = .38; trunk.scale.y = .7;
      for (let i = 0; i < 4; i++) ellipsoid(planter, mint, [.16, .12, .14], new THREE.Vector3((i % 2 ? -1 : 1) * .10, .47 + i * .05, (i - 1.5) * .065));
    }
  } else if (kind === 'radish') {
    const vegetable = part(); ellipsoid(vegetable, cream, [.075, .115, .075]);
    const tip = mesh(vegetable, new THREE.ConeGeometry(.035, .075, 12), cream, new THREE.Vector3(0, -.135, 0)); tip.rotation.z = Math.PI;
    const leaves = part(); for (let i = 0; i < 3; i++) { const leaf = ellipsoid(leaves, mint, [.025, .085, .014], new THREE.Vector3((i - 1) * .027, .02, 0)); leaf.rotation.z = (i - 1) * -.45; }
    const soil = part(); ellipsoid(soil, wood, [.15, .025, .14]);
  } else {
    // The low reach clips pick up a folded note; higher reaches use a small parcel.
    const gripHeight = event!.grip[1], height = Math.max(.008, gripHeight - .002);
    box(body, cream, [.14, height, .12]);
    box(body, mint, [.035, height + .002, .123]); box(body, mint, [.143, height + .002, .025]);
    if (actionId === 282) {
      const pouch = part(); box(pouch, mint.clone(), [.20, .16, .07]); box(pouch, cream.clone(), [.205, .028, .076], new THREE.Vector3(0, .065, 0));
    }
  }

  function update(input: PortableInput): { contacts: PortableContact[]; phase: PortablePhase } {
    const { time, floor, grips, bodyPosition, right, heading, opacity } = input;
    const contacts: PortableContact[] = [];
    alpha(body, opacity);
    let phase: PortablePhase = 'held';
    const contact = (side: number, actual = grips[side]) => contacts.push({ target: side ? 'palmR-skin' : 'palmL-skin', targetPoint: grips[side].clone(), propPoint: actual.clone() });
    const outward = (side: number) => { const direction = grips[side].clone().sub(bodyPosition); direction.y = 0; return direction.lengthSq() > .001 ? direction.normalize() : right.clone().multiplyScalar(side ? -1 : 1); };
    const outside = (center: THREE.Vector3, direction: THREE.Vector3, radius: number, halfHeight: number) => {
      let edge = bodyPosition.dot(direction);
      for (const point of input.bodyPoints) if (Math.abs(point.y - center.y) < halfHeight + .04) edge = Math.max(edge, point.dot(direction));
      return center.addScaledVector(direction, Math.max(0, edge + radius + .025 - center.dot(direction)));
    };
    if (kind === 'walker') {
      phase = 'supported';
      const center = grips[0].clone().add(grips[1]).multiplyScalar(.5);
      const across = grips[0].clone().sub(grips[1]); across.y = 0; across.normalize();
      const forward = across.clone().cross(UP).normalize();
      body.position.set(center.x, floor, center.z);
      body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, UP, forward));
      for (let side = 0; side < 2; side++) {
        const delta = grips[side].clone().sub(body.position);
        const localGrip = new THREE.Vector3(delta.dot(across), delta.y, delta.dot(forward));
        const axis = new THREE.Vector3((side ? -1 : 1) * WALKER_HANDLE_HALF_WIDTH, WALKER_HANDLE_HEIGHT, clamp(localGrip.z, WALKER_GRIP_START, .13));
        const radial = localGrip.clone().sub(axis); radial.z = 0;
        const surface = axis.addScaledVector(radial.normalize(), .049).applyQuaternion(body.quaternion).add(body.position);
        contact(side, surface);
      }
      for (const wheel of walkerWheels) {
        const position = wheel.caster.position.clone().applyQuaternion(body.quaternion).add(body.position);
        position.x += input.stagePosition?.[0] ?? 0; position.z += input.stagePosition?.[1] ?? 0;
        if (wheel.previous && previousWalkerTime !== null && time > previousWalkerTime) {
          const delta = position.clone().sub(wheel.previous), forwardDistance = delta.dot(forward), sideDistance = delta.dot(across);
          if (delta.lengthSq() > 1e-12) {
            // Swivelling wheels follow the measured ground path, including the
            // host travel, instead of skating under a hand-following frame.
            const rollingSign = forwardDistance < 0 ? -1 : 1;
            wheel.caster.rotation.y = Math.atan2(sideDistance * rollingSign, Math.abs(forwardDistance));
            wheel.angle += Math.hypot(forwardDistance, sideDistance) * rollingSign / .085;
          }
        } else wheel.angle = 0;
        wheel.spin.rotation.x = wheel.angle; wheel.previous = position;
      }
      previousWalkerTime = time;
    } else if (kind === 'jump-rope') {
      const ends = grips.map((grip, side) => {
        const outward = right.clone().multiplyScalar(side ? -1 : 1);
        const extent = Math.max(grip.dot(outward), ...(input.handPoints?.[side] ?? []).map(point => point.dot(outward)));
        return grip.clone().addScaledVector(outward, Math.max(.10, extent - grip.dot(outward) + .06));
      });
      for (let side = 0; side < 2; side++) { connect(bars[side], grips[side], ends[side]); contact(side); }
      // Eight turns match the eight visible two-foot jumps. Slack bends at the
      // floor instead of sending a rigid circular rope through it.
      const sourceTime = time - input.entry, jumpPeaks = JUMP_ROPE_SOURCE_PEAKS;
      let cycle = jumpPeaks.findIndex(value => value > sourceTime); if (cycle < 0) cycle = jumpPeaks.length;
      const before = jumpPeaks[cycle - 1] ?? jumpPeaks[0] - 31 / 30, after = jumpPeaks[cycle] ?? jumpPeaks.at(-1)! + 1.1;
      const angle = Math.PI + 2 * Math.PI * (sourceTime - before) / (after - before);
      const positions = ropeGeometry!.getAttribute('position'), centers: THREE.Vector3[] = [];
      const collisionSurface = [...input.bodyPoints, ...(input.handPoints?.flat() ?? [])];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, bulge = Math.sin(Math.PI * t), value = ends[0].clone().lerp(ends[1], t);
        value.addScaledVector(heading, bulge * Math.sin(angle) * 1.08);
        value.y = Math.max(floor + .014, value.y + bulge * Math.cos(angle) * 1.52);
        if (i > 0 && i < 48) {
          const direction = value.clone().sub(bodyPosition); direction.y = 0;
          if (direction.lengthSq() < .001) direction.copy(heading).multiplyScalar(Math.sin(angle) >= 0 ? 1 : -1);
          direction.normalize();
          let envelope = -Infinity;
          for (const point of collisionSurface) if (Math.abs(point.y - value.y) < .085) envelope = Math.max(envelope, point.dot(direction));
          if (Number.isFinite(envelope)) value.addScaledVector(direction, Math.max(0, envelope + .075 - value.dot(direction)));
        }
        centers.push(value);
      }
      for (let i = 0; i <= 48; i++) {
        const tangent = centers[Math.min(48, i + 1)].clone().sub(centers[Math.max(0, i - 1)]).normalize();
        const normal = tangent.clone().cross(Math.abs(tangent.y) < .95 ? UP : heading).normalize(), binormal = tangent.clone().cross(normal).normalize();
        for (let j = 0; j < 6; j++) { const value = centers[i].clone().addScaledVector(normal, Math.cos(j / 6 * Math.PI * 2) * .011).addScaledVector(binormal, Math.sin(j / 6 * Math.PI * 2) * .011); positions.setXYZ(i * 6 + j, value.x, value.y, value.z); }
      }
      positions.needsUpdate = true; ropeGeometry!.computeVertexNormals(); ropeGeometry!.computeBoundingBox(); ropeGeometry!.computeBoundingSphere();
    } else if (kind === 'mirror') {
      phase = 'supported';
      const center = new THREE.Vector3(-.95, floor + .91, 1.4), toward = new THREE.Vector3(.95, 0, -1.4).normalize();
      body.position.copy(center); body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toward);
      connect(bars[0], new THREE.Vector3(center.x, floor + .03, center.z), center.clone().addScaledVector(UP, -.53));
      const base = root.children.find(child => child instanceof THREE.Mesh && child !== bars[0])!; base.position.set(center.x, floor + .028, center.z);
    } else if (kind === 'exercise-weight') {
      pieces.forEach((piece, side) => { piece.position.copy(grips[side]); piece.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), heading); contact(side); });
    } else if (kind === 'torch') {
      // All seven original clips raise the left hand in front of the torso;
      // the right hand remains the free balancing hand in the source skeleton.
      const direction = outward(0), axis = direction.clone().add(UP).normalize();
      const normal = direction.clone().addScaledVector(axis, -direction.dot(axis)).normalize();
      body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal, axis, normal.clone().cross(axis)));
      body.position.copy(grips[0]).addScaledVector(normal, .022);
      contacts.push({ target: 'palmL-skin', targetPoint: grips[0].clone(), propPoint: new THREE.Vector3(-.022, 0, 0).applyQuaternion(body.quaternion).add(body.position) });
    } else if (kind === 'seating-surface') {
      // A fixed floor cushion stays behind the feet when 299 stands up. Its
      // small vertical compression follows the measured butt surface only
      // while loaded; it never follows the standing pelvis through the air.
      const center = new THREE.Vector3(0, floor + .117, -.175);
      let support: THREE.Vector3 | undefined;
      let halfHeight = .11;
      for (const point of input.buttPoints ?? (input.buttPoint ? [input.buttPoint] : [])) {
        const depth = (point.z - center.z) / .30;
        const radial = (point.x / (.35 * cushionWidth(depth))) ** 2 + depth ** 2;
        if (radial >= 1) continue;
        const available = (point.y - floor - .016) / (1 + Math.sqrt(1 - radial));
        if (available < halfHeight) { halfHeight = Math.max(.008, available); support = point; }
      }
      if (support) {
        const depth = (support.z - center.z) / .30;
        const radial = ((support.x - center.x) / (.35 * cushionWidth(depth))) ** 2 + depth ** 2;
        const crown = Math.sqrt(Math.max(0, 1 - radial));
        const surface = floor + .007 + halfHeight * (1 + crown);
        const gap = support.y - surface;
        if (radial < 1 && gap >= -.001 && gap <= .018) {
          contacts.push({ target: 'butt-skin', targetPoint: support.clone(), propPoint: new THREE.Vector3(support.x, surface, support.z) });
          phase = 'supported';
        } else phase = 'ground';
      } else phase = 'ground';
      seat!.position.copy(center); seat!.position.y = floor + .007 + halfHeight; seat!.scale.set(.35, halfHeight, .30);
    } else if (kind === 'cup') {
      const side = actionId === 343 ? 1 : 0, sip = cupSipWeight(actionId, time - input.entry);
      body.quaternion.copy(cupOrientation(right, heading, sip, side));
      body.position.copy(grips[side]).sub(cupGripLocal().applyQuaternion(body.quaternion));
      if (sip >= .98 && input.mouthPoint) contacts.push({ target: 'mouth', targetPoint: input.mouthPoint.clone(),
        propPoint: cupRimLocal(side).applyQuaternion(body.quaternion).add(body.position) });
      contact(side);
      if (seat) {
        alpha(seat, opacity * smooth((time - input.entry * .72) / .20));
        const support = input.buttPoint;
        if (support) { const height = Math.max(.012, (support.y - floor - .012) / 2); seat.position.copy(support).addScaledVector(UP, -height - .009); seat.scale.set(.48, height, .42); contacts.push({ target: 'butt-skin', targetPoint: support.clone(), propPoint: support.clone().addScaledVector(UP, -.009) }); }
      }
    } else if (kind === 'baseball') {
      const release = event!.release!, radius = .057;
      if (time < release) { const direction = outward(1); body.position.copy(grips[1]).addScaledVector(direction, radius); contact(1); }
      else { phase = 'released'; const t = time - release, direction = vec(event!.velocity!).normalize(); body.position.copy(vec(event!.releaseGrip!)).addScaledVector(direction, radius + Math.min(.9, t * 2.8)); body.position.y = Math.max(floor + radius, body.position.y + .32 * t - 1.7 * t * t); alpha(body, opacity * (1 - smooth((t - .24) / .18))); }
    } else if (kind === 'soccer-ball') {
      const strike = 1.2, radius = .15, skin = new THREE.Vector3(-.3227250291, floor + .1610934194, .2797401704), t = Math.max(0, time - strike);
      body.position.copy(skin).addScaledVector(new THREE.Vector3(0, 0, 1), radius + Math.min(1.08, t * 2.0)); body.position.y = floor + radius + .011 + Math.max(0, .25 * t - .9 * t * t);
      body.rotation.x = t * 12; phase = time < strike ? 'ground' : 'released';
      if (Math.abs(time - strike) < 1 / 60) contacts.push({ target: 'footR-skin-14287', targetPoint: skin, propPoint: body.position.clone().addScaledVector(new THREE.Vector3(0, 0, 1), -radius) });
      alpha(body, opacity * (1 - smooth((t - .40) / .18)));
    } else if (kind === 'fruit-basket') {
      const basket = pieces[0], direction = outward(0), center = grips[0].clone().addScaledVector(UP, -.22).addScaledVector(direction, .06);
      center.y = Math.max(floor + .105, center.y); outside(center, direction, .18, .10); basket.position.copy(center);
      for (let side = 0; side < 2; side++) connect(bars[side], grips[0], center.clone().addScaledVector(heading, side ? -.16 : .16).addScaledVector(UP, .10));
      contact(0);
      fruitEvents.forEach((cue, i) => {
        const fruit = pieces[i + 1], stored = center.clone().addScaledVector(right, (i - 1) * .062).addScaledVector(UP, .09);
        if (time < cue.grab) fruit.position.copy(vec(cue.grip)).addScaledVector(UP, .04);
        else if (time < cue.release) { fruit.position.copy(grips[1]).addScaledVector(UP, .037); contact(1); }
        else { const t = smooth((time - cue.release) / .36); fruit.position.copy(grips[1]).addScaledVector(UP, .037).lerp(stored, t); fruit.position.y += Math.sin(t * Math.PI) * .14; }
        fruit.position.y = Math.max(floor + .038, fruit.position.y);
      });
      if (actionId === 278) pieces[4].position.set(-.56, floor + .10, .64);
    } else if (kind === 'radish') {
      const target = time < event!.grab ? vec(event!.grip) : grips[1], vegetable = pieces[0], leaves = pieces[1], soil = pieces[2];
      leaves.position.copy(target).addScaledVector(UP, -.03); soil.position.set(event!.grip[0], floor + .025, event!.grip[2]);
      const exposed = clamp((target.y - floor - .082) / .293, 0, 1); vegetable.scale.y = exposed;
      vegetable.position.copy(target).addScaledVector(UP, -.08 - .12 * exposed); vegetable.visible = exposed > .001;
      phase = time < event!.grab ? 'ground' : 'held'; if (phase === 'held') contact(1);
    } else {
      const height = Math.max(.008, event!.grip[1] - .002), held = time >= event!.grab;
      const target = held ? grips[event!.side].clone() : vec(event!.grip); phase = held ? 'held' : 'ground';
      body.position.copy(target).addScaledVector(UP, -height / 2); body.quaternion.identity(); body.scale.setScalar(1);
      if (held && (!event!.release || time < event!.release)) contact(event!.side);
      if (event!.release && time >= event!.release) {
        const t = time - event!.release, releasePoint = vec(event!.releaseGrip!); phase = actionId === 282 ? 'contained' : 'released';
        if (actionId === 280) body.position.copy(releasePoint).addScaledVector(vec(event!.velocity!).normalize(), Math.min(1.0, t * 2.5)).addScaledVector(UP, -height / 2 - t * t);
        else if (actionId === 274) { body.position.copy(releasePoint).addScaledVector(UP, -height / 2 - 1.7 * t * t); }
        else body.position.copy(releasePoint).addScaledVector(UP, -height / 2 - smooth(t / .25) * .06);
        body.position.y = Math.max(floor + height / 2 + .002, body.position.y);
        alpha(body, opacity * (1 - smooth(t / (actionId === 282 ? .25 : .8))));
      }
      if (actionId === 282) {
        const pouch = pieces[0], direction = outward(1), center = bodyPosition.clone().addScaledVector(direction, .46); center.y = Math.max(floor + .1, bodyPosition.y + .02);
        outside(center, direction, .05, .08); pouch.position.copy(center); pouch.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, UP, heading));
      }
    }
    root.updateMatrixWorld(true); return { contacts, phase };
  }
  const reset = () => { previousWalkerTime = null; for (const wheel of walkerWheels) { wheel.previous = null; wheel.angle = 0; wheel.spin.rotation.x = 0; wheel.caster.rotation.y = 0; } };
  return { root, update, reset, frame: kind === 'jump-rope' ? { halfHeight: 1.8, centerY: 1.28 } : kind === 'mirror' ? { halfHeight: 2.1, centerY: 1.08 } : { halfHeight: 1.7, centerY: 1.1 } };
}
