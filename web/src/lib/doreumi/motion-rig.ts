import { Bone, Float32BufferAttribute, Matrix4, Object3D, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';

export const DOREUMI_RIG_VERSION = 3;
type Transform = { position: number[]; quaternion: number[]; scale: number[]; parent: string; parentQuaternion: number[] };
export type DoreumiRigInspection = { version: number; bones: number; elbows: number; wrists: number; knees: number; kneeVertices: number; neckVertices: number; weldedVertices: number; influencedVertices: number; maxRestError: number };
export type DoreumiRigData = { version: number; source: Record<string, Transform>; rest: Record<string, Transform>; inspection: DoreumiRigInspection };
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Measured corrected V60 neutral surface, before its root lift. Position, normal,
// UV and morph attributes remain byte-identical throughout the rig build.
const JOINTS: [string, string, number, number, number][] = [
  ['root', 'DoreumiRig', 0, -1.14, 0], ['body', 'root', 0, -.72, 0],
  ['torso', 'body', 0, -.46, 0], ['head', 'torso', 0, -.045, .025],
  ...(['L', 'R'] as const).flatMap(side => {
    const s = side === 'L' ? 1 : -1;
    return [
      [`shoulder${side}`, 'torso', .40 * s, -.245, 0],
      [`arm${side}`, `shoulder${side}`, .57 * s, -.245, 0],
      [`elbow${side}`, `arm${side}`, .713 * s, -.423, .029],
      [`wrist${side}`, `elbow${side}`, .80 * s, -.52, .06],
      [`thigh${side}`, 'body', .2675 * s, -.72, 0],
      [`knee${side}`, `thigh${side}`, .2675 * s, -.89, .015],
      [`shin${side}`, `knee${side}`, .2675 * s, -.89, .015],
      [`foot${side}`, `shin${side}`, .2675 * s, -1.045, .065],
    ] as [string, string, number, number, number][];
  }),
];
function snapshot(object: Object3D): Transform {
  return { position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), parent: object.parent?.name ?? '', parentQuaternion: object.parent?.getWorldQuaternion(new Quaternion()).toArray() ?? [0, 0, 0, 1] };
}
export function doreumiRigData(root: Object3D): DoreumiRigData | undefined { return root.userData.doreumiMasterRig as DoreumiRigData | undefined; }

/** Real connected limb chains. Each inverse bind retains the original skin
 * matrix, including the creator's corrective 1.07 similarity transform. */
export function articulateDoreumiRig(root: Object3D): DoreumiRigInspection {
  const existing = doreumiRigData(root); if (existing?.version === DOREUMI_RIG_VERSION) return existing.inspection;
  root.updateMatrixWorld(true);
  const result: DoreumiRigInspection = { version: DOREUMI_RIG_VERSION, bones: 0, elbows: 2, wrists: 2, knees: 2, kneeVertices: 0, neckVertices: 0, weldedVertices: 0, influencedVertices: 0, maxRestError: 0 };
  const source: Record<string, Transform> = {}, rest: Record<string, Transform> = {};
  root.traverse(object => { if (object instanceof Bone || object.name === 'DoreumiRig') source[object.name] = snapshot(object); });
  const meshes: SkinnedMesh[] = []; root.traverse(object => { if (object instanceof SkinnedMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const previous = mesh.skeleton, bones = [...previous.bones], indexByName = new Map(bones.map((bone, index) => [bone.name, index]));
    const skinMatrices = bones.map((bone, index) => bone.matrixWorld.clone().multiply(previous.boneInverses[index]));
    const position = mesh.geometry.getAttribute('position'), oldIndices = mesh.geometry.getAttribute('skinIndex'), oldWeights = mesh.geometry.getAttribute('skinWeight');
    const before = new Float64Array(position.count * 3), vertex = new Vector3(); previous.update();
    for (let i = 0; i < position.count; i++) mesh.getVertexPosition(i, vertex).toArray(before, i * 3);
    for (const [name] of JOINTS) if (!indexByName.has(name)) {
      const bone = new Bone(); bone.name = name; indexByName.set(name, bones.length); bones.push(bone);
      skinMatrices.push(skinMatrices[indexByName.get(name.startsWith('knee') ? `thigh${name.slice(-1)}` : `arm${name.slice(-1)}`)!].clone());
    }
    const world = new Map<string, Matrix4>();
    for (const [name, parentName, x, y, z] of JOINTS) {
      const bone = bones[indexByName.get(name)!], parent = parentName === 'DoreumiRig' ? root.getObjectByName(parentName) : bones[indexByName.get(parentName)!];
      if (!parent) throw new Error(`Missing Doreumi rig parent: ${parentName}`);
      const matrix = new Matrix4().makeTranslation(x, y, z); world.set(name, matrix);
      const parentWorld = world.get(parentName) ?? parent.matrixWorld;
      parent.add(bone); parentWorld.clone().invert().multiply(matrix).decompose(bone.position, bone.quaternion, bone.scale);
    }
    root.updateMatrixWorld(true);
    const inverses = bones.map((bone, index) => bone.matrixWorld.clone().invert().multiply(skinMatrices[index]));
    const indices = new Uint16Array(position.count * 4), weights = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const influence = new Map<number, number>(); const add = (name: string, weight: number) => { if (weight > 1e-8) { const index = indexByName.get(name)!; influence.set(index, (influence.get(index) ?? 0) + weight); } };
      const x = Math.abs(before[i * 3]), y = before[i * 3 + 1]; let affected = false;
      for (let c = 0; c < 4; c++) {
        const weight = oldWeights.getComponent(i, c); if (!weight) continue;
        const name = previous.bones[oldIndices.getComponent(i, c)].name, side = name.slice(-1);
        if (/^(arm|shoulder)[LR]$/.test(name)) {
          const forearm = smooth(.645, .752, x), hand = smooth(.765, .835, x);
          const collar = name.startsWith('shoulder') ? .65 * (1 - forearm) : 0;
          add(`shoulder${side}`, weight * collar); add(`arm${side}`, weight * (1 - collar) * (1 - forearm));
          add(`elbow${side}`, weight * (1 - collar) * forearm * (1 - hand)); add(`wrist${side}`, weight * (1 - collar) * forearm * hand); affected = true;
        } else if (/^(thigh|shin|foot)[LR]$/.test(name)) {
          const lower = 1 - smooth(-.94, -.825, y), foot = 1 - smooth(-1.06, -.965, y);
          add(`thigh${side}`, weight * (1 - lower)); add(`knee${side}`, weight * lower * (1 - foot)); add(`foot${side}`, weight * lower * foot);
          if (weight * lower * (1 - foot) > .05) result.kneeVertices++; affected = true;
        } else if (name === 'head' || name === 'torso' || name === 'body') {
          // The source used a hard horizontal head/torso cut. A shared spatial
          // field keeps adjoining triangles and overlaid face details together.
          const head = smooth(-.22, .24, y), torso = smooth(-.76, -.43, y);
          add('head', weight * head); add('torso', weight * (1 - head) * torso); add('body', weight * (1 - head) * (1 - torso));
          if (head > 0 && head < 1) result.neckVertices++; affected = true;
        } else add(name, weight);
      }
      const strongest = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = strongest.reduce((total, item) => total + item[1], 0);
      strongest.forEach(([index, weight], c) => { indices[i * 4 + c] = index; weights[i * 4 + c] = weight / sum; });
      if (affected) result.influencedVertices++;
    }
    // glTF duplicates vertices at material and UV seams. They must still share
    // deformation weights, without welding or rewriting protected geometry.
    const seams = new Map<string, number[]>();
    for (let i = 0; i < position.count; i++) {
      const key = [0, 1, 2].map(axis => Math.round(before[i * 3 + axis] * 1e5)).join(',');
      const group = seams.get(key); if (group) group.push(i); else seams.set(key, [i]);
    }
    for (const group of seams.values()) if (group.length > 1) {
      const influence = new Map<number, number>();
      for (const i of group) for (let c = 0; c < 4; c++) if (weights[i * 4 + c]) influence.set(indices[i * 4 + c], (influence.get(indices[i * 4 + c]) ?? 0) + weights[i * 4 + c]);
      const strongest = [...influence].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = strongest.reduce((total, item) => total + item[1], 0);
      for (const i of group) { indices.fill(0, i * 4, i * 4 + 4); weights.fill(0, i * 4, i * 4 + 4); strongest.forEach(([index, weight], c) => { indices[i * 4 + c] = index; weights[i * 4 + c] = weight / sum; }); }
      result.weldedVertices += group.length;
    }
    mesh.geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4)); mesh.geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
    mesh.skeleton = new Skeleton(bones, inverses); mesh.skeleton.update(); previous.dispose();
    for (let i = 0; i < position.count; i++) { mesh.getVertexPosition(i, vertex); result.maxRestError = Math.max(result.maxRestError, Math.hypot(vertex.x - before[i * 3], vertex.y - before[i * 3 + 1], vertex.z - before[i * 3 + 2])); }
    result.bones = bones.length;
  }
  for (const [name, parent, position] of [
    ['lap', 'body', [0, .17, .265]], ['palmL', 'wristL', [.028, -.035, .02]], ['palmR', 'wristR', [-.028, -.035, .02]], ['headAccessory', 'head', [0, .96, 0]],
  ] as const) {
    const socket = new Object3D(); socket.name = name; socket.position.fromArray(position); root.getObjectByName(parent)?.add(socket);
  }
  root.updateMatrixWorld(true); root.traverse(object => { if (object instanceof Bone || object.name === 'DoreumiRig') rest[object.name] = snapshot(object); });
  root.userData.doreumiMasterRig = { version: DOREUMI_RIG_VERSION, source, rest, inspection: result } satisfies DoreumiRigData;
  return result;
}
export function jointRestQuaternion(root: Object3D | undefined, name: string): Quaternion {
  return new Quaternion().fromArray(root ? doreumiRigData(root)?.rest[name]?.quaternion ?? [0, 0, 0, 1] : [0, 0, 0, 1]);
}
export function inspectDoreumiContacts(root: Object3D) {
  root.updateMatrixWorld(true);
  return Object.fromEntries(['lap', 'palmL', 'palmR', 'headAccessory', 'footL', 'footR'].map(name => [name, root.getObjectByName(name)?.getWorldPosition(new Vector3()).toArray() ?? null]));
}
