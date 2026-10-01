"use client";

import { useSyncExternalStore } from "react";

/**
 * 화면 속 도름이 크기(도름이 설정, 2026-09-28 사용자 지시: "도름이 크기 원하는 경우 어딘가에서 깔끔하게 조절할 수 있게").
 * 기기마다 화면이 달라서 계정이 아니라 이 브라우저에 저장한다. 상자의 가로세로 비율은 그대로 두고 배율만 바꾸므로
 * 걷기·벽 붙기 계산(모두 실제 상자 크기를 잰다)이 그대로 맞는다.
 */
export const DOREUMI_SCALE = { min: 0.7, max: 1.6, step: 0.05, base: 1 } as const;
export const DOREUMI_SCALE_PRESETS = [{ label: "작게", value: 0.8 }, { label: "보통", value: 1 }, { label: "크게", value: 1.3 }] as const;
const KEY = "dorms-doreumi-scale:v1";
const EVENT = "dorms:doreumi-scale";

const clamp = (value: number) => Math.min(DOREUMI_SCALE.max, Math.max(DOREUMI_SCALE.min, Math.round(value / DOREUMI_SCALE.step) * DOREUMI_SCALE.step));

export function readDoreumiScale(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DOREUMI_SCALE.base;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : DOREUMI_SCALE.base;
  } catch { return DOREUMI_SCALE.base; }
}

export function saveDoreumiScale(value: number) {
  const next = clamp(value);
  try { localStorage.setItem(KEY, String(next)); } catch { /* Private windows still change for this page. */ }
  memory = next;
  window.dispatchEvent(new Event(EVENT));
}

let memory: number | null = null;
const snapshot = () => memory ?? (memory = readDoreumiScale());
const subscribe = (notify: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { memory = null; notify(); } };
  window.addEventListener(EVENT, notify); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", onStorage); };
};

export function useDoreumiScale(): number {
  return useSyncExternalStore(subscribe, snapshot, () => DOREUMI_SCALE.base);
}
