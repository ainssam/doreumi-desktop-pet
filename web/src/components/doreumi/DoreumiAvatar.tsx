'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DoreumiFacing, DoreumiInspection, DoreumiRenderer } from '@/lib/doreumi/motion-runtime';
import { dressKey, type DoreumiDress } from '@/lib/doreumi/items';
import type { DoreumiLook } from '@/lib/doreumi/seasons';
import type { DoreumiStageHandler } from '@/lib/doreumi/motion-travel';

// Same numbers as DOREUMI_STABLE_FRAMING in motion-runtime (kept here so the heavy runtime stays lazily loaded).
const STABLE = { top: .32, bottom: .25, side: .25 };

export type DoreumiAvatarHandle = {
  setAction: (action: string) => void;
  seek: (action: string, seconds: number) => void;
  play: () => void;
  inspect: () => DoreumiInspection | null;
  setExpression: (expression: string) => Promise<void>;
  setFacing: (facing: DoreumiFacing) => void;
  setSkeletonVisible: (visible: boolean) => void;
  loadAction: (action: string) => Promise<void>;
  setViewAngle: (degrees: number) => void;
  setPlaybackRate: (rate: number) => void;
  setSeason: (season: DoreumiLook | 'auto') => void;
  setLocomotionRate: (rate: number) => void;
  capture: () => string | undefined;
};
export type DoreumiAvatarProps = {
  action?: string; expression?: string; active?: boolean; className?: string; onReady?: () => void;
  facing?: DoreumiFacing;
  locomotionRate?: number;
  /** Chosen outfit; omitted means the base look. */
  outfit?: DoreumiLook;
  /** Items worn together and chosen colors (the shop). When given, it replaces `outfit`. */
  dress?: DoreumiDress;
  onMotionFrame?: DoreumiStageHandler;
  /** Keep the standing size and foot line through every motion; the canvas overflows the box instead. */
  stableFraming?: boolean;
};

export const DoreumiAvatar = forwardRef<DoreumiAvatarHandle, DoreumiAvatarProps>(function DoreumiAvatar(
  { action = 'idle', expression = 'neutral', active = true, facing, locomotionRate = 1, outfit, dress, className, onReady, onMotionFrame, stableFraming = false }, ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const runtime = useRef<DoreumiRenderer | null>(null);
  const latest = useRef({ action, expression, active, facing, locomotionRate, outfit, dress, onReady, onMotionFrame });
  latest.current = { action, expression, active, facing, locomotionRate, outfit, dress, onReady, onMotionFrame };
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [generation, setGeneration] = useState(0);
  useImperativeHandle(ref, () => ({
    setAction: name => runtime.current?.setAction(name),
    seek: (name, time) => runtime.current?.seek(name, time), play: () => runtime.current?.play(),
    inspect: () => runtime.current?.inspect() ?? null,
    setExpression: async value => { await runtime.current?.setExpression(value); },
    setFacing: value => runtime.current?.setFacing(value), setSkeletonVisible: value => runtime.current?.setSkeletonVisible(value),
    loadAction: async value => { await runtime.current?.loadAction(value); },
    setViewAngle: value => runtime.current?.setViewAngle(value), setPlaybackRate: value => runtime.current?.setPlaybackRate(value),
    setSeason: value => runtime.current?.setSeason(value),
    setLocomotionRate: value => runtime.current?.setLocomotionRate(value),
    capture: () => runtime.current?.capture(),
  }), []);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const controller = new AbortController(); let renderer: DoreumiRenderer | undefined, intersecting = true;
    const observer = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? true; renderer?.setVisible(intersecting); }, { rootMargin: '48px' });
    observer.observe(element);
    const lost = (event: Event) => { event.preventDefault(); renderer?.setActive(false); setStatus('fallback'); };
    const restored = () => { if (generation < 1) setGeneration(value => value + 1); };
    element.addEventListener('webglcontextlost', lost); element.addEventListener('webglcontextrestored', restored);
    setStatus('loading');
    void import('@/lib/doreumi/motion-runtime').then(module => module.createDoreumiRenderer(element, controller.signal, frame => latest.current.onMotionFrame?.(frame), stableFraming ? module.DOREUMI_STABLE_FRAMING : undefined)).then(async instance => {
      renderer = instance;
      if (controller.signal.aborted) { instance.dispose(); return; }
      runtime.current = instance;
      instance.setAction(latest.current.action); if (latest.current.facing) instance.setFacing(latest.current.facing); instance.setActive(latest.current.active); instance.setVisible(intersecting);
      instance.setLocomotionRate(latest.current.locomotionRate);
      if (latest.current.dress) void instance.setDress(latest.current.dress);
      else if (latest.current.outfit) instance.setSeason(latest.current.outfit);
      await instance.setExpression(latest.current.expression);
      if (!controller.signal.aborted) { setStatus('ready'); latest.current.onReady?.(); }
    }).catch(error => {
      renderer?.dispose(); if (runtime.current === renderer) runtime.current = null;
      if (!controller.signal.aborted) { setStatus('fallback'); console.warn('Doreumi uses the approved static fallback.', error); }
    });
    return () => {
      controller.abort(); observer.disconnect(); element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored);
      renderer?.dispose(); if (runtime.current === renderer) runtime.current = null;
    };
  }, [generation, stableFraming]);
  useEffect(() => { runtime.current?.setAction(action); if (facing) runtime.current?.setFacing(facing); }, [action, facing]);
  useEffect(() => { void runtime.current?.setExpression(expression).catch(() => undefined); }, [expression]);
  useEffect(() => { runtime.current?.setActive(active); }, [active]);
  useEffect(() => { runtime.current?.setLocomotionRate(locomotionRate); }, [locomotionRate]);
  useEffect(() => { if (outfit && !latest.current.dress) runtime.current?.setSeason(outfit); }, [outfit]);
  const dressId = dress ? dressKey(dress) : '';
  // Keyed by content, so a new object with the same items does not reload anything.
  useEffect(() => { if (latest.current.dress) void runtime.current?.setDress(latest.current.dress); }, [dressId]);
  return (
    <div className={className} data-doreumi-avatar={status} aria-hidden="true" style={{ position: 'relative', width: '100%', height: '100%', minWidth: 0, pointerEvents: 'none' }}>
      {/* The fallback is derived from the same approved triangles and neutral texture. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/doreumi/fallback.webp" alt="" width={512} height={506} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: status === 'ready' ? 0 : 1 }} />
      <canvas ref={canvas} style={stableFraming ? { position: 'absolute', display: 'block', top: `${-STABLE.top * 100}%`, left: `${-STABLE.side * 100}%`, width: `${(1 + 2 * STABLE.side) * 100}%`, height: `${(1 + STABLE.top + STABLE.bottom) * 100}%`, maxWidth: 'none', opacity: status === 'ready' ? 1 : 0 } : { display: 'block', width: '100%', height: '100%', opacity: status === 'ready' ? 1 : 0 }} />
    </div>
  );
});
