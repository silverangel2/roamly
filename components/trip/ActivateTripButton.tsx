"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth, getSupabaseBrowserSessionUser } from "@/lib/roamly/authenticatedFetch";

type CheckoutKind = "itinerary" | "tracking" | "complete";

type ActivateTripButtonProps = {
  tripId: string;
  itineraryLocked?: boolean;
  trackingUnlocked?: boolean;
  showItineraryUnlock?: boolean;
  testerAccess?: boolean;
  apiAuthToken?: string;
};

export function ActivateTripButton({
  tripId,
  itineraryLocked = false,
  trackingUnlocked = false,
  showItineraryUnlock = true,
  testerAccess = false,
  apiAuthToken = ""
}: ActivateTripButtonProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<CheckoutKind | "">("");

  async function startCheckout(checkoutKind: CheckoutKind) {
    setBusy(checkoutKind);
    setError("");

    try {
      const response = await fetchWithSupabaseAuth("/api/stripe/create-trip-checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiAuthToken ? { "x-roamly-session-token": apiAuthToken } : {})
        },
        body: JSON.stringify({ tripId, checkoutKind })
      });
      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        const user = await getSupabaseBrowserSessionUser();
        if (user) {
          setError("Your login session could not be confirmed. Refresh this page and try again.");
          setBusy("");
          return;
        }
        window.location.href = `/login?next=${encodeURIComponent(`/trip/${tripId}`)}`;
        return;
      }

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
  const testerKind: CheckoutKind = itineraryLocked ? "tracking" : "complete";

  return (
    <div className="space-y-3">
      {testerAccess ? (
        <button
          type="button"
          onClick={() => startCheckout(testerKind)}
          disabled={Boolean(busy)}
          className="w-full rounded-2xl border border-ocean/25 bg-ocean/10 px-5 py-4 text-sm font-black text-ocean transition hover:-translate-y-0.5 hover:bg-ocean/15 disabled:translate-y-0 disabled:opacity-60"
        >
          {busy === testerKind ? "Continuing..." : "Continue as tester"}
        </button>
      ) : null}
      {!itineraryLocked && showItineraryUnlock ? (
        <>
          <button
            type="button"
            onClick={() => startCheckout("complete")}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl bg-gradient-to-r from-orange-400 to-rose-400 px-5 py-4 text-sm font-black text-white shadow-lg shadow-orange-400/20 transition hover:-translate-y-0.5 hover:from-orange-300 hover:to-rose-300 disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "complete" ? "Opening secure checkout..." : "Complete Trip Pack — $7.99 CAD"}
          </button>
          <button
            type="button"
            onClick={() => startCheckout("itinerary")}
            disabled={Boolean(busy)}
            className="w-full rounded-2xl bg-white px-5 py-4 text-sm font-black text-ink ring-1 ring-cloud transition hover:-translate-y-0.5 hover:ring-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "itinerary" ? "Opening secure checkout..." : "Unlock itinerary — $4.99 CAD"}
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
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-4 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
          >
            {busy === "tracking" ? "Opening secure checkout..." : "Add Live Companion — $3.99 CAD"}
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
