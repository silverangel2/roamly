"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth, getSupabaseBrowserSessionUser } from "@/lib/roamly/authenticatedFetch";
import { BuiUnlockIcon } from "@/components/boardui/AnimatedIcons";
import { useI18n } from "@/components/i18n/I18nProvider";

type CheckoutKind = "itinerary" | "tracking" | "complete";

type ActivateTripButtonProps = {
  tripId: string;
  itineraryLocked?: boolean;
  trackingUnlocked?: boolean;
  showItineraryUnlock?: boolean;
  testerAccess?: boolean;
  apiAuthToken?: string;
  // Server-resolved from the trip's stored metadata (see the trip page) — never
  // guessed on the client. Philippines trips show the ₱ price set; all others CAD.
  isPhilippinesTrip?: boolean;
};

export function ActivateTripButton({
  tripId,
  itineraryLocked = false,
  trackingUnlocked = false,
  showItineraryUnlock = true,
  testerAccess = false,
  apiAuthToken = "",
  isPhilippinesTrip = false
}: ActivateTripButtonProps) {
  const { translateText } = useI18n();
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
          setError(translateText("Your login session could not be confirmed. Refresh this page and try again."));
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
            : translateText("This purchase option is temporarily unavailable. You have not been charged.");

        throw new Error(safeMessage);
      }
      if (data?.alreadyActivated || data?.alreadyUnlocked) {
        window.location.href = checkoutKind === "tracking" ? `/trip/${tripId}/live` : `/trip/${tripId}`;
        return;
      }
      if (!data?.url) throw new Error(translateText("Stripe did not return a checkout link."));

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : translateText("Stripe checkout could not be opened."));
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
          className="w-full rounded-xl border border-cblue/25 bg-cblue/10 px-4 py-3 text-sm font-bold text-cblue transition hover:bg-cblue/15 disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
        >
          {busy === testerKind ? translateText("Continuing...") : translateText("Continue as tester")}
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
            {busy === "complete" ? translateText("Opening secure checkout...") : isPhilippinesTrip ? translateText("Complete Trip Pack — ₱149") : translateText("Complete Trip Pack — $7.99 CAD")}
          </button>
          <button
            type="button"
            onClick={() => startCheckout("itinerary")}
            disabled={Boolean(busy)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-ink ring-1 ring-cloud transition hover:ring-cblue disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
          >
            {/* Animated unlock (2026-11-04): while secure checkout
                opens, the shackle springs open on the real spring
                at ζ=0.32 — it swings ~34% past its rest angle
                before settling, the reel's overshoot. */}
            <BuiUnlockIcon open={busy === "itinerary"} className="h-5 w-5" />
            {busy === "itinerary" ? translateText("Opening secure checkout...") : isPhilippinesTrip ? translateText("Unlock itinerary — ₱99") : translateText("Unlock itinerary — $4.99 CAD")}
          </button>
          <p className="px-1 text-xs font-medium leading-4 text-slate-500">
            {translateText("One-time payment. No subscription.")}
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => startCheckout("tracking")}
            disabled={Boolean(busy)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-3 text-sm font-bold text-white shadow-md shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60 sm:rounded-2xl sm:px-5 sm:py-4 sm:font-black"
          >
            <BuiUnlockIcon open={busy === "tracking"} className="h-5 w-5" />
            {busy === "tracking" ? translateText("Opening secure checkout...") : isPhilippinesTrip ? translateText("Add Live Companion — ₱79") : translateText("Add Live Companion — $3.99 CAD")}
          </button>
          <p className="px-1 text-xs font-medium leading-4 text-slate-500">
            {translateText("Adds live reminders and trip guidance.")}
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
