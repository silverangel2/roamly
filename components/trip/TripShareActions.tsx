"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BuiSheet } from "@/components/boardui/Sheet";
import { BuiMorphButton, type BuiMorphPhase } from "@/components/boardui/MorphButton";
import { BuiSendIcon } from "@/components/boardui/AnimatedIcons";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  /* Submit morph + animated send icon (2026-11-04): the send
   * button morphs pill → spinner → tick as one shape, and at the
   * moment of success its plane flies off and a new one springs
   * in. The specific confirmation line below the form is
   * untouched — motion accompanies the message. */
  const [sentPulse, setSentPulse] = useState(false);
  const sentTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (sentTimer.current) window.clearTimeout(sentTimer.current);
  }, []);
  const morphPhase: BuiMorphPhase = busy ? "busy" : sentPulse ? "done" : "idle";

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
      // The server sends only to the account's own email address
      // (security pass 2026-11-06, Check 5) -- there is no recipient
      // field anymore, and the address that was used comes back in the
      // response so the confirmation below can name it truthfully.
      const response = await fetch(`/api/trips/${tripId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: locale })
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
        recipient?: string;
        result?: { status?: string };
      } | null;

      if (response.ok && data?.ok) {
        // Success Rules pass (2026-11-03), rule 1: say what
        // happened, specifically — name the recipient. The address is
        // the account email the server actually sent to, returned in
        // the response. The send-another loop stays open: the form
        // remains inside the sheet (rule 2/4).
        const sentTo = (data.recipient || "").trim();
        setMessage(
          sentTo
            ? t("ui.status.itineraryEmailSentTo", "Itinerary sent to {email}.").replace("{email}", sentTo)
            : t("ui.status.itineraryEmailSent", "Itinerary email sent.")
        );
        setSentPulse(true);
        if (sentTimer.current) window.clearTimeout(sentTimer.current);
        sentTimer.current = window.setTimeout(() => setSentPulse(false), 1500);
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
        {/* Bookings was reachable only by guessing its URL: the trip
            page's Bookings panel has no tab label, and the bookings
            route is where the Add booking form lives. This header link
            is the discoverable path to it, in the existing control row. */}
        <a href={`/trip/${tripId}/bookings`} className={buttonClass}>
          {t("ui.actions.bookings", "Bookings")}
        </a>
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
        /* Container Rules pass (2026-11-03): emailing the itinerary is
           a small form task, not a full stop — rule 1 takes it out of
           the centered modal and onto the shared sheet (bottom sheet
           on phones, rule-4 side drawer on desktop, itinerary visible
           beside it). Form, copy and send logic are unchanged; the
           scrim tap now also closes, like the Close button always did. */
        <BuiSheet
          label={t("ui.actions.emailItinerary", "Email itinerary")}
          backdropClassName="bg-ink/55 backdrop-blur-sm"
          className="p-5"
          onClose={() => setModalOpen(false)}
        >
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
                {/* No recipient field: the itinerary goes to the
                    account's own email address only (security pass
                    2026-11-06, Check 5). The copy says so up front so
                    nobody expects it to reach a typed-in address. */}
                <p className="text-sm font-medium leading-6 text-cgray">
                  {t("ui.email.sentToAccountEmail", "We'll send this itinerary to your account email address.")}
                </p>
                <BuiMorphButton
                  phase={morphPhase}
                  className="bg-cblue px-5 text-sm font-semibold text-white"
                >
                  {t("ui.actions.sendItinerary", "Send itinerary")}
                </BuiMorphButton>
              </form>
            )}

            {message ? (
              <p className="mt-4 flex items-center gap-2 rounded-[14px] bg-cblue/10 px-4 py-3 text-sm font-medium text-chead">
                {/* The send plane flies at the moment of success,
                    beside the specific confirmation it accompanies. */}
                <BuiSendIcon sent={sentPulse} className="h-4 w-4 shrink-0 text-cblue" />
                <span>{message}</span>
              </p>
            ) : null}
            {error ? <p className="mt-4 rounded-[14px] bg-cred/10 px-4 py-3 text-sm font-medium text-cred">{error}</p> : null}
        </BuiSheet>
      ) : null}
    </>
  );
}
