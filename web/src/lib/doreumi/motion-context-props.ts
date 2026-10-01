import { PHONE_PALM_CONTACTS } from '@/lib/doreumi/motion-phone-contact';
import * as THREE from 'three';
import { contextPropsSupport, DOREUMI_CONTEXT_ACTIONS, type DoreumiContextMotion, type DoreumiContextProp } from '@/lib/doreumi/motion-context-capabilities';
import { createPortableContextProp, JUMP_ROPE_SOURCE_PEAKS, PORTABLE_KINDS, type PortableKind } from '@/lib/doreumi/motion-portable-props';
import { sampleDoreumiTravel } from '@/lib/doreumi/motion-travel';
import { CUP_MOUTH } from '@/lib/doreumi/motion-cup-contact';
import { createSkinProbeReader } from '@/lib/doreumi/motion-skin-probes';
import { createDoreumiEnvironmentProp } from '@/lib/doreumi/motion-environment-props';
import { parseDoreumiEnvironment, type DoreumiLowLedge } from '@/lib/doreumi/motion-environment-contract';
export { contextPropsSupport, DOREUMI_CONTEXT_ACTIONS, type DoreumiContextMotion, type DoreumiContextProp } from '@/lib/doreumi/motion-context-capabilities';

type Point = [number, number, number];
type Frame = { halfHeight: number; centerY: number };
type Contact = { target: string; targetPoint: Point; propPoint: Point; distance: number; socketDistance?: number };

export type DoreumiContextInspection = {
  actionId: number | null; kind: DoreumiContextProp | null; supported: boolean;
  exclusionReason: string | null; visible: boolean; opacity: number; contacts: Contact[];
  handSpan: number | null; bounds: { min: Point; max: Point } | null;
  floorClearance: number | null; frame: Frame | null; finite: boolean;
  interactionPhase: 'ground' | 'held' | 'supported' | 'released' | 'contained' | null;
  contactBasis: 'deformed-master-skin'; bodyClearanceBasis: 'sampled-skin-with-padding';
};

type Probe = { mesh: THREE.SkinnedMesh; index: number };
type SurfaceProbe = Probe & { point: THREE.Vector3 };
type BuiltProp = {
  root: THREE.Group; body: THREE.Group; bars: THREE.Mesh[]; contactNodes: THREE.Object3D[];
  seat?: THREE.Mesh; seatColumns?: number; seatRows?: number; seatWidth?: number; seatDepth?: number;
  pieces?: THREE.Group[]; canopy?: THREE.Group;
  portable?: ReturnType<typeof createPortableContextProp>;
  environment?: ReturnType<typeof createDoreumiEnvironmentProp>; environmentConfig?: DoreumiLowLedge;
};
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const ease = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const xyz = (value: THREE.Vector3): Point => [value.x, value.y, value.z];

function box(parent: THREE.Object3D, size: Point, position: Point, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position); parent.add(mesh); return mesh;
}
function sphere(parent: THREE.Object3D, radius: number, position: Point, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), material);
  mesh.position.set(...position); parent.add(mesh); return mesh;
}
function bar(parent: THREE.Object3D, radius: number, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), material);
  parent.add(mesh); return mesh;
}
function between(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const delta = b.clone().sub(a), length = delta.length();
  mesh.visible = length > 1e-5; mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.set(1, Math.max(length, 1e-5), 1);
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
}
function disposeMeshes(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}

/** All meshes are local and procedural. No source GLB, network request, or donor skin is used. */
function buildProp(kind: DoreumiContextProp, lounge: boolean, collect: boolean, actionId: number, environmentConfig?: DoreumiLowLedge): BuiltProp {
  if (kind === 'climbing-surface') {
    if (!environmentConfig) throw new Error('A climbing surface requires measured clip metadata');
    const environment = createDoreumiEnvironmentProp(environmentConfig);
    return { root: environment.root, body: new THREE.Group(), bars: [], contactNodes: [], environment, environmentConfig };
  }
  if (PORTABLE_KINDS.has(kind)) {
    const portable = createPortableContextProp(kind as PortableKind, actionId);
    return { root: portable.root, body: new THREE.Group(), bars: [], contactNodes: [], portable };
  }
  const root = new THREE.Group(), body = new THREE.Group(); root.name = `Doreumi_context_${kind}`; root.add(body);
  const surface = (color: number, roughness = .72) => new THREE.MeshStandardMaterial({ color, roughness });
  const navy = surface(0x414967), mint = surface(0x8cbbb1), cream = surface(0xfff0cf);
  const wood = surface(0xbc9b76), steel = surface(0x88919c, .4);
  const result: BuiltProp = { root, body, bars: [], contactNodes: [] };
  const contacts = (count: number) => { for (let i = 0; i < count; i++) { const node = new THREE.Object3D(); node.name = `grip-${i}`; root.add(node); result.contactNodes.push(node); } };
  if (kind === 'phone') {
    box(body, [.15, .25, .035], [0, .02, 0], navy);
    box(body, [.124, .196, .003], [0, .026, .019], mint);
    box(body, [.064, .009, .004], [0, .088, .022], cream);
    for (let row = 0; row < 3; row++) box(body, [.077 - row * .012, .012, .004], [0, .048 - row * .028, .022], cream);
    sphere(body, .009, [0, -.09, .019], cream); contacts(1);
  } else if (kind === 'umbrella') {
    const canopy = new THREE.Group(); result.canopy = canopy; root.add(canopy);
    const radius = 1.02, height = .47;
    for (let i = 0; i < 8; i++) {
      const material = i % 2 ? mint : cream; material.side = THREE.DoubleSide;
      const radialSegments = 12, arcSegments = 6, positions: number[] = [], indices: number[] = [];
      for (let row = 0; row <= radialSegments; row++) for (let column = 0; column <= arcSegments; column++) {
        const t = row / radialSegments, angle = (i + column / arcSegments) * Math.PI / 4;
        const scallop = 1 - .025 * Math.sin(column / arcSegments * Math.PI) * t ** 8;
        positions.push(Math.sin(angle) * radius * t * scallop, height * (.5 - t * t), Math.cos(angle) * radius * t * scallop);
        if (row < radialSegments && column < arcSegments) { const a = row * (arcSegments + 1) + column, b = a + 1, c = a + arcSegments + 1; indices.push(a, b, c, b, c + 1, c); }
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      canopy.add(new THREE.Mesh(geometry, material));
      const angle = i * Math.PI / 4;
      const path = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, step) => { const t = step / 8; return new THREE.Vector3(Math.sin(angle) * radius * t, height * (.5 - t * t) - .003, Math.cos(angle) * radius * t); }));
      canopy.add(new THREE.Mesh(new THREE.TubeGeometry(path, 16, .006, 5, false), steel));
    }
    sphere(canopy, .033, [0, height / 2 + .018, 0], navy);
    for (let i = 0; i < 3; i++) result.bars.push(bar(root, .018, wood));
    contacts(1);
  } else if (kind === 'chair') {
    const columns = 36, rows = lounge ? 48 : 24, width = 1.12, depth = lounge ? 1.9 : .66;
    const vertices = (columns + 1) * (rows + 1), positions = new Float32Array(vertices * 2 * 3), indices: number[] = [];
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const index = row * (columns + 1) + column, x = (column / columns - .5) * width, z = (row / rows - .5) * depth;
      positions.set([x, .1, z], index * 3); positions.set([x, .001, z], (index + vertices) * 3);
      if (row < rows && column < columns) {
        const a = index, b = a + 1, c = a + columns + 1, d = c + 1;
        indices.push(a, c, b, b, c, d, a + vertices, b + vertices, c + vertices, b + vertices, d + vertices, c + vertices);
      }
    }
    const perimeter: number[] = [];
    for (let x = 0; x <= columns; x++) perimeter.push(x);
    for (let z = 1; z <= rows; z++) perimeter.push(z * (columns + 1) + columns);
    for (let x = columns - 1; x >= 0; x--) perimeter.push(rows * (columns + 1) + x);
    for (let z = rows - 1; z > 0; z--) perimeter.push(z * (columns + 1));
    perimeter.forEach((a, i) => { const b = perimeter[(i + 1) % perimeter.length]; indices.push(a, b, a + vertices, b, b + vertices, a + vertices); });
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const seat = new THREE.Mesh(geometry, mint); body.add(seat);
    Object.assign(result, { seat, seatColumns: columns, seatRows: rows, seatWidth: width, seatDepth: depth });
    for (const side of [-1, 1]) {
      box(body, [.048, .06, depth + .12], [side * .615, .05, 0], wood);
      if (!lounge) {
        const upright = bar(body, .024, wood);
        between(upright, new THREE.Vector3(side * .615, .04, -.34), new THREE.Vector3(side * .615, .56, -.58));
      } else {
        const backRail = bar(body, .024, wood);
        between(backRail, new THREE.Vector3(side * .615, .06, -.1), new THREE.Vector3(side * .615, .45, -.94));
      }
    }
    if (!lounge) box(body, [1.2, .25, .045], [0, .47, -.54], cream);
    contacts(1);
  } else if (kind === 'kettlebell') {
    const bell = sphere(body, .23, [0, 0, 0], mint); bell.scale.set(1.05, 1.05, .9);
    box(body, [.24, .025, .22], [0, -.215, 0], navy);
    const badge = sphere(body, .04, [0, .03, .212], cream); badge.scale.z = .18;
    for (let i = 0; i < 3; i++) result.bars.push(bar(root, .026, navy));
    contacts(2);
  } else if (kind === 'carried-object') {
    if (collect) {
      box(body, [.19, .20, .18], [0, 0, 0], cream);
      box(body, [.028, .205, .186], [0, 0, 0], mint);
      box(body, [.196, .205, .028], [0, 0, 0], mint);
      for (const side of [-1, 1]) { const bow = sphere(body, .035, [side * .026, .125, 0], mint); bow.scale.y = .6; }
      result.bars.push(bar(root, .013, wood)); contacts(1);
    } else {
      box(body, [1, .3, .34], [0, 0, 0], cream);
      for (const side of [-1, 1]) box(body, [.044, .33, .37], [side * .36, 0, 0], mint);
      box(body, [1.035, .037, .37], [0, .145, 0], wood);
      const bow = sphere(body, .057, [0, .075, .177], mint); bow.scale.set(1.3, .7, .16);
      for (let i = 0; i < 4; i++) result.bars.push(bar(root, .024, wood));
      contacts(2);
    }
  } else {
    // The two-bucket gait carries one pail in each hand. A bag uses the same gravity-oriented handle.
    const count = kind === 'bucket' ? 2 : 1; result.pieces = [];
    for (let i = 0; i < count; i++) {
      const piece = new THREE.Group(); root.add(piece); result.pieces.push(piece);
      if (kind === 'bucket') {
        const pail = new THREE.Mesh(new THREE.CylinderGeometry(.14, .108, .23, 18, 1, true), mint); piece.add(pail);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(.139, .013, 7, 20), cream); rim.rotation.x = Math.PI / 2; rim.position.y = .115; piece.add(rim);
        const water = new THREE.Mesh(new THREE.CircleGeometry(.128, 20), surface(0x9dcee0)); water.rotation.x = -Math.PI / 2; water.position.y = .087; piece.add(water);
        box(piece, [.16, .013, .16], [0, -.117, 0], navy);
      } else {
        box(piece, [.24, .26, .12], [0, 0, 0], cream);
        box(piece, [.25, .04, .13], [0, .12, 0], mint);
        box(piece, [.09, .012, .004], [0, .02, .064], mint);
      }
      result.bars.push(bar(root, .013, steel), bar(root, .013, steel));
    }
    contacts(count);
  }
  // Unused palette materials are not attached to a mesh and have no GPU allocation.
  return result;
}

function findProbes(model: THREE.Object3D, palms: [THREE.Object3D, THREE.Object3D]) {
  const hands: [Probe[], Probe[]] = [[], []], body: Probe[] = [], chair: Probe[] = [], butt: Probe[] = [], buttCenter: Probe[] = [];
  const handSurfaces: [Probe[], Probe[]] = [[], []], seenHands = [new Set<string>(), new Set<string>()];
  let mouth: Probe | undefined;
  const seenBody = new Set<string>(), seenChair = new Set<string>(), seenButt = new Set<string>();
  const palmPoints = palms.map(palm => palm.getWorldPosition(new THREE.Vector3()));
  const point = new THREE.Vector3();
  model.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh) || object.name === 'DoreumiGarment') return;
    object.skeleton.update();
    const positions = object.geometry.getAttribute('position'), indices = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
    if (!positions || !indices || !weights) return;
    if (object.name === 'Doreumi' && positions.count > CUP_MOUTH.vertex) mouth = { mesh: object, index: CUP_MOUTH.vertex };
    for (let index = 0; index < positions.count; index++) {
      const names = new Map<string, number>();
      for (let c = 0; c < 4; c++) { const bone = object.skeleton.bones[indices.getComponent(index, c)]; if (bone) names.set(bone.name, (names.get(bone.name) ?? 0) + weights.getComponent(index, c)); }
      object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld);
      const probe = { mesh: object, index }, x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
      for (let side = 0; side < 2; side++) {
        const weight = names.get(side ? 'wristR' : 'wristL') ?? 0;
        if (weight > .35 && point.distanceToSquared(palmPoints[side]) < .026) hands[side].push(probe);
        const key = [x, y, z].map(value => Math.round(value / .025)).join(',');
        if (weight > .55 && !seenHands[side].has(key)) { seenHands[side].add(key); handSurfaces[side].push(probe); }
      }
      if (['body', 'torso', 'head'].reduce((sum, name) => sum + (names.get(name) ?? 0), 0) > .55) {
        const key = [x, y, z].map(value => Math.round(value / .07)).join(',');
        if (!seenBody.has(key)) { seenBody.add(key); body.push(probe); }
      }
      // Dense, deduplicated skin support keeps the cushion below the actual legs and reclining head.
      const key = [x, y, z].map(value => Math.round(value / .006)).join(',');
      if (!seenChair.has(key)) { seenChair.add(key); chair.push(probe); }
      if (Math.abs(x) < .14 && y < -.62 && z < .1 && (names.get('body') ?? 0) > .6 && !seenButt.has(key)) { seenButt.add(key); butt.push(probe); }
      if (Math.abs(x) < .035 && y < -.62 && z < 0 && (names.get('body') ?? 0) > .6) buttCenter.push(probe);
    }
  });
  for (let side = 0; side < 2; side++) {
    const outward = new THREE.Vector3(side ? -1 : 1, 0, 0).transformDirection(model.matrixWorld);
    let best: Probe | undefined, bestScore = -Infinity;
    for (const probe of hands[side]) {
      probe.mesh.getVertexPosition(probe.index, point).applyMatrix4(probe.mesh.matrixWorld);
      point.sub(palmPoints[side]); const distance = point.length();
      const score = distance <= .08 ? point.dot(outward) - distance * .8 : -distance - 1;
      if (score > bestScore) { bestScore = score; best = probe; }
    }
    // A fixed material point prevents a phone from hopping between vertices as a wrist turns.
    hands[side] = best ? [best] : [];
  }
  return { hands, handSurfaces, body, chair, butt, buttCenter, mouth };
}

/**
 * Call update after the mixer and holder transform update. The controller never writes to
 * the model, skeleton, source clip, or registry. Contact points are deformed mesh vertices.
 */
export function createDoreumiContextProps({ model, parent }: { model: THREE.Object3D; parent: THREE.Object3D }) {
  const root = new THREE.Group(); root.name = 'Doreumi_context_props'; parent.add(root);
  const palms = [model.getObjectByName('palmL'), model.getObjectByName('palmR')] as const;
  const bodyBone = model.getObjectByName('body');
  const wrists = [model.getObjectByName('wristL'), model.getObjectByName('wristR')] as const;
  const environmentMesh = model.getObjectByName('Doreumi');
  const missing = !palms[0] || !palms[1] || !bodyBone;
  model.updateWorldMatrix(true, true);
  const probes = missing ? null : findProbes(model, palms as [THREE.Object3D, THREE.Object3D]);
  const phoneMesh = environmentMesh instanceof THREE.SkinnedMesh ? environmentMesh : null;
  const phoneProbes = PHONE_PALM_CONTACTS.map(contact => phoneMesh && phoneMesh.geometry.getAttribute('position')?.count > contact.vertex
    && (phoneMesh.geometry.getAttribute('normal')?.count ?? 0) > contact.vertex ? { mesh: phoneMesh, index: contact.vertex } : null);
  const phoneNormals = phoneProbes.map(probe => probe ? new THREE.Vector3().fromBufferAttribute(probe.mesh.geometry.getAttribute('normal'), probe.index).normalize() : null);
  const cache = new Map<string, BuiltProp>();
  let active: BuiltProp | null = null, kind: DoreumiContextProp | null = null, motion: DoreumiContextMotion | null = null;
  let exclusionReason: string | null = null, disposed = false, opacity = 0, contacts: Contact[] = [];
  let handSpan: number | null = null, interactionPhase: DoreumiContextInspection['interactionPhase'] = null;
  const parentInverse = new THREE.Matrix4(), parentQuaternion = new THREE.Quaternion(), bodyQuaternion = new THREE.Quaternion();
  const heading = new THREE.Vector3(0, 0, 1), right = new THREE.Vector3(1, 0, 0), bodyPosition = new THREE.Vector3();
  const palmPositions = [new THREE.Vector3(), new THREE.Vector3()];
  const skinPoints: SurfaceProbe[] = probes?.body.map(probe => ({ ...probe, point: new THREE.Vector3() })) ?? [];
  const skeletons = new Set(probes?.body.map(probe => probe.mesh.skeleton));
  const chairSkin = createSkinProbeReader([...new Set(probes?.chair.map(probe => probe.mesh) ?? [])]);
  const floorPoint = new THREE.Vector3();
  const point = new THREE.Vector3();
  const local = (node: THREE.Object3D, target: THREE.Vector3) => node.getWorldPosition(target).applyMatrix4(parentInverse);
  const readProbe = (probe: Probe, target: THREE.Vector3) => (kind === 'chair'
    ? chairSkin.read(probe.mesh, probe.index, target)
    : probe.mesh.getVertexPosition(probe.index, target)).applyMatrix4(probe.mesh.matrixWorld).applyMatrix4(parentInverse);
  const frame = (): Frame | null => active?.environment ? active.environment.frame : active?.portable ? active.portable.frame : kind === 'umbrella' ? { halfHeight: 1.7, centerY: 1.36 }
    : kind === 'chair' && motion?.sourceActionId === 272 ? { halfHeight: 1.8, centerY: 1.05 }
      : kind ? { halfHeight: 1.55, centerY: 1.08 } : null;

  function setMotion(next: DoreumiContextMotion | null) {
    if (disposed) return;
    motion = next; active = null; kind = null; contacts = []; opacity = 0; handSpan = null; interactionPhase = null;
    cache.forEach(prop => { prop.root.visible = false; });
    const requested = next?.props?.length ? [...new Set(next.props)] : next
      ? Object.entries(DOREUMI_CONTEXT_ACTIONS).filter(([, ids]) => ids.includes(next.sourceActionId)).map(([prop]) => prop) : [];
    const environment = next ? parseDoreumiEnvironment(next.environmentSupport, next.sourceActionId) : null;
    const support = contextPropsSupport(requested, next?.sourceActionId, environment ?? undefined);
    exclusionReason = missing || (requested.includes('phone') && (!wrists[0] || !wrists[1] || phoneProbes.some(probe => !probe))) ? 'missing-master-contact-sockets' : support.reason;
    if (!next || !requested.length || exclusionReason) return;
    kind = (requested.find(prop => prop !== 'seating-surface') ?? requested[0]) as DoreumiContextProp;
    const key = `${kind}:${environment ? JSON.stringify(environment) : PORTABLE_KINDS.has(kind) ? next.sourceActionId : next.sourceActionId === 272 ? 'lounge' : next.sourceActionId === 284 ? 'collect' : 'standard'}`;
    active = cache.get(key) ?? buildProp(kind, next.sourceActionId === 272, next.sourceActionId === 284, next.sourceActionId, environment ?? undefined);
    active.portable?.reset();
    if (!cache.has(key)) { cache.set(key, active); root.add(active.root); }
    active.root.visible = false;
  }

  function grip(side: number) {
    const probe = probes!.hands[side][0];
    return probe ? readProbe(probe, new THREE.Vector3()) : palmPositions[side].clone();
  }
  function recordGrip(side: number, target: THREE.Vector3, contactIndex: number, propPoint = target) {
    const node = active!.contactNodes[contactIndex]; node.position.copy(propPoint);
    const worldTarget = target.clone().applyMatrix4(parent.matrixWorld);
    const actual = node.getWorldPosition(new THREE.Vector3());
    contacts.push({ target: side ? 'palmR-skin' : 'palmL-skin', targetPoint: xyz(worldTarget), propPoint: xyz(actual), distance: actual.distanceTo(worldTarget), socketDistance: target.distanceTo(palmPositions[side]) });
  }
  function bodyExtent(direction: THREE.Vector3, minimumY: number, maximumY: number) {
    let maximum = bodyPosition.dot(direction);
    for (const { point } of skinPoints) if (point.y >= minimumY - .09 && point.y <= maximumY + .09) maximum = Math.max(maximum, point.dot(direction));
    return maximum + .08;
  }
  function updateChair(floor: number) {
    const prop = active!, lounge = motion!.sourceActionId === 272, rows = prop.seatRows!, columns = prop.seatColumns!;
    const width = prop.seatWidth!, depth = prop.seatDepth!, count = (rows + 1) * (columns + 1);
    const seatCenter = bodyPosition.clone().addScaledVector(heading, lounge ? -.43 : -.1); seatCenter.y = 0;
    prop.body.position.copy(seatCenter); prop.body.quaternion.setFromAxisAngle(UP, Math.atan2(heading.x, heading.z));
    const heights = new Float64Array(count).fill(Infinity);
    const collect = (value: THREE.Vector3) => {
      const dx = value.x - seatCenter.x, dz = value.z - seatCenter.z;
      const x = dx * right.x + dz * right.z, z = dx * heading.x + dz * heading.z;
      const column = Math.floor((x / width + .5) * columns), row = Math.floor((z / depth + .5) * rows);
      if (column < 0 || column >= columns || row < 0 || row >= rows) return;
      const y = Math.max(floor + .0015, value.y - .009);
      const index = row * (columns + 1) + column;
      heights[index] = Math.min(heights[index], y); heights[index + 1] = Math.min(heights[index + 1], y);
      heights[index + columns + 1] = Math.min(heights[index + columns + 1], y); heights[index + columns + 2] = Math.min(heights[index + columns + 2], y);
    };
    for (const probe of probes!.chair) collect(readProbe(probe, point));
    if (lounge) {
      // A connected cushion uses the skin as an upper bound. Independent column
      // heights left sharp ridges at gaps between sampled body vertices.
      const ceiling = Float64Array.from(heights, value => Math.min(floor + .64, value));
      for (let index = 0; index < count; index++) heights[index] = ceiling[index];
      const xStep = width / columns * .8, zStep = depth / rows * .8;
      for (let pass = 0; pass < 2; pass++) {
        for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
          const index = row * (columns + 1) + column;
          if (column) heights[index] = Math.min(heights[index], heights[index - 1] + xStep);
          if (row) heights[index] = Math.min(heights[index], heights[index - columns - 1] + zStep);
        }
        for (let row = rows; row >= 0; row--) for (let column = columns; column >= 0; column--) {
          const index = row * (columns + 1) + column;
          if (column < columns) heights[index] = Math.min(heights[index], heights[index + 1] + xStep);
          if (row < rows) heights[index] = Math.min(heights[index], heights[index + columns + 1] + zStep);
        }
      }
      for (let pass = 0; pass < 3; pass++) {
        const previous = heights.slice();
        for (let row = 1; row < rows; row++) for (let column = 1; column < columns; column++) {
          const index = row * (columns + 1) + column;
          heights[index] = Math.min(ceiling[index], (previous[index] * 4 + previous[index - 1] + previous[index + 1] + previous[index - columns - 1] + previous[index + columns + 1]) / 8);
        }
      }
      for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
        const index = row * (columns + 1) + column;
        const edge = Math.min(column * width / columns, (columns - column) * width / columns, row * depth / rows, (rows - row) * depth / rows);
        heights[index] = floor + .002 + Math.max(0, heights[index] - floor - .002) * ease(edge / .085);
      }
    } else for (let index = 0; index < count; index++) heights[index] = Number.isFinite(heights[index])
      ? Math.min(floor + .3, heights[index]) : floor + .12;
    const position = prop.seat!.geometry.getAttribute('position');
    for (let index = 0; index < count; index++) { position.setY(index, heights[index]); position.setY(index + count, floor + .001); }
    position.needsUpdate = true; prop.seat!.geometry.computeVertexNormals(); prop.seat!.geometry.computeBoundingBox(); prop.seat!.geometry.computeBoundingSphere();
    // Contact is measured against the rendered triangular cushion, not a pelvis bone estimate.
    let bestGap = Infinity, target: THREE.Vector3 | null = null, cushion: THREE.Vector3 | null = null;
    for (const probe of probes!.butt) {
      readProbe(probe, point); const relative = point.clone().sub(seatCenter), x = (relative.dot(right) / width + .5) * columns, z = (relative.dot(heading) / depth + .5) * rows;
      const column = Math.floor(x), row = Math.floor(z); if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
      const dx = x - column, dz = z - row, index = row * (columns + 1) + column;
      const height = dx + dz <= 1 ? heights[index] * (1 - dx - dz) + heights[index + 1] * dx + heights[index + columns + 1] * dz
        : heights[index + 1] * (1 - dz) + heights[index + columns + 1] * (1 - dx) + heights[index + columns + 2] * (dx + dz - 1);
      const gap = point.y - height;
      if (gap >= -.003 && gap < bestGap) { bestGap = gap; target = point.clone(); cushion = point.clone(); cushion.y = height; }
    }
    if (target && cushion) {
      prop.contactNodes[0].position.copy(cushion);
      target.applyMatrix4(parent.matrixWorld); cushion.applyMatrix4(parent.matrixWorld);
      contacts.push({ target: 'butt-skin', targetPoint: xyz(target), propPoint: xyz(cushion), distance: target.distanceTo(cushion) });
    }
  }

  function update({ time, duration }: { time: number; duration: number }) {
    if (disposed || !active || !motion || !kind || !probes) return;
    contacts = []; interactionPhase = kind === 'chair' ? 'supported' : 'held';
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) { active.root.visible = false; opacity = 0; return; }
    parent.updateWorldMatrix(true, true); model.updateMatrixWorld(true);
    skeletons.forEach(skeleton => skeleton.update());
    if (kind === 'chair') chairSkin.refresh();
    parentInverse.copy(parent.matrixWorld).invert(); parent.getWorldQuaternion(parentQuaternion).invert();
    local(bodyBone!, bodyPosition); bodyBone!.getWorldQuaternion(bodyQuaternion).premultiply(parentQuaternion);
    heading.set(0, 0, 1).applyQuaternion(bodyQuaternion); heading.y = 0;
    if (heading.lengthSq() < .01) { right.set(1, 0, 0).applyQuaternion(bodyQuaternion); right.y = 0; heading.crossVectors(right.normalize(), UP); }
    heading.normalize(); right.crossVectors(UP, heading).normalize();
    palms.forEach((palm, i) => local(palm!, palmPositions[i])); handSpan = palmPositions[0].distanceTo(palmPositions[1]);
    floorPoint.set(0, 0, 0).applyMatrix4(parentInverse); const floor = floorPoint.y;
    // Chair geometry uses its dense support probes, not the body-clearance subset.
    if (kind !== 'chair' && !active.environment) for (const probe of skinPoints) readProbe(probe, probe.point);
    const entry = motion.entryDuration ?? ({ 29: .8, 32: 22 / 30, 124: 26 / 30, 312: 25 / 30, 364: 22 / 30, 693: 26 / 30 } as Record<number, number>)[motion.sourceActionId] ?? .7;
    const exit = motion.exitDuration ?? ([124, 312, 693].includes(motion.sourceActionId) ? 29 / 30 : motion.sourceActionId === 29 ? 28 / 30 : 26 / 30);
    // The rope appears only once both hands have reached their authored grip.
    // An Idle-to-grip arm blend cannot safely hold an already rotating loop.
    const delay = kind === 'jump-rope' || kind === 'walker' ? entry : kind === 'chair' ? entry * .72 : .12;
    opacity = ease((time - delay) / .20) * ease((duration - time - exit * .55) / .22);
    // The source has eight jumps. End the visible rope on the rising arc
    // after the eighth pass, before the grounded Idle recovery starts.
    if (kind === 'jump-rope') opacity *= 1 - ease((time - entry - JUMP_ROPE_SOURCE_PEAKS.at(-1)! - .32) / .20);
    if (kind === 'walker') opacity *= 1 - ease((time - duration + exit + .15) / .15);
    if (active.environment) opacity = ease((time - .02) / .2) * ease((duration - time - .05) / .2);
    active.root.visible = opacity > .001;
    for (const prop of cache.values()) if (prop === active) prop.root.traverse(object => {
      if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.transparent = opacity < 1; material.opacity = opacity; material.depthWrite = opacity > .95; }
    });
    if (!active.root.visible) return;
    if (active.environment && active.environmentConfig) {
      // Environment metadata binds explicit material vertices on this mesh.
      // A nearest socket probe may be absent in Idle and is not its identity.
      const mesh = environmentMesh;
      if (!(mesh instanceof THREE.SkinnedMesh)) { active.root.visible = false; return; }
      const readSurface = (indices: { L: number; R: number }) => ({
        L: readProbe({ mesh, index: indices.L }, new THREE.Vector3()), R: readProbe({ mesh, index: indices.R }, new THREE.Vector3()),
      });
      // These supports were authored in the clip's model coordinates. Apply the
      // holder's single grounding/yaw transform to both body and environment;
      // re-grounding only the prop would move its contact planes by that offset.
      const state = active.environment.update({ floor: 0, opacity, hands: readSurface(active.environmentConfig.targetHandVertices), feet: readSurface(active.environmentConfig.targetFootVertices) });
      interactionPhase = state.phase;
      contacts = state.contacts.map(contact => {
        const target = contact.targetPoint.clone().applyMatrix4(parent.matrixWorld), actual = contact.propPoint.clone().applyMatrix4(parent.matrixWorld);
        return { target: contact.target, targetPoint: xyz(target), propPoint: xyz(actual), distance: actual.distanceTo(target) };
      });
    } else if (active.portable) {
      let buttPoint: THREE.Vector3 | undefined;
      if (motion.sourceActionId === 343 || kind === 'seating-surface') for (const probe of kind === 'seating-surface' ? probes.buttCenter : probes.butt) {
        const point = readProbe(probe, new THREE.Vector3());
        if (!buttPoint || point.y < buttPoint.y) buttPoint = point;
      }
      const state = active.portable.update({ time, duration, entry, opacity, floor, grips: [grip(0), grip(1)],
        stagePosition: motion.travel ? sampleDoreumiTravel(motion.travel, time) : undefined,
        bodyPosition, heading, right, bodyPoints: skinPoints.map(probe => probe.point),
        mouthPoint: probes.mouth ? readProbe(probes.mouth, new THREE.Vector3()) : undefined, buttPoint,
        buttPoints: kind === 'seating-surface' ? probes.buttCenter.map(probe => readProbe(probe, new THREE.Vector3())) : undefined,
        handPoints: kind === 'jump-rope' ? probes.handSurfaces.map(surface => surface.map(probe => readProbe(probe, new THREE.Vector3()))) : undefined });
      interactionPhase = state.phase;
      contacts = state.contacts.map(contact => {
        const target = contact.targetPoint.clone().applyMatrix4(parent.matrixWorld), actual = contact.propPoint.clone().applyMatrix4(parent.matrixWorld);
        return { target: contact.target, targetPoint: xyz(target), propPoint: xyz(actual), distance: actual.distanceTo(target) };
      });
    } else if (kind === 'chair') updateChair(floor);
    else if (kind === 'phone') {
      const side = [29, 312].includes(motion.sourceActionId) ? 0 : 1;
      const target = readProbe(phoneProbes[side]!, new THREE.Vector3());
      const orientation = wrists[side]!.getWorldQuaternion(new THREE.Quaternion()).premultiply(parentQuaternion);
      const localNormal = phoneNormals[side]!;
      const localUp = new THREE.Vector3(...PHONE_PALM_CONTACTS[side].localUp);
      localUp.addScaledVector(localNormal, -localUp.dot(localNormal)).normalize();
      // The rigid phone follows its material palm frame. Offline adaptation turns
      // this frame toward the head during reading/calling and preserves carried poses.
      const palmNormal = localNormal.clone().applyQuaternion(orientation);
      const screenUp = localUp.applyQuaternion(orientation);
      const texting = [122, 676].includes(motion.sourceActionId);
      const horizontal = texting ? palmNormal.clone().negate() : screenUp.clone().cross(palmNormal).normalize();
      const normal = texting ? horizontal.clone().cross(screenUp).normalize() : palmNormal;
      // A sub-1%-height palm gap keeps the rigid case outside the soft mitten/cheek surface.
      const phoneContact = target.clone().addScaledVector(palmNormal, .017);
      // Texting uses a side grip so the other hand can reach the display without
      // stretching either arm across the plush body. Calls retain their rear grip.
      active.body.position.copy(phoneContact);
      if (texting) active.body.position.addScaledVector(horizontal, -.075);
      else active.body.position.addScaledVector(normal, .0175).addScaledVector(screenUp, .087);
      active.body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(horizontal, screenUp, normal));
      active.body.scale.y = .9; recordGrip(side, target, 0, phoneContact);
    } else if (kind === 'umbrella') {
      const side = 1, outward = right.clone().negate(), target = grip(side);
      const shaft = target.clone(); shaft.addScaledVector(outward, Math.max(.08, bodyExtent(outward, target.y, 2.2) + .05 - target.dot(outward)));
      const shoulder = shaft.clone(); shoulder.y = floor + 2.26;
      const crown = bodyPosition.clone().addScaledVector(right, -.16).addScaledVector(heading, .06); crown.y = floor + 2.49;
      active.canopy!.position.copy(crown);
      between(active.bars[0], target, shaft); between(active.bars[1], shaft, shoulder); between(active.bars[2], shoulder, crown.clone().addScaledVector(UP, .23));
      recordGrip(side, target, 0);
    } else if (kind === 'bag' || kind === 'bucket') {
      active.pieces!.forEach((piece, side) => {
        const outward = right.clone().multiplyScalar(side ? -1 : 1), target = grip(side);
        const center = target.clone().addScaledVector(outward, .055); center.y = Math.max(floor + .14, target.y - .24);
        const radius = kind === 'bucket' ? .15 : .14;
        center.addScaledVector(outward, Math.max(0, bodyExtent(outward, center.y - .13, center.y + .13) + radius + .012 - center.dot(outward)));
        piece.position.copy(center); piece.quaternion.setFromAxisAngle(UP, Math.atan2(heading.x, heading.z));
        const a = center.clone().addScaledVector(heading, .115).addScaledVector(UP, .115), b = center.clone().addScaledVector(heading, -.115).addScaledVector(UP, .115);
        between(active!.bars[side * 2], target, a); between(active!.bars[side * 2 + 1], target, b); recordGrip(side, target, side);
      });
    } else if (motion.sourceActionId === 284) {
      // Calibrated on frozen meshy-284's deformed left-palm surface at its lowest reach.
      // The parcel stays on the floor until the hand arrives, then the same grip follows it.
      const grabTime = 4.1, gripHeight = .1531123845, target = grip(0), held = time >= grabTime;
      const gripPoint = held ? target : new THREE.Vector3(.5240072765, floor + .2556123845, .4950161316);
      const center = gripPoint.clone().addScaledVector(UP, -gripHeight);
      active.body.position.copy(center); active.body.quaternion.identity();
      between(active.bars[0], gripPoint, center.clone().addScaledVector(UP, .125));
      interactionPhase = held ? 'held' : 'ground'; if (held) recordGrip(0, target, 0);
    } else {
      const left = grip(0), rightGrip = grip(1), center = left.clone().add(rightGrip).multiplyScalar(.5);
      const isBell = kind === 'kettlebell', halfDepth = isBell ? .22 : .19, halfHeight = isBell ? .245 : .17;
      center.y = Math.max(floor + halfHeight + .008, center.y - (isBell ? .30 : .16));
      center.addScaledVector(heading, Math.max(.16, bodyExtent(heading, center.y - halfHeight, center.y + halfHeight) + halfDepth + .025 - center.dot(heading)));
      active.body.position.copy(center); active.body.quaternion.setFromAxisAngle(UP, Math.atan2(heading.x, heading.z));
      const width = Math.max(.84, handSpan - .08); if (!isBell) active.body.scale.x = width;
      if (isBell) between(active.bars[0], left, rightGrip);
      for (const [side, target] of [left, rightGrip].entries()) {
        const sign = side ? -1 : 1;
        if (isBell) {
          const mount = center.clone().addScaledVector(right, sign * .16).addScaledVector(UP, .17);
          between(active.bars[side + 1], target, mount); recordGrip(side, target, side); continue;
        }
        // Separate side handles route around the torso; no bar crosses between palms.
        const elbow = target.clone().addScaledVector(right, sign * .045);
        elbow.addScaledVector(heading, Math.max(0, center.dot(heading) - halfDepth - elbow.dot(heading)));
        const mount = center.clone().addScaledVector(right, sign * (isBell ? .12 : width * .49)).addScaledVector(UP, halfHeight * .72);
        between(active.bars[side * 2], target, elbow); between(active.bars[side * 2 + 1], elbow, mount); recordGrip(side, target, side);
      }
    }
    root.updateMatrixWorld(true);
    // Resolve after placement; contact nodes and skin targets must agree under holder yaw/scale.
    contacts.forEach((contact, index) => { if (kind !== 'chair' && !active!.portable && !active!.environment) { const actual = active!.contactNodes[index].getWorldPosition(new THREE.Vector3()); contact.propPoint = xyz(actual); contact.distance = actual.distanceTo(new THREE.Vector3(...contact.targetPoint)); } });
  }

  function inspect(): DoreumiContextInspection {
    const measured = new THREE.Box3();
    const visit = (object: THREE.Object3D) => {
      if (!object.visible) return;
      if (object instanceof THREE.Mesh) {
        if (kind === 'walker') {
          // A spinning wheel's rotated local AABB has empty corners below the
          // floor. Measure its visible vertices for actual support clearance.
          const position = object.geometry.getAttribute('position'), vertex = new THREE.Vector3();
          for (let index = 0; index < position.count; index++) measured.expandByPoint(vertex.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld));
        } else {
          object.geometry.computeBoundingBox();
          const world = object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld);
          measured.union(world);
        }
      }
      object.children.forEach(visit);
    };
    if (active?.root.visible) visit(active.root);
    const bounds = measured.isEmpty() ? null : measured;
    const values = bounds ? [...bounds.min.toArray(), ...bounds.max.toArray(), ...contacts.flatMap(contact => [...contact.targetPoint, ...contact.propPoint, contact.distance])] : [];
    return { actionId: motion?.sourceActionId ?? null, kind, supported: !exclusionReason, exclusionReason,
      visible: !!active?.root.visible, opacity, contacts: contacts.map(contact => ({ ...contact, targetPoint: [...contact.targetPoint], propPoint: [...contact.propPoint] })),
      handSpan, bounds: bounds ? { min: xyz(bounds.min), max: xyz(bounds.max) } : null,
      floorClearance: bounds ? bounds.min.y : null, frame: frame(), finite: values.every(Number.isFinite), interactionPhase,
      contactBasis: 'deformed-master-skin', bodyClearanceBasis: 'sampled-skin-with-padding' };
  }
  function dispose() {
    if (disposed) return; disposed = true; root.removeFromParent(); disposeMeshes(root); cache.clear(); active = null; contacts = []; kind = null; opacity = 0;
  }
  return { root, setMotion, update, inspect, dispose };
}
