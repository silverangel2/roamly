"use client";

/*
 * Roamly toast system (Jakob C4) — global, dependency-free.
 *
 * Visual language follows the app's existing NoticeBanner pattern
 * (app/trip/[id]/page.tsx): white cards on the calm design tokens —
 * brand blue cblue #087BFF / deep navy cnavy #071E55 for the default
 * tone, success cgreen #17A86B, warning cred #E94F67 — with the same
 * rounded corners, soft shadow, and semibold 14px copy.
 *
 * Mounting (coordinator): wrap the app shell in <ToastProvider> and
 * call useToast() from any client component below it:
 *
 *   import { ToastProvider, useToast } from "@/components/roamly/Toast";
 *   const { toast } = useToast();
 *   toast({ message: "Trip removed.", actionLabel: "Undo", onAction: undo });
 *
 * Behaviour: toasts stack at the bottom, above the fixed tab bar
 * (64px + safe-area, the same offset the shell's floating action
 * uses); each toast auto-expires (default 5s, longer when it carries
 * an action — see DEFAULT_ACTION_DURATION_MS callers pass explicitly);
 * the dismiss control is a >=44px target; an optional action button
 * supports the Undo pattern (tap runs the callback once and closes).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { X } from "lucide-react";

export type ToastTone = "default" | "success" | "warning";

export type ToastOptions = {
  message: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. Defaults to 5000. */
  durationMs?: number;
  /** Optional action button label (e.g. "Undo"). */
  actionLabel?: string;
  /** Runs once when the action button is tapped, then the toast closes. */
  onAction?: () => void;
};

export type ToastItem = ToastOptions & { id: number; tone: ToastTone; durationMs: number };

type ToastContextValue = {
  toasts: ToastItem[];
  toast: (options: ToastOptions) => number;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextIdRef.current++;
      const item: ToastItem = {
        ...options,
        id,
        tone: options.tone || "default",
        durationMs: options.durationMs ?? DEFAULT_DURATION_MS
      };
      setToasts((current) => [...current, item]);
      if (item.durationMs > 0) {
        const timer = window.setTimeout(() => dismissToast(id), item.durationMs);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismissToast }),
    [toasts, toast, dismissToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom)+0.75rem)] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-[14px] border bg-white py-2 pl-4 pr-2 shadow-soft ${
              item.tone === "success"
                ? "border-cgreen/30"
                : item.tone === "warning"
                  ? "border-cred/30"
                  : "border-chair"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                item.tone === "success" ? "bg-cgreen" : item.tone === "warning" ? "bg-cred" : "bg-cblue"
              }`}
            />
            <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-cink">{item.message}</p>
            {item.actionLabel ? (
              <button
                type="button"
                onClick={() => {
                  item.onAction?.();
                  dismissToast(item.id);
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-black text-cblue transition hover:bg-cblue/10 focus:outline-none focus:ring-4 focus:ring-cblue/15"
              >
                {item.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss notification"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-cgray transition hover:bg-cbg hover:text-chead focus:outline-none focus:ring-4 focus:ring-cblue/15"
            >
              <X size={18} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Returns the toast API, or null when no ToastProvider is mounted
 * above this component. Callers that must work with or without the
 * provider (e.g. DeleteTripButton) should use this and fall back
 * gracefully on null.
 */
export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastContext);
}

/** Returns the toast API. Throws when no ToastProvider is mounted. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>. Mount ToastProvider in the app shell.");
  }
  return context;
}
