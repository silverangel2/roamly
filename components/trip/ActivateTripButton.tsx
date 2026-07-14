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

      if (!response.ok) {
        const safeMessage =
          typeof data?.message === "string" &&
          !/stripe|price id|key mode|product state|configuration/i.test(data.message)
            ? data.message
            : "This purchase option is temporarily unavailable. You have not been charged.";

        throw new Error(safeMessage);
      }
      if (data?.alreadyActivated || data?.alreadyUnlocked) {
        window.location.href = checkoutKind === "tracking" ? `/trip/${tripId}/live` : `/trip/${tripId}`;
        return;
      }
      if (!data?.url) throw new Error("Stripe did not return a checkout link.");

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe checkout could not be opened.");
      setBusy("");
    }
  }

  if (itineraryLocked && trackingUnlocked) return null;
  const testerKind: CheckoutKind = itineraryLocked ? "tracking" : "complete";

  return (
    <div className="space-y-2.5">
      {testerAccess ? (
        <button
          type="button"
          onClick={() => startCheckout(testerKind)}
          disabled={Boolean(busy)}
          className="w-full rounded-xl border border-ocean/25 bg-ocean/10 px-4 py-3 text-sm font-bold text-ocean transition hover:bg-ocean/15 disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
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
            className="w-full rounded-xl bg-gradient-to-r from-orange-400 to-rose-400 px-4 py-3 text-sm font-bold text-white shadow-md shadow-orange-400/20 transition hover:from-orange-300 hover:to-rose-300 disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
          >
            {busy === "complete" ? "Opening secure checkout..." : "Complete Trip Pack — $7.99 CAD"}
          </button>
          <button
            type="button"
            onClick={() => startCheckout("itinerary")}
            disabled={Boolean(busy)}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-ink ring-1 ring-cloud transition hover:ring-ocean disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
          >
            {busy === "itinerary" ? "Opening secure checkout..." : "Unlock itinerary — $4.99 CAD"}
          </button>
          <p className="px-1 text-xs font-medium leading-4 text-slate-500">
            One-time payment. No subscription.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => startCheckout("tracking")}
            disabled={Boolean(busy)}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-bold text-white shadow-md shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
          >
            {busy === "tracking" ? "Opening secure checkout..." : "Add Live Companion — $3.99 CAD"}
          </button>
          <p className="px-1 text-xs font-medium leading-4 text-slate-500">
            Adds live reminders and trip guidance.
          </p>
        </>
      )}
      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-coral/10 px-3 py-2.5 text-sm font-semibold leading-5 text-coral sm:rounded-2xl sm:px-4 sm:py-3"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
