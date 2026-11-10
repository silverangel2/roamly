"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BuiButton } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";

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
      <div className="mt-3 rounded-bui-card border border-cred/40 bg-cred/10 px-3 py-3">
        <p className="text-sm font-bold leading-6 text-ink">Stop tracking this booking?</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
          Roamly will remove it from your active bookings and budget. This does not cancel with the
          provider and does not refund anything — contact the provider for that.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <BuiButton type="button" variant="danger" busy={step === "busy"} onClick={confirm}>
            {step === "busy" ? "Removing…" : "Yes, stop tracking"}
          </BuiButton>
          <BuiButton type="button" variant="secondary" disabled={step === "busy"} onClick={() => setStep("idle")}>
            Keep booking
          </BuiButton>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="mt-3">
        <BuiNotice tone="error" title="Could not remove this booking. Please try again." />
        <BuiButton type="button" variant="secondary" onClick={() => setStep("idle")} className="mt-2">
          Try again
        </BuiButton>
      </div>
    );
  }

  return (
    <BuiButton type="button" variant="secondary" onClick={() => setStep("confirm")} className="mt-3">
      Cancel booking
    </BuiButton>
  );
}
