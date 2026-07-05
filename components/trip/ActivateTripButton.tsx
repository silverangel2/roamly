"use client";

import { useState } from "react";

type CheckoutKind = "itinerary" | "tracking" | "complete";

type ActivateTripButtonProps = {
  tripId: string;
  itineraryLocked?: boolean;
  trackingUnlocked?: boolean;
  showItineraryUnlock?: boolean;
};

export function ActivateTripButton({
  tripId,
  itineraryLocked = false,
  trackingUnlocked = false,
  showItineraryUnlock = true
}: ActivateTripButtonProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<CheckoutKind | "">("");

  async function startCheckout(checkoutKind: CheckoutKind) {
    setBusy(checkoutKind);
    setError("");

    try {
      const response = await fetch("/api/stripe/create-trip-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, checkoutKind })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || "Checkout could not start.");
      if (data?.alreadyActivated || data?.alreadyUnlocked) {
        window.location.href = checkoutKind === "tracking" ? `/trip/${tripId}/live` : `/trip/${tripId}`;
        return;
      }
      if (!data?.url) throw new Error("Stripe did not return a checkout link.");

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not start.");
      setBusy("");
    }
  }

  if (itineraryLocked && trackingUnlocked) return null;

  return (
    <div className="space-y-3">
      {!itineraryLocked && showItineraryUnlock ? (
        <>
          <button
            type="button"
            onClick={() => startCheckout("complete")}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl bg-ink px-5 py-4 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "complete" ? "Opening secure checkout..." : "Get itinerary + Live Trip Companion - $7.99 CAD"}
          </button>
          <button
            type="button"
            onClick={() => startCheckout("itinerary")}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl bg-white px-5 py-4 text-sm font-black text-ink ring-1 ring-cloud transition hover:-translate-y-0.5 hover:ring-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "itinerary" ? "Opening secure checkout..." : "Unlock full itinerary - $4.99 CAD"}
          </button>
          <p className="text-xs font-bold leading-5 text-slate-500">
            One custom itinerary for one trip. No subscription. Add Live Trip Companion later for $3.99 CAD.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => startCheckout("tracking")}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl bg-ink px-5 py-4 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "tracking" ? "Opening secure checkout..." : "Add Live Trip Companion - $3.99 CAD"}
          </button>
          <p className="text-xs font-bold leading-5 text-slate-500">
            Adds reminders, booking timeline, Day 1 activation, nearby activities, and up-next help for this locked itinerary only.
          </p>
        </>
      )}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </div>
  );
}
