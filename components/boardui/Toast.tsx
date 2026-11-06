"use client";

/**
 * BoardUI Toast — Roamly foundation pattern.
 *
 * Purpose (owner SUCCESS-SCREEN RULES #3, 2026-11-03): dismissal
 * follows stakes. A low-stakes success (a saved setting, a saved
 * preference, an added booking) is a TOAST that leaves on its own in
 * ~4 seconds — not a banner that sits on the page forever, and not
 * silence. A high-stakes success (a payment) is the opposite: a
 * panel that STAYS (see CheckoutSuccess.tsx). Errors never use this
 * component — an error stays where it is until it is addressed.
 *
 * Behaviour: fixed above the tab bar (64px + safe-area, the same
 * offset the shell's floating action uses), rises via `.bui-enter`,
 * auto-dismisses after `durationMs` — default 4000, the rule's ~4s.
 * A toast carrying an action (e.g. an undo) passes a longer explicit
 * duration from its caller. Dismissal is by timer or by the action;
 * there is no swipe physics (the container pass's recorded rule-3
 * gap stands) and no close button — at 4 seconds the toast is a
 * glance, not a task.
 *
 * Adoption is per-surface and provider-free (this branch's
 * convention): the surface holds toast state with useBuiToast and
 * renders <BuiToast key={toast.id} ... /> so each new toast remounts
 * with a fresh timer. The Nov 5 tree carries a global ToastProvider
 * from its own Jakob round; reconciling the two systems (one toast
 * system at the shell) is a re-base seam, recorded in
 * BOARDUI-REPORT-R2.md — the call sites here are few and named.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./cx";

export type BuiToastTone = "success" | "info";

const dotClasses: Record<BuiToastTone, string> = {
  success: "bg-cgreen",
  info: "bg-cblue"
};

export interface BuiToastProps {
  /** What happened, specifically (success rule #1) — names the thing saved/added. */
  message: string;
  tone?: BuiToastTone;
  /** Milliseconds before the toast leaves. Default 4000 (the rule's ~4s). */
  durationMs?: number;
  /** One optional next step (success rule #2/#4), e.g. "Undo" or "View". */
  actionLabel?: string;
  /** Runs once when the action is tapped; the toast closes either way. */
  onAction?: () => void;
  /** Called when the toast leaves (timer or action). */
  onDismiss: () => void;
  className?: string;
}

export function BuiToast({
  message,
  tone = "success",
  durationMs = 4000,
  actionLabel,
  onAction,
  onDismiss,
  className
}: BuiToastProps) {
  // The dismiss callback lives in a ref so a parent re-render can
  // never restart the clock — the toast leaves durationMs after it
  // appeared, whatever the surface does meanwhile.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <div
        role="status"
        className={cx(
          "bui-enter pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-bui-card border border-chair bg-white py-3 pl-4 pr-3 shadow-[0_16px_42px_rgba(15,23,42,0.14)]",
          className
        )}
      >
        <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-full", dotClasses[tone])} />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-5 text-chead">{message}</p>
        {actionLabel ? (
          <button
            type="button"
            className="bui-press inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-bold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
            onClick={() => {
              onAction?.();
              dismissRef.current();
            }}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface BuiToastState {
  id: number;
  message: string;
  tone: BuiToastTone;
}

/**
 * Surface-side toast state: showToast replaces any current toast
 * (one toast at a time — the container rule's one-panel discipline,
 * applied to toasts) and remounts it via the id key.
 */
export function useBuiToast() {
  const [toast, setToast] = useState<BuiToastState | null>(null);
  const nextIdRef = useRef(0);

  const showToast = useCallback((message: string, tone: BuiToastTone = "success") => {
    nextIdRef.current += 1;
    setToast({ id: nextIdRef.current, message, tone });
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  return { toast, showToast, clearToast };
}
