"use client";

import { FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

type TripShareActionsProps = {
  tripId: string;
  tripTitle: string;
  emailConfigured: boolean;
};

const buttonClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-cgray transition hover:text-chead disabled:pointer-events-none disabled:opacity-60";

export function TripShareActions({ tripId, tripTitle, emailConfigured }: TripShareActionsProps) {
  const { locale, t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  function exportPdf() {
    window.print();
  }

  async function shareTrip() {
    setShareMessage("");
    setError("");
    const url = window.location.href.split("#")[0];

    try {
      if (navigator.share) {
        await navigator.share({ title: tripTitle, url });
        setShareMessage(t("ui.status.tripLinkShared", "Trip link shared."));
        return;
      }

      await navigator.clipboard.writeText(url);
      setShareMessage(t("ui.status.tripLinkCopied", "Trip link copied."));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setShareMessage(t("ui.status.copyTripLinkFallback", "Copy the trip link from your browser address bar."));
    }
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!emailConfigured) {
      setMessage(t("ui.status.emailNotConfigured", "Email sending is not configured yet. You can export the PDF or copy the trip link."));
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: recipient, language: locale })
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
        result?: { status?: string };
      } | null;

      if (response.ok && data?.ok) {
        setMessage(data?.message || t("ui.status.itineraryEmailSent", "Itinerary email sent."));
        setRecipient("");
        return;
      }

      if (response.status === 202 || data?.result?.status === "skipped") {
        setMessage(data?.message || t("ui.status.emailNotConfigured", "Email sending is not configured yet. You can export the PDF or copy the trip link."));
        return;
      }

      throw new Error(data?.message || data?.error || t("ui.status.emailSendFailed", "Could not send itinerary email."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ui.status.emailSendFailed", "Could not send itinerary email."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={exportPdf} className={buttonClass}>
          {t("ui.actions.exportPdf", "Export PDF")}
        </button>
        <button type="button" onClick={() => setModalOpen(true)} className={buttonClass}>
          {t("ui.actions.emailItinerary", "Email itinerary")}
        </button>
        <button type="button" onClick={() => void shareTrip()} className={buttonClass}>
          {t("ui.actions.shareTripLink", "Share trip link")}
        </button>
      </div>
      {shareMessage ? <p className="w-full text-xs font-medium text-cgray">{shareMessage}</p> : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("ui.actions.emailItinerary", "Email itinerary")}>
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-5 shadow-calm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.actions.emailItinerary", "Email itinerary")}</p>
                <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">{t("ui.email.sendTripDocument", "Send this trip document")}</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full bg-cbg px-3 py-1.5 text-sm font-semibold text-cgray hover:text-chead"
                aria-label={t("ui.actions.closeEmailModal", "Close email modal")}
              >
                {t("ui.actions.close", "Close")}
              </button>
            </div>

            {!emailConfigured ? (
              <p className="mt-4 rounded-[14px] bg-[#FF9500]/15 px-4 py-3 text-sm font-semibold leading-6 text-chead">
                {t("ui.status.emailNotConfigured", "Email sending is not configured yet. You can export the PDF or copy the trip link.")}
              </p>
            ) : (
              <form onSubmit={(event) => void sendEmail(event)} className="mt-4 grid gap-3">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">{t("ui.email.recipientEmail", "Recipient email")}</span>
                  <input
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    type="email"
                    required
                    placeholder="friend@example.com"
                    className="rounded-xl border border-chair bg-white px-4 py-3 text-sm font-normal text-cink outline-none focus:border-cblue focus:ring-4 focus:ring-cblue/15"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-cblue px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? t("ui.status.sending", "Sending...") : t("ui.actions.sendItinerary", "Send itinerary")}
                </button>
              </form>
            )}

            {message ? <p className="mt-4 rounded-[14px] bg-cblue/10 px-4 py-3 text-sm font-medium text-chead">{message}</p> : null}
            {error ? <p className="mt-4 rounded-[14px] bg-cred/10 px-4 py-3 text-sm font-medium text-cred">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
