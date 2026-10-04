'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseAmbientMotion, expressionForMotion, fetchMotionLibrary, type LibraryMotion } from '@/lib/doreumi/motion-library';
import type { DoreumiExpression } from '@/lib/doreumi/motion-catalog';
import type { DoreumiStageFrame } from '@/lib/doreumi/motion-travel';
import { doreumiSeason } from '@/lib/doreumi/seasons';
import { HOME_AMBIENT_ACTIONS as QUIET, SEASONAL_AMBIENT_ACTIONS as SEASONAL } from '@/lib/doreumi/ambient-actions';

const between = (range: number | [number, number]) => Array.isArray(range) ? range[0] + Math.random() * (range[1] - range[0]) : range;
/** Mostly short, irregular breaths between performances; now and then a longer pause. */
function ambientGapMs(roll = Math.random(), jitter = Math.random()): number {
  if (roll < .7) return 1200 + jitter * 2800;
  if (roll < .95) return 4000 + jitter * 5000;
  return 10000 + jitter * 6000;
}
const REST = { action: 'Idle', expression: 'neutral' as DoreumiExpression };

/** Interrupting interaction cancels both the next performance and its expiry timer. */
/** 휴대폰 홈 바닥 줄에서 다음 공연 대신 턱 위로 놀러 갈 확률(사용자 결정 2026-10-01 "가끔 스스로 올라가 놀다 내려옴"). 2~3분에 한 번꼴. */
const EXCURSION_CHANCE = .08;

export function useDoreumiPersonality(enabled: boolean, canPlayMotion?: (motion: LibraryMotion) => boolean, excursion?: () => boolean) {
  const [pose, setPose] = useState(REST);
  const library = useRef<LibraryMotion[]>([]), recent = useRef<string[]>([]);
  const canPlay = useRef(canPlayMotion); canPlay.current = canPlayMotion;
  const wander = useRef(excursion); wander.current = excursion;
  const frameHandler = useRef<(frame: DoreumiStageFrame) => void>(() => {});
  const onMotionFrame = useCallback((frame: DoreumiStageFrame) => frameHandler.current(frame), []);
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined, attempts = 0;
    const load = () => {
      attempts++;
      void fetchMotionLibrary(controller.signal).then(value => { library.current = value.motions; }).catch(() => {
        if (!controller.signal.aborted && attempts < 4) retry = setTimeout(load, 5000 * 2 ** (attempts - 1));
      });
    };
    load();
    return () => { controller.abort(); clearTimeout(retry); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let next: ReturnType<typeof setTimeout> | undefined, end: ReturnType<typeof setTimeout> | undefined;
    let performance: { action: string; seconds: number; started: boolean } | undefined;
    let paused = false;
    function cancel() { clearTimeout(next); clearTimeout(end); performance = undefined; setPose(REST); }
    frameHandler.current = frame => {
      if (frame.paused) { if (!paused) cancel(); paused = true; return; }
      if (paused) { paused = false; schedule(); return; }
      if (!performance) return;
      if (document.hidden || media.matches) { cancel(); return; }
      if (performance.started || frame.action !== performance.action || !Number.isFinite(frame.time)) return;
      performance.started = true;
      clearTimeout(end);
      // Download and recovery time do not consume the performance itself.
      end = setTimeout(schedule, Math.max(0, performance.seconds - Math.max(0, frame.time)) * 1000);
    };
    function schedule() {
      cancel();
      if (!enabled || paused || media.matches || document.hidden) return;
      next = setTimeout(() => {
        // 나들이를 떠나면 걷기 쪽이 움직이는 동안 공연을 쉰다(enabled 가 꺼진다).
        if (wander.current && Math.random() < EXCURSION_CHANCE && wander.current()) return;
        const imported = chooseAmbientMotion(library.current.filter(item => item.review === 'passed' && item.ambient && (canPlay.current?.(item) ?? true)), recent.current);
        const seasonal = SEASONAL[doreumiSeason()];
        const pool = seasonal ? [...QUIET, seasonal] : QUIET;
        const local = pool.filter(item => !recent.current.includes(item.action));
        const authored = local[Math.floor(Math.random() * local.length)] ?? pool.find(item => item.action !== recent.current.at(-1))!;
        const item = imported && Math.random() < .6
          ? { action: imported.id, expression: expressionForMotion(imported), seconds: imported.duration }
          : { action: authored.action, expression: authored.expression, seconds: between(authored.seconds) };
        recent.current = [...recent.current.slice(-9), item.action];
        performance = { action: item.action, seconds: Math.max(1, item.seconds), started: false };
        setPose({ action: item.action, expression: item.expression });
        // A failed or stalled load must not leave the director stuck forever.
        end = setTimeout(schedule, 30_000);
      }, ambientGapMs());
    }
    schedule();
    media.addEventListener('change', schedule); document.addEventListener('visibilitychange', schedule);
    return () => { frameHandler.current = () => {}; clearTimeout(next); clearTimeout(end); media.removeEventListener('change', schedule); document.removeEventListener('visibilitychange', schedule); };
  }, [enabled]);
  return { ...(enabled ? pose : REST), onMotionFrame };
}
