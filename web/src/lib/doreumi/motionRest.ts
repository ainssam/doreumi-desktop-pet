/**
 * 도름이 움직임 쉬게 하기(2026-10-07). 도름이는 시스템 '움직임 줄이기'로는 멈추지 않으므로(운영자 지시 "모든 데스크톱에서 제대로
 * 모션 작동되게"), 움직임이 불편한 사람이 사이트 안에서 직접 멈출 수 있게 한다(웹 접근성 '정지 기능 제공').
 * 켜면 도름이는 제자리에 가만히 서 있다: 그리기 멈춤, 저절로 하는 공연·나들이·달리기 없음. 크기처럼 이 브라우저에만 저장한다.
 */
const KEY = "dorms-doreumi-motion-rest:v1";
export const DOREUMI_MOTION_REST_EVENT = "dorms:doreumi-motion-rest";

export function readDoreumiMotionRest(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

let memory: boolean | null = null;
export function doreumiMotionRest(): boolean {
  if (typeof window === "undefined") return false;
  return memory ?? (memory = readDoreumiMotionRest());
}

export function saveDoreumiMotionRest(rest: boolean) {
  try { if (rest) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* Private windows still change for this page. */ }
  memory = rest;
  window.dispatchEvent(new Event(DOREUMI_MOTION_REST_EVENT));
}

export function subscribeDoreumiMotionRest(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { memory = null; notify(); } };
  window.addEventListener(DOREUMI_MOTION_REST_EVENT, notify); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(DOREUMI_MOTION_REST_EVENT, notify); window.removeEventListener("storage", onStorage); };
}
