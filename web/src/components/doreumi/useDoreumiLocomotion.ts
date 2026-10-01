"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clampPosition, floorY, importedStageFits, nearestWall, stepImportedStage, stepLocomotion, type ImportedStageState, type MotionBounds, type MotionState, type LocomotionPhase, type WallSide } from "./locomotion";
import type { DoreumiStageFrame, DoreumiStageHandler } from "@/lib/doreumi/motion-travel";
import type { LibraryMotion } from "@/lib/doreumi/motion-library";
import { stepEnvironmentAnchor, type EnvironmentAnchor } from "@/lib/doreumi/motion-environment-anchor";

type Options = { elementRef: RefObject<HTMLElement | null>; enabled: boolean; stageEnabled?: boolean; occupiedBottom: number; resetKey: string; onDragStart?: () => void; reducedMotion?: boolean };
type Pointer = { id: number; target: HTMLElement; startX: number; startY: number; offsetX: number; offsetY: number; dragged: boolean };
export function useDoreumiLocomotion(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [phase, setPhase] = useState<LocomotionPhase>("idle"), [side, setSide] = useState<WallSide>("right");
  const state = useRef<MotionState>({ x: 0, y: 0, vy: 0, elapsed: 0, phase: "idle", side: "right" });
  const published = useRef({ phase: "idle" as LocomotionPhase, side: "right" as WallSide });
  const pointer = useRef<Pointer | null>(null), frame = useRef<number | null>(null), last = useRef(0), suppress = useRef(false);
  const stage = useRef<ImportedStageState | null>(null), positioned = useRef(false);
  const cancelledStage = useRef<{ action: string; yaw: number } | null>(null);
  const environmentAnchor = useRef<EnvironmentAnchor | null>(null);
  /** A mouse resting on Doreumi while it runs home freezes the run in place (user direction 2026-09-26). */
  const held = useRef(false);
  const bounds = useCallback((): MotionBounds => {
    const rect = latest.current.elementRef.current?.getBoundingClientRect();
    const view = window.visualViewport;
    return { width: rect?.width || 116, height: rect?.height || 98, viewportWidth: window.innerWidth, viewportHeight: view ? view.height + view.offsetTop : window.innerHeight, occupiedBottom: latest.current.occupiedBottom };
  }, []);
  const paint = useCallback(() => {
    const node = latest.current.elementRef.current;
    if (!node) return;
    node.style.setProperty("--doreumi-drag-x", `${state.current.x}px`);
    node.style.setProperty("--doreumi-drag-y", `${state.current.y}px`);
    node.dataset.locomotion = state.current.phase;
    if (published.current.phase !== state.current.phase) setPhase(state.current.phase);
    if (published.current.side !== state.current.side) setSide(state.current.side);
    published.current = { phase: state.current.phase, side: state.current.side };
  }, []);
  const canPlayMotion = useCallback((motion: LibraryMotion) => {
    if (!motion.travel) return true;
    const node = latest.current.elementRef.current, canvas = node?.querySelector('canvas');
    if (!node || !canvas) return false;
    // Measure the avatar box, not the canvas: with stable framing the canvas overflows the box, and the
    // camera keeps the standing scale (box height / 2.68) for every motion.
    const rect = (canvas.parentElement ?? canvas).getBoundingClientRect();
    const halfHeight = Math.max(motion.frame?.halfHeight ?? 1.34, (motion.frame?.halfHeight ?? 1.34) / Math.max(.1, rect.width / rect.height));
    // Use the larger scale while the camera blends from its resting frame.
    const pixelsPerUnit = rect.height / (2 * Math.min(1.34, halfHeight));
    return importedStageFits(motion.travel, node.getBoundingClientRect().left, bounds(), pixelsPerUnit);
  }, [bounds]);
  const releaseCapture = useCallback(() => {
    const held = pointer.current; pointer.current = null;
    if (held?.target.hasPointerCapture(held.id)) held.target.releasePointerCapture(held.id);
  }, []);
  const stopStage = useCallback(() => {
    if (stage.current) cancelledStage.current = { action: stage.current.action, yaw: stage.current.yaw };
    stage.current = null;
    latest.current.elementRef.current?.removeAttribute("data-stage-moving");
  }, []);
  const onMotionFrame = useCallback<DoreumiStageHandler>((sample: DoreumiStageFrame) => {
    const node = latest.current.elementRef.current;
    if (!node) return;
    if (cancelledStage.current && cancelledStage.current.action !== sample.action) cancelledStage.current = null;
    if (cancelledStage.current?.action === sample.action) return { yaw: cancelledStage.current.yaw, stop: true };
    const reduced = latest.current.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (sample.fixedEnvironment) {
      const rect = node.getBoundingClientRect();
      environmentAnchor.current = stepEnvironmentAnchor(environmentAnchor.current, sample.action, rect.left, rect.top,
        latest.current.enabled && latest.current.stageEnabled !== false && !reduced && !pointer.current && state.current.phase === "idle");
      stage.current = null; node.removeAttribute("data-stage-moving");
      return environmentAnchor.current?.cancelled ? { yaw: 0, stop: true } : undefined;
    }
    environmentAnchor.current = null;
    if (!latest.current.enabled || latest.current.stageEnabled === false || reduced || pointer.current || state.current.phase !== "idle") { const activeStage = stage.current; stopStage(); return activeStage ? { yaw: activeStage.yaw, stop: true } : undefined; }
    if (!sample.travel || !sample.action.startsWith("meshy:")) { stage.current = null; node.removeAttribute("data-stage-moving"); return; }
    const result = stepImportedStage(stage.current, sample, bounds(), positioned.current ? state.current.x : node.getBoundingClientRect().left);
    stage.current = result.state;
    if (result.state && !sample.paused) {
      state.current.x = result.state.x; positioned.current = true;
      node.style.setProperty("--doreumi-rest-x", `${result.state.x}px`);
      if (result.state.blocked) node.removeAttribute("data-stage-moving"); else node.dataset.stageMoving = sample.action;
      const nextSide = nearestWall(result.state.x, bounds()); state.current.side = nextSide;
      if (published.current.side !== nextSide) { published.current.side = nextSide; setSide(nextSide); }
    }
    return result.decision;
  }, [bounds, stopStage]);
  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; held.current = false; releaseCapture(); stopStage();
    state.current = { ...state.current, phase: "idle", vy: 0, elapsed: 0 }; paint();
  }, [paint, releaseCapture, stopStage]);
  const animate = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    last.current = performance.now();
    const tick = (time: number) => {
      frame.current = null;
      const reduced = latest.current.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!(held.current && state.current.phase === "running")) state.current = stepLocomotion(state.current, time - last.current, bounds(), reduced);
      if (state.current.phase === "idle") { positioned.current = false; latest.current.elementRef.current?.style.removeProperty("--doreumi-rest-x"); }
      last.current = time; paint();
      if (state.current.phase !== "idle") frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [bounds, paint]);
  const finish = useCallback(() => {
    const held = pointer.current;
    if (!held) return;
    releaseCapture();
    if (!held.dragged) { reset(); return; }
    suppress.current = true;
    // Let go near the floor and Doreumi still hops up a little and lands, so every drop reads as
    // fall → landing → run instead of sliding off in whatever pose it was held (user direction 2026-09-26).
    const gap = floorY(bounds()) - state.current.y;
    state.current = { ...state.current, phase: "falling", vy: gap < 56 ? -520 : 0, elapsed: 0, side: nearestWall(state.current.x, bounds()) };
    paint(); animate();
  }, [animate, bounds, paint, releaseCapture, reset]);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!latest.current.enabled || !event.isPrimary || event.button !== 0 || pointer.current) return;
    const rect = latest.current.elementRef.current?.getBoundingClientRect();
    if (!rect) return;
    // A new intentional interaction must not inherit the previous drag's click guard.
    suppress.current = false;
    stopStage();
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    state.current = { ...state.current, x: rect.left, y: rect.top, vy: 0 };
    pointer.current = { id: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, dragged: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [stopStage]);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const held = pointer.current;
    if (!held || event.pointerId !== held.id) return;
    if (event.buttons === 0) { finish(); return; }
    if (!held.dragged) {
      if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < 6) return;
      held.dragged = true; suppress.current = true; latest.current.onDragStart?.();
      positioned.current = false; latest.current.elementRef.current?.style.removeProperty("--doreumi-rest-x");
    }
    event.preventDefault();
    state.current = { ...state.current, ...clampPosition(event.clientX - held.offsetX, event.clientY - held.offsetY, bounds()), phase: "dragged" };
    paint();
  }, [bounds, finish, paint]);
  const onPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => { if (event.pointerId === pointer.current?.id) finish(); }, [finish]);
  const hold = useCallback((value: boolean) => { held.current = value; }, []);
  /** Stop wherever Doreumi is now and treat that spot as its resting place (the chat then runs it on from here). */
  const settleHere = useCallback(() => {
    if (state.current.phase === "idle") return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; held.current = false;
    latest.current.elementRef.current?.style.setProperty("--doreumi-rest-x", `${state.current.x}px`); positioned.current = true;
    state.current = { ...state.current, phase: "idle", vy: 0, elapsed: 0 }; paint();
  }, [paint]);
  const consumeClick = useCallback(() => { if (!suppress.current) return false; suppress.current = false; return true; }, []);
  useEffect(() => { reset(); }, [options.enabled, options.resetKey, reset]);
  useEffect(() => { if (options.stageEnabled === false) stopStage(); }, [options.stageEnabled, stopStage]);
  useEffect(() => {
    if (state.current.phase !== "idle") {
      state.current = { ...state.current, ...clampPosition(state.current.x, state.current.y, bounds()) };
      paint();
    }
  }, [options.occupiedBottom, bounds, paint]);
  useEffect(() => {
    const resize = () => {
      if (state.current.phase !== "idle") { state.current = { ...state.current, ...clampPosition(state.current.x, state.current.y, bounds()) }; paint(); }
      else if (positioned.current) { state.current.x = clampPosition(state.current.x, 0, bounds()).x; latest.current.elementRef.current?.style.setProperty("--doreumi-rest-x", `${state.current.x}px`); }
    };
    const cancel = () => { if (pointer.current?.dragged) suppress.current = true; reset(); };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("blur", cancel); window.addEventListener("pagehide", cancel); document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancel); window.removeEventListener("pagehide", cancel); document.removeEventListener("visibilitychange", visibility);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      releaseCapture();
    };
  }, [bounds, paint, releaseCapture, reset]);
  return { phase, side, reset, hold, settleHere, consumeClick, onMotionFrame, canPlayMotion, pointerHandlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd } };
}
