"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { RoamlyGeneratingLoader } from "@/components/roamly/RoamlyGeneratingLoader";

type GenerateLockedItineraryButtonProps = {
  tripId: string;
  label?: string;
  subtext?: string;
};

const GENERATION_ERROR_MESSAGE = "Roamly could not generate this itinerary. Please adjust your trip details and try again.";
const AI_NOT_CONFIGURED_MESSAGE = "Roamly AI generation is not configured yet.";
const GENERATION_TIMEOUT_MS = 120_000;

export function GenerateLockedItineraryButton({
  tripId,
  label = "Generate itinerary",
  subtext
}: GenerateLockedItineraryButtonProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generationInFlight = useRef(false);

  async function generate() {
    if (generationInFlight.current) return;
    generationInFlight.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

    try {
      const response = await fetch("/api/trips/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, language: locale }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        setConfirming(false);
        window.location.href = `/login?next=${encodeURIComponent(`/trip/${tripId}`)}`;
        return;
      }

      if (response.status === 402 && data?.previewUrl) {
        setConfirming(false);
        window.location.href = data.previewUrl;
        return;
      }

      if (!response.ok) {
        const message = data?.message || data?.error || GENERATION_ERROR_MESSAGE;
        if (message === AI_NOT_CONFIGURED_MESSAGE) {
          setConfirming(false);
          setError(AI_NOT_CONFIGURED_MESSAGE);
          return;
        }
        throw new Error(message);
      }

      setConfirming(false);
      router.refresh();
    } catch (err) {
      console.warn("[Roamly trip] itinerary generation warning", err);
      setConfirming(false);
      setError(GENERATION_ERROR_MESSAGE);
    } finally {
      window.clearTimeout(timeout);
      generationInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-4 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Generating itinerary..." : label}
      </button>
      {subtext ? <p className="text-xs font-bold leading-5 text-slate-500">{subtext}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 px-4 backdrop-blur-sm">
          {busy ? (
            <RoamlyGeneratingLoader className="w-full max-w-xl" />
          ) : (
            <div className="w-full max-w-md rounded-[1.5rem] border border-cloud bg-white p-5 shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Final step</p>
              <h2 className="mt-2 text-2xl font-black text-ink">Generate and lock this itinerary?</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
                Once generated, this itinerary cannot be edited or regenerated. Please confirm your destination, dates,
                travelers, budget, and preferences are correct.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink ring-1 ring-cloud transition hover:ring-ocean/30 disabled:opacity-60"
                >
                  Go back and edit
                </button>
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60"
                >
                  Generate itinerary
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
