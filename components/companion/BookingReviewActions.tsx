"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ReviewInitial = {
  title: string;
  provider: string;
  confirmation: string;
  amount: number | null;
  currency: string;
  startDate: string;
};

/**
 * Per-record review workflow for an Action-needed wallet booking (B11).
 * Every action posts to /api/roamly/bookings/review, which records the
 * traveler's decision in the row's metadata only — it never flips the
 * booking to confirmed, so a customer assertion stays an assertion.
 */
export function BookingReviewActions({ tripId, bookingId, initial }: { tripId: string; bookingId: string; initial: ReviewInitial }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "correcting" | "dismissing" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");
  const [title, setTitle] = useState(initial.title);
  const [provider, setProvider] = useState(initial.provider);
  const [confirmation, setConfirmation] = useState(initial.confirmation);
  const [amount, setAmount] = useState(initial.amount == null ? "" : String(initial.amount));
  const [currency, setCurrency] = useState(initial.currency);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [reason, setReason] = useState("");

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/roamly/bookings/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, bookingId, action, ...extra })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save your review.");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your review.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function assertBooking() {
    const data = await post("assert");
    if (!data) return;
    setDoneMessage("Thanks — your details are recorded. They are still awaiting confirmation.");
    setMode("done");
    router.refresh();
  }

  async function dismissBooking() {
    const data = await post("dismiss", { reason });
    if (!data) return;
    setDoneMessage("Dismissed. This item will no longer ask for your review.");
    setMode("done");
    router.refresh();
  }

  async function saveCorrections() {
    const corrections: Record<string, unknown> = {};
    if (title.trim() !== initial.title) corrections.title = title.trim();
    if (provider.trim() !== initial.provider) corrections.provider_name = provider.trim();
    if (confirmation.trim() !== initial.confirmation) corrections.confirmation_number = confirmation.trim();
    if (amount.trim() !== (initial.amount == null ? "" : String(initial.amount))) {
      corrections.amount_cents = amount.trim() ? Math.round(Number(amount) * 100) : null;
    }
    if (currency.trim().toUpperCase() !== initial.currency) corrections.currency = currency.trim();
    if (startDate !== initial.startDate) corrections.start_date = startDate;
    if (!Object.keys(corrections).length) {
      setError("Nothing changed — edit a field first, or choose another action.");
      return;
    }
    const data = await post("correct", { corrections });
    if (!data) return;
    setDoneMessage("Your corrections were saved for review. They are not confirmed yet.");
    setMode("done");
    router.refresh();
  }

  const inputClass = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-ink outline-none focus:border-ocean";

  if (mode === "done") {
    return <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{doneMessage}</p>;
  }

  return (
    <div className="mt-3">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void assertBooking()} disabled={busy} className="min-h-11 rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-60">
            This is my booking
          </button>
          <button type="button" onClick={() => setMode("correcting")} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-ink disabled:opacity-60">
            Correct details
          </button>
          <button type="button" onClick={() => setMode("dismissing")} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-ink disabled:opacity-60">
            Dismiss
          </button>
        </div>
      ) : null}
      {mode === "correcting" ? (
        <div className="grid gap-3 rounded-xl bg-white p-3 sm:grid-cols-2">
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Provider<input value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Confirmation<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Amount<input value={amount} type="number" onChange={(e) => setAmount(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Currency<input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} /></label>
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Start date<input value={startDate} type="date" onChange={(e) => setStartDate(e.target.value)} className={inputClass} /></label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={() => void saveCorrections()} disabled={busy} className="min-h-11 rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-60">Save corrections for review</button>
            <button type="button" onClick={() => setMode("idle")} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-ink disabled:opacity-60">Cancel</button>
          </div>
        </div>
      ) : null}
      {mode === "dismissing" ? (
        <div className="rounded-xl bg-white p-3">
          <label className="block text-xs font-black uppercase tracking-wide text-slate-500">Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not my booking" className={inputClass} /></label>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void dismissBooking()} disabled={busy} className="min-h-11 rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-60">Dismiss this item</button>
            <button type="button" onClick={() => setMode("idle")} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-ink disabled:opacity-60">Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm font-bold text-rose-700">{error}</p> : null}
    </div>
  );
}
