"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FindsTrackedLink,
  FindsWidgetSection
} from "@/components/roamly/FindsCommercialWidgets";
import type { FindsWidgetConfig } from "@/lib/roamly/findsCommercialConfig";
import { GAP_AFFILIATE_DISCLOSURE } from "@/lib/roamly/tripGapCore";

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
          setError(data.error || "Could not load trip suggestions.");
          setCards([]);
          return;
        }
        setCards(Array.isArray(data.gaps) ? data.gaps : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load trip suggestions.");
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
    <section aria-label="Trip suggestions" className="mt-8">
      <div className="mb-4">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-ocean">Before you go</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-900">A few gaps worth closing</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
          Based on what&apos;s already booked for this trip. Dismiss anything that doesn&apos;t fit — it won&apos;t come back.
        </p>
      </div>
      <div className="grid gap-4">
        {cards.map((card) => {
          const widgetConfig = widgetConfigFor(card);
          return (
            <article key={card.type} className="relative rounded-[1.75rem] border border-[#e5ebe1] bg-white p-5 sm:p-6">
              <button
                type="button"
                onClick={() => dismiss(card.type)}
                aria-label={`Dismiss ${card.title}`}
                className="absolute right-4 top-4 inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25"
              >
                <span aria-hidden="true" className="text-lg leading-none">×</span>
              </button>
              <p className="text-sm font-medium text-slate-500">{card.reason}</p>
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
              <p className="mt-3 text-xs leading-5 text-slate-400">
                {GAP_AFFILIATE_DISCLOSURE} Provider: {card.providerLabel}.
              </p>
            </article>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-xs text-slate-400">{error}</p> : null}
    </section>
  );
}
