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
 * with a fresh timer.
 *
 * ONE TOAST SYSTEM (batch 7, 2026-11-09): the Jakob round's second,
 * non-BoardUI toast (components/roamly/Toast.tsx) is retired — this
 * file is now the only toast in the app. Surfaces deep inside the
 * shell (DeleteTripButton's deferred-commit Undo) cannot hold
 * per-surface state, so the shell mounts <BuiToastProvider> once
 * (AppShellClient) and consumers call useBuiToastOptional() /
 * useBuiToastContext() for the same showToast vocabulary, carried
 * on this component. Two recorded carry-overs from the retired
 * system: the "warning" tone (the SAME cred dot the legacy warning
 * carried — a failed delete has nothing for the traveller to fix,
 * the trip is untouched, so its failure is a transient notice, not
 * a form error that must stay) and per-toast durationMs / action /
 * onAction options on the toast state. What the retired system had
 * and this one deliberately does not: stacking (one toast at a
 * time — the container rule's one-panel discipline, already this
 * component's convention) and a close button (dismissal is by
 * timer or by the action, per the contract above).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { cx } from "./cx";

export type BuiToastTone = "success" | "info" | "warning";

const dotClasses: Record<BuiToastTone, string> = {
  success: "bg-cgreen",
  info: "bg-cblue",
  warning: "bg-cred"
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
  /** Per-toast auto-dismiss override (e.g. the Undo window). */
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface BuiToastOptions {
  message: string;
  tone?: BuiToastTone;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Surface-side toast state: showToast replaces any current toast
 * (one toast at a time — the container rule's one-panel discipline,
 * applied to toasts) and remounts it via the id key. The optional
 * third argument carries a per-toast duration / action (batch 7:
 * the shell provider's Undo toast needs both); existing two-argument
 * callers are unchanged.
 */
export function useBuiToast() {
  const [toast, setToast] = useState<BuiToastState | null>(null);
  const nextIdRef = useRef(0);

  const showToast = useCallback(
    (
      message: string,
      tone: BuiToastTone = "success",
      options?: { durationMs?: number; actionLabel?: string; onAction?: () => void }
    ) => {
      nextIdRef.current += 1;
      setToast({
        id: nextIdRef.current,
        message,
        tone,
        durationMs: options?.durationMs,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction
      });
    },
    []
  );

  const clearToast = useCallback(() => setToast(null), []);

  /**
   * Dismiss ONLY the toast with this id (batch 7 fix): a stale
   * dismiss — an expired toast's timer landing after its successor
   * was raised — must never clear the current toast. The shell's
   * delete flow chains exactly this way: the Undo toast expires at
   * the same moment the deferred commit resolves and raises the
   * failure toast.
   */
  const dismissToast = useCallback((id: number) => {
    setToast((current) => (current && current.id === id ? null : current));
  }, []);

  return { toast, showToast, clearToast, dismissToast };
}

/* ------------------------------------------------------------------ */
/* Shell provider (batch 7): the ONE toast, mounted once by the app   */
/* shell so any component below it can raise a toast. The default     */
/* tone for the options-object call is "info" — the retired system's  */
/* default (blue dot) under this system's name.                       */
/* ------------------------------------------------------------------ */

type BuiToastContextValue = {
  toast: (options: BuiToastOptions) => void;
};

const BuiToastContext = createContext<BuiToastContextValue | null>(null);

export function BuiToastProvider({ children }: { children: ReactNode }) {
  const { toast, showToast, dismissToast } = useBuiToast();

  const value = useMemo<BuiToastContextValue>(
    () => ({
      toast: (options: BuiToastOptions) =>
        showToast(options.message, options.tone ?? "info", {
          durationMs: options.durationMs,
          actionLabel: options.actionLabel,
          onAction: options.onAction
        })
    }),
    [showToast]
  );

  return (
    <BuiToastContext.Provider value={value}>
      {children}
      {toast ? (
        <BuiToast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          durationMs={toast.durationMs}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          onDismiss={() => dismissToast(toast.id)}
        />
      ) : null}
    </BuiToastContext.Provider>
  );
}

/**
 * Returns the shell toast API, or null when no BuiToastProvider is
 * mounted above this component. Callers that must work with or
 * without the provider (e.g. DeleteTripButton) use this and fall
 * back gracefully on null — the same contract the retired system's
 * optional hook carried.
 */
export function useBuiToastOptional(): BuiToastContextValue | null {
  return useContext(BuiToastContext);
}

/** Returns the shell toast API. Throws when no provider is mounted. */
export function useBuiToastContext(): BuiToastContextValue {
  const context = useContext(BuiToastContext);
  if (!context) {
    throw new Error("useBuiToastContext must be used inside <BuiToastProvider>. Mount BuiToastProvider in the app shell.");
  }
  return context;
}
