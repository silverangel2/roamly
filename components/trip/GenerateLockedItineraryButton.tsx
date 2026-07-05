"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

type GenerateLockedItineraryButtonProps = {
  tripId: string;
  label?: string;
  subtext?: string;
};

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

  async function generate() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/trips/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, language: locale })
      });
      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(`/trip/${tripId}`)}`;
        return;
      }

      if (response.status === 402 && data?.previewUrl) {
        window.location.href = data.previewUrl;
        return;
      }

      if (!response.ok) {
        throw new Error(data?.message || data?.error || "Itinerary generation failed.");
      }

      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Itinerary generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="w-full rounded-2xl bg-ink px-5 py-4 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Generating itinerary..." : label}
      </button>
      {subtext ? <p className="text-xs font-bold leading-5 text-slate-500">{subtext}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 px-4 backdrop-blur-sm">
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
                className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-ocean disabled:opacity-60"
              >
                {busy ? "Generating..." : "Generate itinerary"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
