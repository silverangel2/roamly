"use client";

import { FormEvent, useState } from "react";

type TripShareActionsProps = {
  tripId: string;
  tripTitle: string;
  emailConfigured: boolean;
};

const buttonClass =
  "inline-flex items-center justify-center rounded-full border border-ocean/20 bg-white px-4 py-3 text-sm font-black text-ocean shadow-[0_10px_24px_rgba(16,32,51,0.06)] transition hover:border-ocean/40 hover:bg-ocean/5 disabled:pointer-events-none disabled:opacity-60";

export function TripShareActions({ tripId, tripTitle, emailConfigured }: TripShareActionsProps) {
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
        setShareMessage("Trip link shared.");
        return;
      }

      await navigator.clipboard.writeText(url);
      setShareMessage("Trip link copied.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setShareMessage("Copy the trip link from your browser address bar.");
    }
  }

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!emailConfigured) {
      setMessage("Email sending is not configured yet. You can export the PDF or copy the trip link.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: recipient })
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
        result?: { status?: string };
      } | null;

      if (response.ok && data?.ok) {
        setMessage("Itinerary email sent.");
        setRecipient("");
        return;
      }

      if (response.status === 202 || data?.result?.status === "skipped") {
        setMessage(data?.message || "Email sending is not configured yet. You can export the PDF or copy the trip link.");
        return;
      }

      throw new Error(data?.message || data?.error || "Could not send itinerary email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send itinerary email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={exportPdf} className={buttonClass}>
          Export PDF
        </button>
        <button type="button" onClick={() => setModalOpen(true)} className={buttonClass}>
          Email itinerary
        </button>
        <button type="button" onClick={() => void shareTrip()} className={buttonClass}>
          Share trip link
        </button>
      </div>
      {shareMessage ? <p className="w-full text-xs font-bold text-slate-500">{shareMessage}</p> : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Email itinerary">
          <div className="w-full max-w-md rounded-[1.25rem] border border-cloud bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Email itinerary</p>
                <h2 className="mt-2 text-2xl font-black text-ink">Send this trip document</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full border border-cloud bg-white px-3 py-1.5 text-sm font-black text-slate-500 hover:text-ink"
                aria-label="Close email modal"
              >
                Close
              </button>
            </div>

            {!emailConfigured ? (
              <p className="mt-4 rounded-2xl border border-sun/30 bg-sun/20 px-4 py-3 text-sm font-black leading-6 text-amber-800">
                Email sending is not configured yet. You can export the PDF or copy the trip link.
              </p>
            ) : (
              <form onSubmit={(event) => void sendEmail(event)} className="mt-4 grid gap-3">
                <label className="grid gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Recipient email</span>
                  <input
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    type="email"
                    required
                    placeholder="friend@example.com"
                    className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60"
                >
                  {busy ? "Sending..." : "Send itinerary"}
                </button>
              </form>
            )}

            {message ? <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{message}</p> : null}
            {error ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
