"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";

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

  const inputClass = "bui-input mt-2 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10";
  const labelClass = "block text-sm font-black text-chead";

  if (mode === "done") {
    return (
      <div className="mt-3">
        <BuiNotice tone="success" title={doneMessage} />
      </div>
    );
  }

  return (
    <div className="mt-3">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <BuiButton type="button" onClick={() => void assertBooking()} busy={busy}>
            This is my booking
          </BuiButton>
          <BuiButton type="button" variant="secondary" onClick={() => setMode("correcting")} disabled={busy}>
            Correct details
          </BuiButton>
          <BuiButton type="button" variant="secondary" onClick={() => setMode("dismissing")} disabled={busy}>
            Dismiss
          </BuiButton>
        </div>
      ) : null}
      {mode === "correcting" ? (
        <BuiCard className="p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Provider<input value={provider} onChange={(e) => setProvider(e.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Confirmation<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Amount<input value={amount} type="number" inputMode="decimal" onChange={(e) => setAmount(e.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} /></label>
            <label className={labelClass}>Start date<input value={startDate} type="date" onChange={(e) => setStartDate(e.target.value)} className={inputClass} /></label>
            <div className="flex gap-2 sm:col-span-2">
              <BuiButton type="button" onClick={() => void saveCorrections()} busy={busy}>Save corrections for review</BuiButton>
              <BuiButton type="button" variant="secondary" onClick={() => setMode("idle")} disabled={busy}>Cancel</BuiButton>
            </div>
          </div>
        </BuiCard>
      ) : null}
      {mode === "dismissing" ? (
        <BuiCard className="p-3">
          <label className={labelClass}>Reason (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not my booking" className={inputClass} /></label>
          <div className="mt-3 flex gap-2">
            <BuiButton type="button" onClick={() => void dismissBooking()} busy={busy}>Dismiss this item</BuiButton>
            <BuiButton type="button" variant="secondary" onClick={() => setMode("idle")} disabled={busy}>Cancel</BuiButton>
          </div>
        </BuiCard>
      ) : null}
      {error ? (
        <div className="mt-2">
          <BuiNotice tone="error" title={error} />
        </div>
      ) : null}
    </div>
  );
}
