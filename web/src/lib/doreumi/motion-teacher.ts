import * as THREE from 'three';
import { solveDoreumiLimb } from '@/lib/doreumi/motion-articulation';

/**
 * 도름이 선생님 차림: 동그란 안경·콧수염(머리 뼈에 붙는다)과, 칠판의 줄을 가리키는 팔(두 관절 IK).
 * 도름이 안내 수첩의 '도름스 약속' 칠판 수업에서만 켠다(사용자 원문 2026-10-02 "도름이가 안경이랑 콧수염 달려서
 * 칠판에 적힌 것들 하나하나 막 막대기로 짚으면서"). 지시봉은 화면(DOM)에서 손 위치부터 줄까지 그린다.
 *
 * 좌표: 얼굴 그림(face ink)이 칠해지는 모형 기준 좌표(vFaceRest, faceBounds -0.4~0.4 · -0.12~0.64)에서
 * 표준 표정(neutral.webp)의 잉크를 재서 눈·입 중심을 정했다(2026-10-03 실측: 왼눈 -0.134,0.200 · 오른눈 0.137,0.211 · 입 0.003,0.146).
 * 차림은 머리 뼈의 자식으로 붙이고 boneInverse·bindMatrix 로 같은 좌표계에 놓아, 어떤 동작에서도 얼굴에 붙어 있다.
 * 도름이 몸(모양·뼈·표정 셰이더)은 바꾸지 않는다.
 */

const EYES = [new THREE.Vector2(-0.134, 0.2), new THREE.Vector2(0.137, 0.211)] as const;
const MOUTH = new THREE.Vector2(0.003, 0.146);
const LENS_RADIUS = 0.058;
const FRAME_TUBE = 0.0072;
const FRAME_COLOR = 0x2a211c;

export type TeacherSide = 'L' | 'R';
export type TeacherKit = {
  setVisible: (on: boolean) => void;
  /** 몸 동작(믹서)을 적용한 뒤, 그리기 전에 부른다. target 은 세계 좌표. */
  aim: (target: THREE.Vector3, side: TeacherSide) => void;
  /** 손바닥 소켓의 세계 좌표. */
  hand: (side: TeacherSide, out: THREE.Vector3) => THREE.Vector3 | null;
  dispose: () => void;
};

/** 기준 자세(모프 포함)의 앞면 깊이: (x, y) 둘레에서 가장 앞(z 최대)인 꼭짓점. */
function frontDepth(mesh: THREE.SkinnedMesh, at: THREE.Vector2, radius = 0.03): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const morph = geometry.morphAttributes.position?.[0];
  const influence = mesh.morphTargetInfluences?.[0] ?? 0;
  const relative = geometry.morphTargetsRelative;
  let best = -Infinity;
  for (let i = 0; i < position.count; i++) {
    let x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (morph && influence) {
      const mx = morph.getX(i), my = morph.getY(i), mz = morph.getZ(i);
      if (relative) { x += mx * influence; y += my * influence; z += mz * influence; }
      else { x += (mx - x) * influence; y += (my - y) * influence; z += (mz - z) * influence; }
    }
    if (z < 0.1) continue;
    if (Math.hypot(x - at.x, y - at.y) > radius) continue;
    if (z > best) best = z;
  }
  return Number.isFinite(best) ? best : 0.26;
}

function mustacheShape(): THREE.Shape {
  // 가운데 위 → 왼쪽 끝(살짝 말려 올라감) → 가운데 아래 → 오른쪽 끝 → 가운데 위. 좌우 대칭.
  const s = new THREE.Shape();
  s.moveTo(0, 0.011);
  s.bezierCurveTo(-0.028, 0.019, -0.058, 0.004, -0.074, 0.012);
  s.bezierCurveTo(-0.082, 0.016, -0.084, 0.026, -0.078, 0.03);
  s.bezierCurveTo(-0.07, 0.006, -0.03, -0.018, 0, -0.006);
  s.bezierCurveTo(0.03, -0.018, 0.07, 0.006, 0.078, 0.03);
  s.bezierCurveTo(0.084, 0.026, 0.082, 0.016, 0.074, 0.012);
  s.bezierCurveTo(0.058, 0.004, 0.028, 0.019, 0, 0.011);
  return s;
}

export function createTeacherKit(model: THREE.Object3D, mesh: THREE.SkinnedMesh): TeacherKit | null {
  const bones = mesh.skeleton.bones;
  const headIndex = bones.findIndex((bone) => bone.name === 'head');
  if (headIndex < 0) return null;
  const head = bones[headIndex];
  const limbs = {
    L: { upper: model.getObjectByName('armL'), lower: model.getObjectByName('elbowL'), end: model.getObjectByName('wristL'), palm: model.getObjectByName('palmL') },
    R: { upper: model.getObjectByName('armR'), lower: model.getObjectByName('elbowR'), end: model.getObjectByName('wristR'), palm: model.getObjectByName('palmR') },
  };

  // 모형 기준 좌표 → 머리 뼈 좌표. 이 그룹 안에서는 얼굴 그림과 같은 좌표로 그린다.
  const group = new THREE.Group();
  group.name = 'DoreumiItem_teacher';
  group.matrixAutoUpdate = false;
  group.matrix.copy(mesh.skeleton.boneInverses[headIndex]).multiply(mesh.bindMatrix);
  group.visible = false;

  const frame = new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.42, metalness: 0.15 });
  const glass = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const disposables: { dispose: () => void }[] = [frame, glass, shine];

  const eyeDepth = Math.max(frontDepth(mesh, EYES[0]), frontDepth(mesh, EYES[1]));
  const lensZ = eyeDepth + 0.034;
  const ring = new THREE.TorusGeometry(LENS_RADIUS, FRAME_TUBE, 12, 48);
  const disc = new THREE.CircleGeometry(LENS_RADIUS - FRAME_TUBE * 0.6, 40);
  const streak = new THREE.PlaneGeometry(0.012, 0.05);
  disposables.push(ring, disc, streak);
  for (const eye of EYES) {
    const lens = new THREE.Mesh(ring, frame); lens.position.set(eye.x, eye.y, lensZ); group.add(lens);
    const pane = new THREE.Mesh(disc, glass); pane.position.set(eye.x, eye.y, lensZ - 0.002); pane.renderOrder = 2; group.add(pane);
    const glint = new THREE.Mesh(streak, shine); glint.position.set(eye.x - 0.022, eye.y + 0.018, lensZ + 0.001); glint.rotation.z = -0.55; glint.renderOrder = 3; group.add(glint);
  }
  const midY = (EYES[0].y + EYES[1].y) / 2 + 0.012;
  const bridge = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(EYES[0].x + LENS_RADIUS - 0.004, midY - 0.006, lensZ),
    new THREE.Vector3(0, midY + 0.02, lensZ + 0.01),
    new THREE.Vector3(EYES[1].x - LENS_RADIUS + 0.004, midY - 0.006, lensZ),
  ), 16, FRAME_TUBE * 0.85, 8, false);
  disposables.push(bridge);
  group.add(new THREE.Mesh(bridge, frame));
  for (const [eye, sign] of [[EYES[0], -1], [EYES[1], 1]] as const) {
    const start = new THREE.Vector3(eye.x + sign * LENS_RADIUS, eye.y + 0.01, lensZ);
    const temple = new THREE.TubeGeometry(new THREE.LineCurve3(start, start.clone().add(new THREE.Vector3(sign * 0.035, 0.012, -0.16))), 4, FRAME_TUBE * 0.8, 6, false);
    disposables.push(temple);
    group.add(new THREE.Mesh(temple, frame));
  }

  const mouthDepth = frontDepth(mesh, new THREE.Vector2(MOUTH.x, MOUTH.y + 0.026));
  const stache = new THREE.ExtrudeGeometry(mustacheShape(), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0035, bevelSegments: 3, curveSegments: 18 });
  disposables.push(stache);
  const moustache = new THREE.Mesh(stache, new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.78, metalness: 0 }));
  disposables.push(moustache.material as THREE.Material);
  moustache.position.set(MOUTH.x, MOUTH.y + 0.026, mouthDepth + 0.006);
  group.add(moustache);
  head.add(group);

  const pole = new THREE.Vector3();
  return {
    setVisible(on) { group.visible = on; },
    aim(target, side) {
      const limb = limbs[side];
      if (!limb.upper || !limb.lower || !limb.end) return;
      model.updateMatrixWorld(true);
      // 팔꿈치는 아래·조금 뒤로 굽힌다(정면을 보는 몸 기준).
      pole.set(side === 'L' ? 0.25 : -0.25, -1, -0.35).normalize();
      solveDoreumiLimb(limb.upper, limb.lower, limb.end, target, pole);
    },
    hand(side, out) {
      const palm = limbs[side].palm ?? limbs[side].end;
      if (!palm) return null;
      palm.updateWorldMatrix(true, false);
      return palm.getWorldPosition(out);
    },
    dispose() {
      head.remove(group);
      disposables.forEach((item) => item.dispose());
    },
  };
}
