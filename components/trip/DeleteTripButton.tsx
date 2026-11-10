"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";
// Toast API (components/boardui/Toast.tsx — the ONE toast system,
// batch 7): the deferred-commit Undo surface REQUIRES the
// BuiToastProvider the coordinator mounts in the app shell.
// useBuiToastContext() throws when the provider is absent, so this
// component probes with the module's non-throwing
// useBuiToastOptional() instead — with the provider present it
// returns the identical API; without it the component falls back to
// an immediate delete after the confirm dialog (recorded in
// jakob-w7-log.md).
import { useBuiToastOptional } from "@/components/boardui/Toast";
import { buiPrefersReducedMotion } from "@/components/boardui/spring";

type DeleteTripButtonProps = {
  tripId: string;
  tripTitle: string;
};

/** How long the traveller can undo before the delete is committed. */
const UNDO_WINDOW_MS = 8000;

export function DeleteTripButton({ tripId, tripTitle }: DeleteTripButtonProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const toastContext = useBuiToastOptional();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState(false);
  const [error, setError] = useState("");
  const commitTimerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  /* Feels-right set (2026-11-04, carried from the BoardUI branch at
     the 2026-11-05 merge): once the delete has actually committed,
     the trip's dashboard card folds its height away on the spring
     curve before the refresh lands, so the list below glides up
     instead of jumping. The delete flow itself (in-app confirm,
     deferred commit, Undo toast) is the candidate's, unchanged;
     reduced motion skips the fold and refreshes at once. */
  async function closeCardThenRefresh() {
    const card = buttonRef.current?.closest<HTMLElement>("[data-bui-trip-card]");
    if (card && !buiPrefersReducedMotion()) {
      const height = card.offsetHeight;
      card.style.height = `${height}px`;
      card.style.overflow = "hidden";
      card.style.transition =
        "height 320ms cubic-bezier(0.3, 1.22, 0.4, 1), opacity 260ms ease, margin 320ms cubic-bezier(0.3, 1.22, 0.4, 1), padding 320ms cubic-bezier(0.3, 1.22, 0.4, 1)";
      void card.offsetHeight;
      card.style.height = "0px";
      card.style.opacity = "0";
      card.style.marginTop = "0px";
      card.style.marginBottom = "0px";
      card.style.paddingTop = "0px";
      card.style.paddingBottom = "0px";
      await new Promise((resolve) => window.setTimeout(resolve, 330));
    }
    router.refresh();
  }

  // NOTE (W7 recovery fix): the commit timer is deliberately NOT
  // cleared on unmount. The dialog promises the trip "will be
  // removed" after the undo window; if the traveller navigates away
  // during those ~8s the confirmed delete must still commit on lapse
  // (the fetch + router.refresh are safe after unmount). Only the
  // toast's Undo action cancels the timer.

  // The SAME delete request this component has always made:
  // DELETE /api/trips/[tripId], then router.refresh() on success.
  async function commitDelete() {
    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || t("ui.status.tripRemovalFailed"));
      }

      await closeCardThenRefresh();
    } catch (caught) {
      const message = localizeCustomerError(locale, caught, "ui.status.tripRemovalFailed");
      if (toastContext) {
        toastContext.toast({ message, tone: "warning", durationMs: 6000 });
      } else {
        setError(message);
      }
    } finally {
      setIsDeleting(false);
      setPendingRemoval(false);
    }
  }

  function confirmDelete() {
    setDialogOpen(false);
    if (isDeleting || pendingRemoval) return;

    if (!toastContext) {
      // FALLBACK (no BuiToastProvider mounted): there is no Undo surface,
      // so the delete commits immediately after the dialog — the same
      // timing the old window.confirm flow had, minus the native UI.
      void commitDelete();
      return;
    }

    // DEFERRED COMMIT: nothing is deleted yet. The toast carries the
    // Undo action for the undo window; only when the window lapses
    // does the delete request fire. Undo cancels the timer, so no
    // delete call is ever made.
    setPendingRemoval(true);
    toastContext.toast({
      message: t(
        "ui.status.tripWillBeRemoved",
        `"${tripTitle || "This trip"}" will be removed.`
      ),
      durationMs: UNDO_WINDOW_MS,
      actionLabel: t("ui.actions.undo", "Undo"),
      onAction: () => {
        if (commitTimerRef.current != null) {
          window.clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        setPendingRemoval(false);
      }
    });
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      void commitDelete();
    }, UNDO_WINDOW_MS);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={isDeleting || pendingRemoval}
        className="mt-3 w-full rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isDeleting || pendingRemoval ? t("ui.status.removing") : t("ui.actions.removeTrip", "Remove trip")}
      </button>

      {error ? (
        <p role="alert" className="mt-3 rounded-2xl border border-cred/20 bg-cred/10 px-4 py-3 text-sm font-black text-cred">
          {error}
        </p>
      ) : null}

      {dialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-cnavy/50 p-4 sm:items-center"
          onClick={() => setDialogOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-trip-title"
            aria-describedby="delete-trip-body"
            className="w-full max-w-md rounded-[1.5rem] border border-chair bg-white p-5 shadow-soft"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-trip-title" className="text-xl font-black text-chead">
              {t("ui.actions.removeTripQuestion", "Remove this trip?")}
            </h2>
            <p id="delete-trip-body" className="mt-2 text-sm font-bold leading-6 text-slate-600">
              {toastContext
                ? t(
                    "ui.status.tripRemovalExplainerUndo",
                    `"${tripTitle || "This trip"}" and its itinerary will be removed from your dashboard. After you confirm, you will have a few seconds to undo. Once it is removed, it cannot be restored.`
                  )
                : t(
                    "ui.status.tripRemovalExplainer",
                    `"${tripTitle || "This trip"}" and its itinerary will be removed from your dashboard. Once it is removed, it cannot be restored.`
                  )}
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={confirmDelete}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-cred px-5 py-3 text-sm font-black text-white transition disabled:opacity-60"
              >
                {t("ui.actions.deleteTrip", "Delete trip")}
              </button>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-cblue hover:text-cblue"
              >
                {t("ui.actions.cancel", "Cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
