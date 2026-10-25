"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Cancel action for one active tracked booking. Two taps, never one: the
 * first tap asks, the second confirms. The copy is explicit that cancel
 * only stops Roamly tracking — it does not cancel with the provider and
 * does not refund anything. On success the page refreshes so the booking
 * leaves the active list and appears in booking history.
 */
export function BookingCancelAction({ tripId, bookingId }: { tripId: string; bookingId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "busy" | "done" | "error">("idle");

  async function confirm() {
    setStep("busy");
    try {
      const response = await fetch(`/api/trips/${tripId}/bookings/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId })
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        setStep("error");
        return;
      }
      setStep("done");
      router.refresh();
    } catch {
      setStep("error");
    }
  }

  if (step === "done") {
    return <p className="mt-3 text-sm font-bold text-slate-500">Removed from your active bookings. It stays in booking history below.</p>;
  }

  if (step === "confirm" || step === "busy") {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
        <p className="text-sm font-bold leading-6 text-ink">Stop tracking this booking?</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
          Roamly will remove it from your active bookings and budget. This does not cancel with the
          provider and does not refund anything — contact the provider for that.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={step === "busy"}
            onClick={confirm}
            className="inline-flex min-h-11 items-center rounded-xl bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
          >
            {step === "busy" ? "Removing…" : "Yes, stop tracking"}
          </button>
          <button
            type="button"
            disabled={step === "busy"}
            onClick={() => setStep("idle")}
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
          >
            Keep booking
          </button>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="mt-3">
        <p className="text-sm font-bold text-rose-800">Could not remove this booking. Please try again.</p>
        <button
          type="button"
          onClick={() => setStep("idle")}
          className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setStep("confirm")}
      className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-800"
    >
      Cancel booking
    </button>
  );
}
