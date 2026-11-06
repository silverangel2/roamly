/**
 * BoardUI Sheet — Roamly foundation primitive (Container Rules pass,
 * 2026-11-03; Apply-All Sweep, 2026-11-03; iPhone-Feel pass,
 * 2026-11-04; owner rules in ~/AGENTS.md "CONTAINER RULES — SHEET /
 * MODAL / DRAWER" + "IPHONE FEEL — 6 INVISIBLE DETAILS").
 *
 * The one overlay shell for sheet-class surfaces. What it implements:
 *
 * - Rule 1 (container by task): this primitive is the SHEET. Full-stop
 *   confirms (delete, irreversible commits) stay modals and do NOT use
 *   it; forms and asks that belong over the page do.
 * - Rule 2 (three snap points only): `snap` is "peek" (summary,
 *   38dvh), "half" (form — content height, capped at 88dvh), or
 *   "full" (long content, whole viewport). No arbitrary heights: the
 *   panel's height comes only from these three classes. Adopters
 *   today use "half"; the plan flow embodies "full" as a page by
 *   design and is deliberately not rebuilt on this primitive.
 * - Rule 3 (velocity dismiss — BUILT, Apply-All Sweep 2026-11-03):
 *   the grab handle is a drag zone (pointer events, `touch-action:
 *   none`). The drag contract, exactly as the rule states it:
 *     · a quick downward flick — release velocity at or above
 *       FLICK_VELOCITY_PX_PER_MS (0.5 px/ms, measured over the last
 *       ~120 ms of the drag) — closes the sheet from ANY position,
 *       even a few pixels down;
 *     · a slow drag released past HALF the panel's height closes;
 *     · anything else settles back to the sheet's snap point.
 * - iPhone-feel physics (2026-11-04) — the settle is a real SPRING
 *   (components/boardui/spring.ts: damped oscillator, ζ = 0.8,
 *   ~1.5% overshoot), never a timer or an ease:
 *     · MOMENTUM: the release velocity becomes the spring's initial
 *       velocity, so a released sheet first carries past the
 *       finger's last position, decelerating gradually, before the
 *       spring brings it home — the close/spring-back DECISION is
 *       still made at release from position + velocity exactly as
 *       the sweep's measurements specify; only the travel is
 *       physical now.
 *     · RUBBER BAND: dragging UP past the snap (or pulling a locked
 *       sheet) no longer hits a hard clamp — travel follows the
 *       resistance curve pull·K/(pull+K): with K = 151 an upward
 *       200 px pull stretches the panel 86 px, then release springs
 *       it back. Locked sheets (dismissible={false}, no onClose)
 *       use a tighter constant (K = 110) and ALWAYS spring back:
 *       a gesture can never dismiss what the buttons cannot.
 *     · INTERRUPTIBLE: a grab during a settle or a close-out
 *       cancels the spring and retakes the sheet from its CURRENT
 *       position (the drag origin shifts by the live offset), and
 *       a pending close is cancelled with it — onClose fires only
 *       when a close spring actually arrives. Input is never
 *       locked waiting for an animation.
 *     · Reduced motion: the spring lands instantly (see spring.ts);
 *       drags still follow the finger, releases settle at once.
 *   Dragging between peek/half/full by gesture would need height
 *   morphing between the snap classes and no adopter presents more
 *   than one snap — recorded, not faked.
 *   DESKTOP SCOPE: gestures engage only below the lg breakpoint —
 *   on desktop the panel is the rule-4 drawer, which keeps its
 *   explicit Close/scrim dismissal. A horizontal drawer drag is a
 *   different gesture family (and the drawer's adopters are forms
 *   mid-typing); phone-first is the honest scope, recorded here.
 * - Rule 4 (desktop = side drawer): at lg the panel leaves the bottom
 *   edge and becomes a right-side drawer — `w-[40vw]` with
 *   `min-w-[320px]` (forms never break) and `max-w-[560px]` (it never
 *   becomes a page); the page behind stays visible and readable
 *   beside it, under the same scrim the mobile sheet uses.
 * - Rule 5 (never stack): the primitive renders exactly one panel;
 *   going deeper is the adopter's job via replace-content + a back
 *   arrow inside the same sheet, never a second BuiSheet.
 * - Continuous corners (iPhone-feel rule 6): the panel carries
 *   `.bui-squircle` — squircle corner-shape where supported, plain
 *   radius elsewhere.
 * - Momentum scrolling (rule 3 of the physics set): the panel is a
 *   `.bui-momentum` scroll surface — native touch momentum on,
 *   overscroll contained at the sheet.
 *
 * Craft: BoardUI sheet family (BoardUI/boardui, MIT) — grab handle,
 * top-rounded panel, hairline edge, soft upward shadow — on Roamly
 * tokens (white surface, #DCE5F0 hairline, navy-slate scrim, never
 * black). Entrance is the house `.bui-enter` settle; it is dropped
 * the moment a drag starts (its fill-mode keyframes own `transform`
 * and would fight the drag's inline transform). During drags and
 * springs the panel's transform is written directly to the DOM by
 * the gesture/spring code (no React re-render per frame).
 */
"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { animateSpringValue, rubberBand, type BuiSpringHandle } from "./spring";
import { cx } from "./cx";

export type BuiSheetSnap = "peek" | "half" | "full";

/** Rule 3: release velocity at/above this (px/ms, downward) is a
 *  flick — it closes the sheet from any drag position. */
const FLICK_VELOCITY_PX_PER_MS = 0.5;
/** Velocity is measured over the trailing window of the drag, so a
 *  fast finish counts even after a slow start (and vice versa). */
const VELOCITY_WINDOW_MS = 120;
/** Rubber-band constants (spring.ts curve): upward overscroll past
 *  the snap stretches 86px on a 200px pull; locked sheets resist
 *  harder and over a shorter leash. */
const RUBBER_UP_K = 151;
const RUBBER_LOCKED_K = 110;
/** Sheet spring: stiffer than the foundation default — a 200px
 *  panel should settle in ~300ms. ζ stays the owner's 0.8. */
const SHEET_SPRING = { stiffness: 300, dampingRatio: 0.8 } as const;

const snapClasses: Record<BuiSheetSnap, string> = {
  peek: "h-[38dvh] rounded-t-bui-panel",
  half: "max-h-[88dvh] rounded-t-bui-panel",
  full: "top-0 h-full border-0"
};

/* Desktop drawer (rule 4): right edge, full height, 40vw wide with a
 * 320px floor and a 560px ceiling, square right corners, left-rounded
 * panel edge, shadow cast leftward. Applies over every snap: on
 * desktop a sheet IS a drawer. */
const drawerClasses =
  "lg:inset-x-auto lg:left-auto lg:right-0 lg:top-0 lg:bottom-0 lg:h-auto lg:max-h-none lg:w-[40vw] lg:min-w-[320px] lg:max-w-[560px] lg:rounded-none lg:rounded-l-bui-panel lg:border-y-0 lg:border-r-0 lg:shadow-[-12px_0_34px_rgba(8,44,32,0.22)]";

export interface BuiSheetProps {
  /** Accessible name for the dialog (use `labelledBy` when a visible
   *  heading inside the sheet already names it). */
  label?: string;
  labelledBy?: string;
  /** Stable measurement hook, carried over from the gate sheets. */
  measure?: string;
  snap?: BuiSheetSnap;
  /** When true (default) and `onClose` is given, tapping the scrim
   *  dismisses. Gate sheets pass false: they close only through their
   *  own explicit controls. */
  dismissible?: boolean;
  onClose?: () => void;
  /** Scrim overrides (e.g. the ink/55 blur the email sheet shipped
   *  with). Defaults to the gate sheets' navy-slate scrim. */
  backdropClassName?: string;
  /** Grab handle on the mobile sheet; hidden in drawer form. */
  handle?: boolean;
  /** Panel extras — padding and surface specifics stay the adopter's. */
  className?: string;
  children: ReactNode;
}

interface DragSample {
  y: number;
  t: number;
}

export function BuiSheet({
  label,
  labelledBy,
  measure,
  snap = "half",
  dismissible = true,
  onClose,
  backdropClassName,
  handle = true,
  className,
  children
}: BuiSheetProps) {
  const canDismiss = dismissible && typeof onClose === "function";
  const panelRef = useRef<HTMLElement | null>(null);
  const samplesRef = useRef<DragSample[]>([]);
  const startYRef = useRef(0);
  const panelHeightRef = useRef(0);
  /* Live drag/spring offset in px (positive = pulled down). Owned
   * by refs, not state: frames must not re-render React. */
  const offsetRef = useRef(0);
  const springRef = useRef<BuiSpringHandle | null>(null);
  const [dragging, setDragging] = useState(false);
  /* The .bui-enter entrance owns `transform` via fill-mode
   * keyframes; the first grab drops the class so the drag's inline
   * transform is the only voice. */
  const [interacted, setInteracted] = useState(false);

  useEffect(
    () => () => {
      springRef.current?.cancel();
      springRef.current = null;
    },
    []
  );

  function applyOffset(next: number) {
    offsetRef.current = next;
    const panel = panelRef.current;
    if (panel) {
      panel.style.transform = next !== 0 ? `translateY(${next}px)` : "";
    }
  }

  function cancelSpring() {
    springRef.current?.cancel();
    springRef.current = null;
  }

  /** Settle on the spring. The release velocity (px/ms) becomes the
   *  spring's initial velocity (px/s) — momentum carries the panel
   *  past the release point before it settles. `arrive` runs only
   *  if this spring actually reaches its target (a grab cancels
   *  it, and with it a pending close). */
  function springTo(target: number, velocityPxPerMs: number, arrive?: () => void) {
    cancelSpring();
    springRef.current = animateSpringValue({
      from: offsetRef.current,
      to: target,
      velocity: velocityPxPerMs * 1000,
      stiffness: SHEET_SPRING.stiffness,
      dampingRatio: SHEET_SPRING.dampingRatio,
      restDelta: target === 0 ? 0.4 : 1.5,
      restVelocity: target === 0 ? 12 : 60,
      onFrame: (value) => applyOffset(value),
      onRest: () => {
        springRef.current = null;
        applyOffset(target);
        arrive?.();
      }
    });
  }

  function releaseVelocity(samples: DragSample[], endY: number, endT: number) {
    const windowStart = endT - VELOCITY_WINDOW_MS;
    const first = samples.find((sample) => sample.t >= windowStart) ?? samples[0];
    if (!first) return 0;
    const dt = endT - first.t;
    if (dt <= 0) return 0;
    return (endY - first.y) / dt;
  }

  function onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    /* Desktop: the panel is the rule-4 drawer — no bottom-sheet
     * drag there (see header). lg = 1024px in this tree's config. */
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) return;
    /* Capture keeps the move stream flowing if the finger drifts
     * off the handle strip; it is an optimisation, never a gate —
     * a pointer that cannot be captured must not kill the gesture. */
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone or not capturable — drag on without it.
    }
    /* Interruptibility: grabbing mid-settle or mid-close retakes
     * the sheet from its current offset; cancelling the spring
     * cancels a pending close with it. */
    cancelSpring();
    setInteracted(true);
    setDragging(true);
    /* The drag origin shifts by the live offset, so the panel
     * stays exactly under the finger where the grab caught it. */
    startYRef.current = event.clientY - offsetRef.current;
    panelHeightRef.current = panelRef.current?.offsetHeight ?? 0;
    samplesRef.current = [{ y: event.clientY, t: performance.now() }];
  }

  function onHandlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const now = performance.now();
    samplesRef.current = [...samplesRef.current.filter((sample) => now - sample.t <= 300), { y: event.clientY, t: now }];
    const raw = event.clientY - startYRef.current;
    if (raw >= 0) {
      /* Down: dismissible sheets travel freely; locked sheets
       * rubber-band (and will always spring back). */
      applyOffset(canDismiss ? raw : rubberBand(raw, RUBBER_LOCKED_K));
    } else {
      /* Up past the snap: rubber-band overscroll — the stretch
       * itself signals the edge. */
      applyOffset(-rubberBand(-raw, RUBBER_UP_K));
    }
  }

  function onHandlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    const now = performance.now();
    const velocity = releaseVelocity(samplesRef.current, event.clientY, now);
    samplesRef.current = [];
    const offset = offsetRef.current;
    if (canDismiss && velocity >= FLICK_VELOCITY_PX_PER_MS) {
      springTo(panelHeightRef.current || offset, velocity, () => onClose?.());
      return;
    }
    if (canDismiss && offset > panelHeightRef.current / 2) {
      springTo(panelHeightRef.current || offset, velocity, () => onClose?.());
      return;
    }
    springTo(0, velocity);
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      <div
        aria-hidden="true"
        onClick={canDismiss ? onClose : undefined}
        className={cx("absolute inset-0 bg-[rgba(10,28,21,0.34)]", backdropClassName)}
      />
      <section
        ref={panelRef}
        data-measure={measure}
        data-bui-sheet=""
        data-bui-sheet-snap={snap}
        data-bui-sheet-dragging={dragging ? "true" : undefined}
        className={cx(
          interacted ? undefined : "bui-enter",
          "bui-squircle bui-momentum absolute inset-x-0 bottom-0 overflow-y-auto border border-chair bg-white shadow-[0_-12px_34px_rgba(8,44,32,0.22)]",
          snapClasses[snap],
          drawerClasses,
          className
        )}
      >
        {handle ? (
          <div
            aria-hidden="true"
            data-bui-sheet-handle=""
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerEnd}
            onPointerCancel={onHandlePointerEnd}
            className="mx-auto -mt-1 w-fit cursor-grab touch-none px-8 pb-3 pt-2 active:cursor-grabbing lg:hidden"
          >
            <div className="h-[4.5px] w-[38px] rounded-[3px] bg-chair" />
          </div>
        ) : null}
        {children}
      </section>
    </div>
  );
}
