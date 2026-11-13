"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import {
  FindsTrackedLink,
  FindsWidgetSection
} from "@/components/roamly/FindsCommercialWidgets";
import type { FindsWidgetConfig } from "@/lib/roamly/findsCommercialConfig";
import { GAP_AFFILIATE_DISCLOSURE } from "@/lib/roamly/tripGapCore";
import { useI18n } from "@/components/i18n/I18nProvider";

type GapCard = {
  type: string;
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  providerLabel: string;
  widget?: { src: string; minHeight: number };
  reason: string;
  dismissed: boolean;
};

function widgetConfigFor(card: GapCard): FindsWidgetConfig | null {
  if (!card.widget) return null;
  return {
    id: `trip-gap-${card.type}`,
    kind: card.type === "esim" ? "esim" : "cars",
    src: card.widget.src,
    eyebrow: card.eyebrow,
    heading: card.title,
    description: card.description,
    minHeight: card.widget.minHeight,
    placement: "secondary"
  };
}

/**
 * Dismissible trip-gap offer cards for the itinerary page.
 * Only rendered for tracking-unlocked (paid/active) trips — the parent page
 * gates this component on trackingUnlocked.
 */
export function TripGapCards({ tripId }: { tripId: string }) {
  const { translateText } = useI18n();
  const [cards, setCards] = useState<GapCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCards(null);
    setError(null);
    fetch(`/api/roamly/trips/${encodeURIComponent(tripId)}/gaps`, { credentials: "same-origin" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; gaps?: GapCard[]; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.ok) {
          setError(data.error || translateText("Could not load trip suggestions."));
          setCards([]);
          return;
        }
        setCards(Array.isArray(data.gaps) ? data.gaps : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError(translateText("Could not load trip suggestions."));
          setCards([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const dismiss = useCallback(
    async (gapType: string) => {
      setCards((current) => (current || []).filter((card) => card.type !== gapType));
      await fetch(`/api/roamly/trips/${encodeURIComponent(tripId)}/gaps`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gapType })
      }).catch(() => {
        // fail-soft: the card is already hidden locally
      });
    },
    [tripId]
  );

  if (!cards || cards.length === 0) return null;

  return (
    <section aria-label={translateText("Trip suggestions")} className="mt-8">
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cblue">{translateText("Before you go")}</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-chead">{translateText("A few gaps worth closing")}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-cgray">
          {translateText("Based on what's already booked for this trip. Dismiss anything that doesn't fit — it won't come back.")}
        </p>
      </div>
      <div className="grid gap-4">
        {cards.map((card, index) => {
          const widgetConfig = widgetConfigFor(card);
          return (
            <BuiCard key={card.type} className="bui-enter relative p-5 sm:p-6" style={{ "--bui-delay": `${index * 60}ms` } as CSSProperties}>
              <button
                type="button"
                onClick={() => dismiss(card.type)}
                aria-label={`Dismiss ${card.title}`}
                className="bui-press bui-touch-square absolute right-4 top-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-cgray hover:bg-csoft hover:text-chead focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
              >
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </button>
              <p className="text-sm font-medium text-cgray">{card.reason}</p>
              <div className="mt-3">
                {widgetConfig ? (
                  <FindsWidgetSection config={widgetConfig} heading={false} />
                ) : (
                  <FindsTrackedLink
                    href={card.href}
                    eyebrow={card.eyebrow}
                    headline={card.title}
                    description={card.description}
                    action={card.ctaLabel}
                  />
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-cgray2">
                {GAP_AFFILIATE_DISCLOSURE} {translateText("Provider:")}{" "}{card.providerLabel}.
              </p>
            </BuiCard>
          );
        })}
      </div>
      {error ? <BuiNotice tone="error" title={error} className="mt-2" /> : null}
    </section>
  );
}
