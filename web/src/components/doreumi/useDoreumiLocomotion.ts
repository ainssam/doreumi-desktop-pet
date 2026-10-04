"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { applyStepFrame, clampPosition, finishStep, homeWall, importedStageFits, restYAt, startExcursion, stepImportedStage, stepLocomotion, surfaceAt, wallX, type ImportedStageState, type Ledge, type MotionBounds, type MotionState, type LocomotionPhase, type WallSide } from "./locomotion";
import type { LedgeStyle } from "@/lib/doreumi/motion-ledge";
import type { DoreumiStageFrame, DoreumiStageHandler } from "@/lib/doreumi/motion-travel";
import type { LibraryMotion } from "@/lib/doreumi/motion-library";
import { stepEnvironmentAnchor, type EnvironmentAnchor } from "@/lib/doreumi/motion-environment-anchor";

type Options = {
  elementRef: RefObject<HTMLElement | null>; enabled: boolean; stageEnabled?: boolean; occupiedBottom: number; resetKey: string; onDragStart?: () => void; reducedMotion?: boolean;
  /** 휴대폰 홈 바닥 줄의 턱(링크 묶음). 있으면 위치마다 바닥 높이가 다르고 넘을 때 턱 넘기 동작을 한다. */
  ledges?: readonly Ledge[];
  /** 휴대폰이면 놓은 자리와 상관없이 오른쪽 자기 자리로 돌아간다(2026-10-01). */
  phone?: boolean;
  /** CSS 가 쉬는 자리를 그리는 바닥(화면 아래에서 상자 바닥까지의 거리), 벽마다. 턱 위에서 쉬면 턱 높이, 아니면 null(줄 바닥). */
  restBottoms?: { left: number | null; right: number | null };
  /** 개발용 확인: 턱 넘기 방식을 고정한다(운영에서는 쓰지 않는다). */
  forcedStyle?: LedgeStyle | null;
};
/** 호스트가 그릴 동작: 달리는 방향, 턱 넘기 동작·방향, 나들이 중 잠깐 하는 동작. */
export type LocomotionMotion = { heading: WallSide; stepAction: string | null; stepFacing: WallSide | "front-left" | "front-right" | null; pauseAction: string | null };
const sameMotion = (a: LocomotionMotion, b: LocomotionMotion) => a.heading === b.heading && a.stepAction === b.stepAction && a.stepFacing === b.stepFacing && a.pauseAction === b.pauseAction;
type Pointer = { id: number; target: HTMLElement; startX: number; startY: number; offsetX: number; offsetY: number; dragged: boolean };
export function useDoreumiLocomotion(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [phase, setPhase] = useState<LocomotionPhase>("idle"), [side, setSide] = useState<WallSide>("right");
  const [motion, setMotion] = useState<LocomotionMotion>({ heading: "right", stepAction: null, stepFacing: null, pauseAction: null });
  const publishedMotion = useRef<LocomotionMotion>({ heading: "right", stepAction: null, stepFacing: null, pauseAction: null });
  /** 끼어들기(대화·창·버거 메뉴)로 나들이·넘기가 멈췄다: 다시 움직일 수 있게 되면 자기 자리로 돌아간다. */
  const returnPending = useRef(false), lastResetKey = useRef(options.resetKey);
  const state = useRef<MotionState>({ x: 0, y: 0, vy: 0, elapsed: 0, phase: "idle", side: "right" });
  const published = useRef({ phase: "idle" as LocomotionPhase, side: "right" as WallSide });
  const pointer = useRef<Pointer | null>(null), frame = useRef<number | null>(null), last = useRef(0), suppress = useRef(false);
  const stage = useRef<ImportedStageState | null>(null), positioned = useRef(false);
  const cancelledStage = useRef<{ action: string; yaw: number } | null>(null);
  const environmentAnchor = useRef<EnvironmentAnchor | null>(null);
  /** A mouse resting on Doreumi while it runs home freezes the run in place (user direction 2026-09-26). */
  const held = useRef(false);
  /** 움직이는 동안 몸 상자 크기는 그대로다. 매 프레임 getBoundingClientRect 로 다시 재면 방금 쓴 위치 때문에 레이아웃을 강제로 다시 계산한다(#47 휴대폰 끊김).
   *  그래서 움직임을 시작할 때 한 번 재 두고 프레임 안에서는 그 값을 쓴다(reuse). 창 크기가 바뀌면 다시 잰다. */
  const boxSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => { const drop = () => { boxSize.current = null; }; window.addEventListener("resize", drop); return () => window.removeEventListener("resize", drop); }, []);
  const bounds = useCallback((reuse = false): MotionBounds => {
    let size = reuse ? boxSize.current : null;
    if (!size) {
      const rect = latest.current.elementRef.current?.getBoundingClientRect();
      size = { width: rect?.width || 116, height: rect?.height || 98 };
      boxSize.current = size;
    }
    const view = window.visualViewport;
    return { width: size.width, height: size.height, viewportWidth: window.innerWidth, viewportHeight: view ? view.height + view.offsetTop : window.innerHeight, occupiedBottom: latest.current.occupiedBottom, ledges: latest.current.ledges };
  }, []);
  const paint = useCallback(() => {
    const node = latest.current.elementRef.current;
    if (!node) return;
    node.style.setProperty("--doreumi-drag-x", `${state.current.x}px`);
    node.style.setProperty("--doreumi-drag-y", `${state.current.y}px`);
    node.dataset.locomotion = state.current.phase;
    const squash = state.current.phase === "stepping" ? state.current.squash : null;
    if (squash) { node.style.setProperty("--doreumi-squash-x", squash[0].toFixed(3)); node.style.setProperty("--doreumi-squash-y", squash[1].toFixed(3)); }
    else { node.style.removeProperty("--doreumi-squash-x"); node.style.removeProperty("--doreumi-squash-y"); }
    // 턱 위에 멈춰 선 채(나들이가 끼어들기로 멈춤) 쉬면 CSS 의 쉬는 자리 바닥을 턱 높이만큼 올린다.
    // 쉬는 자리 바닥(CSS)과 지금 자리 바닥의 차이. 턱 위면 올리고, 턱 사이 낮은 바닥이면 내린다(음수).
    // 매 프레임 레이아웃을 읽지 않게, 자리를 잡고 멈춰 선 경우에만 잰다.
    let lift = 0;
    if (state.current.phase === "idle" && positioned.current && latest.current.ledges?.length) {
      const b = bounds(true), restBottom = latest.current.restBottoms?.[state.current.side];
      const rest = restBottom !== null && restBottom !== undefined ? b.viewportHeight - restBottom : surfaceAt(-1e6, { ...b, ledges: [] });
      lift = rest - surfaceAt(state.current.x + b.width / 2, b);
    }
    if (Math.abs(lift) > .5) node.style.setProperty("--doreumi-ledge-lift", `${Math.round(lift)}px`); else node.style.removeProperty("--doreumi-ledge-lift");
    if (published.current.phase !== state.current.phase) setPhase(state.current.phase);
    if (published.current.side !== state.current.side) setSide(state.current.side);
    published.current = { phase: state.current.phase, side: state.current.side };
    const current = state.current, plan = current.step?.plan;
    const nextMotion: LocomotionMotion = {
      heading: current.heading ?? current.side,
      stepAction: current.phase === "stepping" && plan ? plan.motion.action : null,
      // 점프는 진행 방향으로 반쯤 돌아 팔을 번쩍 드는 모습이 보이게, 나머지 넘기는 옆모습.
      stepFacing: current.phase === "stepping" && plan ? plan.motion.jump ? (plan.dir > 0 ? "front-right" : "front-left") : (plan.dir > 0 ? "right" : "left") : null,
      pauseAction: current.phase === "pausing" ? current.excursion?.pauseAction ?? null : null,
    };
    if (!sameMotion(publishedMotion.current, nextMotion)) { publishedMotion.current = nextMotion; setMotion(nextMotion); }
  }, [bounds]);
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
    if (state.current.phase === "stepping") {
      // 턱 넘기: 그 동작의 재생 시계로 자리를 정한다(프레임이 밀리거나 동작을 늦게 불러와도 어긋나지 않는다).
      if (!sample.paused) { state.current = applyStepFrame(state.current, sample.action, sample.time, sample.pixelsPerUnit, bounds(true)); paint(); }
      return;
    }
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
    // Refresh at motion entry; its subsequent frames keep the same body box.
    // Re-reading after a position write forces the entire mobile page to lay out.
    const stageBounds = bounds(stage.current?.action === sample.action);
    const result = stepImportedStage(stage.current, sample, stageBounds, positioned.current ? state.current.x : node.getBoundingClientRect().left);
    stage.current = result.state;
    if (result.state && !sample.paused) {
      state.current.x = result.state.x; positioned.current = true;
      node.style.setProperty("--doreumi-rest-x", `${result.state.x}px`);
      if (result.state.blocked) node.removeAttribute("data-stage-moving"); else node.dataset.stageMoving = sample.action;
      const nextSide = homeWall(result.state.x, stageBounds, latest.current.phone); state.current.side = nextSide;
      if (published.current.side !== nextSide) { published.current.side = nextSide; setSide(nextSide); }
    }
    return result.decision;
  }, [bounds, paint, stopStage]);
  const reset = useCallback((markReturn = true) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; held.current = false; releaseCapture(); stopStage();
    const b = bounds(), away = state.current.phase !== "idle" && state.current.phase !== "dragged" && Boolean(state.current.excursion || state.current.step || state.current.pendingStep);
    if (state.current.phase === "stepping") state.current = finishStep(state.current, b, false);
    if (away && markReturn && b.ledges?.length) {
      // 나들이·넘기 도중 멈췄다: 그 자리(턱 위면 턱 위)에 서 있다가, 다시 움직일 수 있게 되면 자기 자리로 돌아간다.
      returnPending.current = true; positioned.current = true;
      state.current = { ...state.current, y: restYAt(state.current.x, b) };
      latest.current.elementRef.current?.style.setProperty("--doreumi-rest-x", `${state.current.x}px`);
    }
    state.current = { ...state.current, phase: "idle", vy: 0, elapsed: 0, step: null, pendingStep: null, excursion: null, targetX: null, heading: undefined }; paint();
  }, [bounds, paint, releaseCapture, stopStage]);
  const animate = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    last.current = performance.now();
    bounds(); // 움직임을 시작할 때 몸 상자를 한 번 잰다(프레임 안에서는 다시 재지 않는다).
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = (time: number) => {
      frame.current = null;
      const reduced = latest.current.reducedMotion ?? reducedQuery.matches;
      if (!(held.current && state.current.phase === "running")) state.current = stepLocomotion(state.current, time - last.current, bounds(true), reduced, { forcedStyle: latest.current.forcedStyle });
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
    const b = bounds(), gap = restYAt(state.current.x, b) - state.current.y;
    state.current = { ...state.current, phase: "falling", vy: gap < 56 ? -520 : 0, elapsed: 0, side: homeWall(state.current.x, b, latest.current.phone), targetX: null, heading: undefined, excursion: null, step: null, pendingStep: null };
    returnPending.current = false;
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
    // 나들이·넘기 도중이면 그 자리에 붙박지 않고 끼어들기로 처리한다(대화창을 닫으면 자기 자리로 돌아간다).
    if (latest.current.ledges?.length && (state.current.excursion || state.current.step || state.current.pendingStep)) { reset(); return; }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; held.current = false;
    latest.current.elementRef.current?.style.setProperty("--doreumi-rest-x", `${state.current.x}px`); positioned.current = true;
    state.current = { ...state.current, phase: "idle", vy: 0, elapsed: 0 }; paint();
  }, [paint, reset]);
  const consumeClick = useCallback(() => { if (!suppress.current) return false; suppress.current = false; return true; }, []);
  /** 쉬던 자리 표시를 잊는다. 대화창 안의 링크로 화면을 옮겨 대화창이 닫힐 때 옛 자리 대신 자기 자리(벽)로 달려가게 한다(#83). */
  const forgetRest = useCallback(() => {
    if (state.current.phase !== "idle") return;
    returnPending.current = false; positioned.current = false;
    latest.current.elementRef.current?.style.removeProperty("--doreumi-rest-x");
    // 턱 위에 서 있던 높이(--doreumi-ledge-lift)도 함께 지운다(다시 그려야 지워진다, 재검증 N2).
    paint();
  }, [paint]);
  /** 휴대폰 홈 바닥 줄에서 가끔 턱 위로 올라가 놀다 내려온다(사용자 결정 2026-10-01). 시작하면 true. */
  /**
   * 끼어들기(대화창·다른 앱·메뉴)로 나들이·넘기가 멈췄으면, 다시 자유로워졌을 때 자기 자리로 돌아간다(턱 넘기 포함).
   * 이 판단은 여기 한 곳에서만 한다. 대화창이 열려 있거나(stageEnabled=false) 끌고 있으면 기다린다.
   */
  const resumeHome = useCallback(() => {
    if (!returnPending.current || !latest.current.enabled || latest.current.stageEnabled === false || pointer.current || frame.current !== null) return false;
    returnPending.current = false;
    const b = bounds(), side: WallSide = latest.current.phone ? "right" : state.current.side;
    positioned.current = false; latest.current.elementRef.current?.style.removeProperty("--doreumi-rest-x");
    const onLedge = b.ledges?.some(ledge => state.current.x + b.width / 2 >= ledge.left && state.current.x + b.width / 2 <= ledge.right);
    if (!onLedge && Math.abs(state.current.x - wallX(side, b)) <= 1) { state.current = { ...state.current, side }; paint(); return false; }
    state.current = { ...state.current, y: restYAt(state.current.x, b), side, phase: "running", elapsed: 0 };
    paint(); animate();
    return true;
  }, [animate, bounds, paint]);
  /** 대화창이 탭 아닌 길(키보드·추천 열기·뒤로 가기 복원)로 열려도 나들이·넘기를 멈춘다. */
  const interrupt = useCallback(() => {
    const current = state.current;
    if (current.phase !== "idle" && current.phase !== "dragged" && (current.excursion || current.step || current.pendingStep)) reset();
  }, [reset]);
  const excursion = useCallback(() => {
    if (returnPending.current) return resumeHome();
    if (!latest.current.enabled || pointer.current || frame.current !== null) return false;
    const reduced = latest.current.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return false;
    const node = latest.current.elementRef.current, b = bounds();
    if (!node || !b.ledges?.length) return false;
    const rect = node.getBoundingClientRect();
    const from = positioned.current ? state.current.x : rect.left;
    const next = startExcursion({ ...state.current, x: from, y: restYAt(from, b), side: "right" }, b);
    if (!next) return false;
    stopStage(); positioned.current = false; node.style.removeProperty("--doreumi-rest-x");
    state.current = next; paint(); animate();
    return true;
  }, [animate, bounds, paint, resumeHome, stopStage]);
  useEffect(() => {
    const keyChanged = lastResetKey.current !== options.resetKey;
    lastResetKey.current = options.resetKey;
    if (keyChanged) {
      // 다른 화면으로 옮겼다: 옛 화면의 나들이 자리를 이어 가지 않고 자기 자리로 돌아간다.
      // 먼저 자리 표시를 지운 뒤 다시 그린다(그 반대면 옛 화면 턱 높이만큼 떠 있게 된다).
      // 쉬던 자리가 벽이 아니었으면 그 자리에서 달려서 돌아간다. 자리 표시만 지우면 쉬는 자리로 순간 이동하거나
      // (예전에는 CSS 전환 때문에) 미끄러져 돌아갔다(2026-10-03 #83 "슬라이드되면서 원위치로").
      const node = latest.current.elementRef.current, from = node?.getBoundingClientRect();
      const before = state.current.phase;
      const away = positioned.current || before !== "idle";
      returnPending.current = false;
      // 끌고 있던 중이면 끌기를 그대로 잇는다. 놓으면 finish() 가 새 화면 기준으로 떨어뜨리고 달려 보낸다(검증 F3).
      if (pointer.current) { positioned.current = false; node?.style.removeProperty("--doreumi-rest-x"); return; }
      const b = bounds(), x = from ? clampPosition(from.left, 0, b).x : state.current.x;
      // 대화창이 열려 있거나 대화창 쪽으로 달려가는 중이면(stageEnabled=false) 지금 자리를 쉬는 자리로 잡아 두고,
      // 자유로워지면 resumeHome 이 달려서 데려간다. 여기서 바로 달리면 대화창 쪽 달리기와 겹친다(검증 F1).
      // 자리 표시를 지워 버리면 데스크톱(열린 상태에서도 쉬는 자리가 left 를 정한다)은 벽으로 순간 이동한다(재검증 N1).
      if (latest.current.stageEnabled === false) {
        reset(false);
        if (from && away) {
          state.current = { ...state.current, x, y: restYAt(x, { ...b, ledges: [] }) };
          positioned.current = true; returnPending.current = true;
          node?.style.setProperty("--doreumi-rest-x", `${x}px`);
        } else { positioned.current = false; node?.style.removeProperty("--doreumi-rest-x"); }
        paint();
        return;
      }
      positioned.current = false;
      node?.style.removeProperty("--doreumi-rest-x");
      reset(false);
      const reduced = latest.current.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (from && away && !reduced && latest.current.enabled) {
        // 새 화면의 턱(바닥 줄 링크 묶음)은 다시 재기 전에는 넘겨받지 않는다(DoreumiHost 가 화면별로 거른다). 첫 자리도 턱 없이 잡는다(검증 F4).
        const side: WallSide = homeWall(from.left, b, latest.current.phone);
        if (before === "falling" || before === "stepping") {
          // 공중에 있던 도름이는 바닥으로 순간 이동하지 않고 그 높이에서 떨어진 뒤 달려간다(검증 F3).
          state.current = { ...state.current, ...clampPosition(from.left, from.top, b), vy: 0, side, phase: "falling", elapsed: 0, targetX: null, heading: undefined };
          paint(); animate();
        } else if (Math.abs(x - wallX(side, b)) > 1) {
          state.current = { ...state.current, x, y: restYAt(x, { ...b, ledges: [] }), vy: 0, side, phase: "running", elapsed: 0, targetX: null, heading: undefined };
          paint(); animate();
        }
      }
      return;
    }
    reset();
    resumeHome();
  }, [options.enabled, options.resetKey, reset, resumeHome, animate, bounds, paint]);
  // 대화창을 닫고 제자리로 돌아오면(stageEnabled 가 다시 켜짐) 멈춰 있던 귀가를 잇는다.
  useEffect(() => { if (options.stageEnabled !== false) resumeHome(); }, [options.stageEnabled, resumeHome]);
  // 넓은 창에서 왼쪽에 쉬던 도름이가 창이 좁아져 턱(링크 묶음) 위에 놓이면 자기 자리로 간다.
  const ledgeKey = options.ledges?.map(ledge => `${ledge.left},${ledge.right},${ledge.top}`).join("|") ?? "";
  useEffect(() => {
    if (!ledgeKey || state.current.phase !== "idle" || pointer.current || frame.current !== null) return;
    const node = latest.current.elementRef.current;
    if (!node) return;
    const b = bounds(), x = positioned.current ? state.current.x : node.getBoundingClientRect().left, center = x + b.width / 2;
    if (!b.ledges?.some(ledge => center >= ledge.left && center <= ledge.right)) return;
    returnPending.current = true; state.current = { ...state.current, x };
    resumeHome();
  }, [ledgeKey, bounds, resumeHome]);
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
    // 다른 앱·탭에서 돌아오면 멈춰 있던 귀가를 잇는다.
    const visibility = () => { if (document.hidden) cancel(); else resumeHome(); };
    const focus = () => resumeHome();
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("blur", cancel); window.addEventListener("pagehide", cancel); document.addEventListener("visibilitychange", visibility); window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("blur", cancel); window.removeEventListener("pagehide", cancel); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", focus);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      releaseCapture();
    };
  }, [bounds, paint, releaseCapture, reset, resumeHome]);
  return { phase, side, motion, excursion, interrupt, reset, hold, settleHere, consumeClick, forgetRest, onMotionFrame, canPlayMotion, pointerHandlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd } };
}
