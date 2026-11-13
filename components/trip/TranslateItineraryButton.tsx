"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BuiButton } from "@/components/boardui/Button";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import type { RoamlyLocale } from "@/lib/i18n";

type TranslateItineraryButtonProps = {
  tripId: string;
  displayedLanguage: RoamlyLocale;
};

export function TranslateItineraryButton({ tripId, displayedLanguage }: TranslateItineraryButtonProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const autoTriedRef = useRef(false);

  // Free-translation rule (2026-11-11): picking a language translates the
  // whole trip — the traveller must not have to find and tap this button.
  // The button only renders when locale !== displayedLanguage, so mounting
  // here means a translation is owed. Fire once; the route short-circuits
  // when a stored translation already exists, and the button stays visible
  // as the retry path when translation fails. The trip page refreshes after
  // success, the stored translation becomes the displayed language, and
  // this button unmounts — so there is no repeat loop.
  useEffect(() => {
    if (locale === displayedLanguage) return;
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    void translate();
    // Intentionally once on mount: locale/tripId are stable for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <BuiButton variant="ghost" onClick={() => void translate()} busy={busy} className="w-fit">
        {busy ? t("ui.status.translating", "Translating...") : t("ui.actions.translateItinerary", "Translate itinerary")}
      </BuiButton>
      {message ? <p className="text-xs font-bold leading-5 text-cblue">{message}</p> : null}
      {error ? <p className="text-xs font-bold leading-5 text-coral">{error}</p> : null}
    </div>
  );
}
