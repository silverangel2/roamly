"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import type { RoamlyLocale } from "@/lib/i18n";

type TranslateItineraryButtonProps = {
  tripId: string;
  displayedLanguage: RoamlyLocale;
};

const buttonClass =
  "inline-flex items-center justify-center rounded-full border border-ocean/20 bg-white px-4 py-3 text-sm font-black text-ocean shadow-[0_10px_24px_rgba(16,32,51,0.06)] transition hover:border-ocean/40 hover:bg-ocean/5 disabled:pointer-events-none disabled:opacity-60";

export function TranslateItineraryButton({ tripId, displayedLanguage }: TranslateItineraryButtonProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (locale === displayedLanguage) return null;

  async function translate() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: locale })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || t("ui.status.translationFailed", "Could not translate itinerary."));
      }
      setMessage(t("ui.status.itineraryTranslated", "Itinerary translated."));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ui.status.translationFailed", "Could not translate itinerary."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roamly-no-print flex flex-col gap-2">
      <button type="button" onClick={() => void translate()} disabled={busy} className={buttonClass}>
        {busy ? t("ui.status.translating", "Translating...") : t("ui.actions.translateItinerary", "Translate itinerary")}
      </button>
      {message ? <p className="text-xs font-bold leading-5 text-ocean">{message}</p> : null}
      {error ? <p className="text-xs font-bold leading-5 text-coral">{error}</p> : null}
    </div>
  );
}
