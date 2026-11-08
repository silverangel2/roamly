"use client";

/*
 * Stay selector — the hotel half of the selector law (owner order,
 * 2026-11-08: the detailed itinerary "does not use BoardUI or even a
 * selector for hotel"). Same face as the transport selector in
 * TripPlanForm: ONE question, radio cards on the BoardUI card recipe
 * (bui-squircle, selected = border-cblue ring bg-cblue/5), photo +
 * name + whole-stay price per card with the per-night figure small,
 * at most ONE calm line on the suggested card, the picked card reads
 * "Added to your itinerary and budget.", a stay with no displayable
 * price is one quiet grey line (never a card, never an invented
 * price), and provenance is one quiet line.
 *
 * Picking a stay re-tabulates the trip's stay line and total with
 * the engine's own formula (retabulateStayTotals in
 * lib/roamly/stayOptions.ts — fixed costs untouched, buffer stays
 * 12%) and stamps the pick as the trip's staySelection. The pick is
 * SAVED through /api/trips/[id]/stay-selection (the discovery-row
 * write-back in lib/roamly/staySelectionSave.ts): the card shows the
 * pick instantly, the save runs behind it, and a failed save puts
 * the previous selection back with one plain error line — a pick is
 * never shown as saved when it is not. A stored pick arrives as
 * initialSelectionId, so the selector opens on the traveller's own
 * stay after a reload. Stay22 stays discovery/referral only: the
 * partner links under the picked card open the partner's search for
 * these dates; nothing here claims a booking.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Check } from "lucide-react";
import {
  retabulateStayTotals,
  stayOptionCostCents,
  type StayOption
} from "@/lib/roamly/stayOptions";
import { HotelPartnerChoices } from "@/components/trip/HotelPartnerChoices";
import type { HotelPartnerChoice } from "@/lib/roamly/affiliateResolver";

export type StaySelectorTotals = {
  stayEstimateCents: number;
  bufferEstimateCents: number;
  totalEstimateCents: number;
};

export type StaySelectorProps = {
  tripId: string;
  options: StayOption[];
  currency: string;
  /** The trip's stored stay pick (its option id), when one exists —
   *  the selector opens on the traveller's own stay, not the
   *  suggestion, after a reload. */
  initialSelectionId?: string | null;
  /** The trip's current totals from its own budget breakdown, or
   *  null when the saved trip carries none — the selector then
   *  records the pick without inventing a total to re-tabulate. */
  totals: StaySelectorTotals | null;
  partnersByOptionId: Record<string, HotelPartnerChoice[]>;
  /** Partner search for the destination area, for the no-options state. */
  areaPartners: HotelPartnerChoice[];
  destinationLabel: string;
};

function moneyFromCents(cents: number, currency: string) {
  return `${currency.toUpperCase()} ${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

function numberLabel(value: number) {
  return Math.round(value).toLocaleString("en-CA");
}

/** "CAD 612–688" — the transport face's range form, currency once. */
function rangeLabel(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return null;
  if (min != null && max != null && Math.round(min) !== Math.round(max)) {
    return `${currency.toUpperCase()} ${numberLabel(min)}–${numberLabel(max)}`;
  }
  const single = min ?? max ?? 0;
  return `${currency.toUpperCase()} ${numberLabel(single)}`;
}

export function StaySelector({
  tripId,
  options,
  currency,
  initialSelectionId,
  totals,
  partnersByOptionId,
  areaPartners,
  destinationLabel
}: StaySelectorProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectionId ?? null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    setSelectedId(initialSelectionId ?? null);
  }, [initialSelectionId]);

  async function pick(option: StayOption) {
    if (saving || option.id === selectedId) return;
    const previousId = selectedId;
    setSelectedId(option.id);
    setSaveFailed(false);
    setSaving(true);
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/stay-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: option.id })
      });
      if (!response.ok) throw new Error("stay selection save failed");
      // The saved discovery + breakdown are now the trip's truth;
      // refresh so the page re-reads them (totals, stamp, partners).
      router.refresh();
    } catch {
      setSelectedId(previousId);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const selectable = options.filter((option) => stayOptionCostCents(option) != null);
  const quiet = options.filter((option) => stayOptionCostCents(option) == null);
  const selected = selectable.find((option) => option.id === selectedId) || null;

  const liveTotals =
    totals && selected
      ? retabulateStayTotals(totals, stayOptionCostCents(selected) ?? totals.stayEstimateCents)
      : totals;
  const pickedPartners = selected ? partnersByOptionId[selected.id] || [] : [];

  if (!options.length) {
    return (
      <div>
        <p className="text-sm leading-6 text-cgray">No stay options saved for this trip yet.</p>
        {areaPartners.length ? (
          <HotelPartnerChoices partners={areaPartners} tripId={tripId} title={`Stay in ${destinationLabel}`} />
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3" role="radiogroup" aria-label="Where you'll stay">
        {selectable.map((option, index) => {
          const isSelected = selected?.id === option.id;
          const totalText = rangeLabel(option.totalMin, option.totalMax, option.currency);
          const nightlyText = rangeLabel(option.nightlyMin, option.nightlyMax, option.currency);
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={saving}
              onClick={() => void pick(option)}
              style={{ "--bui-delay": `${index * 70}ms` } as CSSProperties}
              className={
                "bui-enter bui-press bui-tap bui-squircle block w-full overflow-hidden rounded-bui-card border bg-white text-left shadow-bui-card transition-colors " +
                (isSelected ? "border-cblue bg-cblue/5 ring-1 ring-cblue" : "border-chair hover:border-cblue/60")
              }
            >
              {option.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={option.photoUrl} alt="" loading="lazy" className="h-28 w-full object-cover" />
              ) : null}
              <span className="flex min-h-[4.25rem] items-center gap-3 p-4">
                <span
                  aria-hidden="true"
                  className={
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " +
                    (isSelected ? "border-cblue bg-cblue" : "border-chair bg-white")
                  }
                >
                  {isSelected ? <Check className="bui-badge-pop h-3.5 w-3.5 text-white" strokeWidth={3.5} /> : null}
                </span>
                {option.photoUrl ? null : (
                  <BedDouble className="h-6 w-6 shrink-0 text-cblue" strokeWidth={1.8} aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-black leading-6 text-chead">{option.title}</span>
                  {[option.area, option.roomType].filter(Boolean).length ? (
                    <span className="block text-xs font-bold leading-5 text-cgray">
                      {[option.area, option.roomType].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {isSelected ? (
                    <span className="block text-xs font-bold leading-5 text-cblue">
                      Added to your itinerary and budget.
                    </span>
                  ) : option.suggested ? (
                    <span className="block text-xs font-bold leading-5 text-cblue">Suggested for this trip</span>
                  ) : null}
                </span>
                {totalText ? (
                  <span className="shrink-0 text-right">
                    <span className="block whitespace-nowrap text-base font-black leading-6 text-chead">{totalText}</span>
                    {nightlyText ? (
                      <span className="block whitespace-nowrap text-[11px] font-semibold leading-4 text-cgray">
                        {nightlyText} / night
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {quiet.length ? (
        <div className="mt-3 space-y-1">
          {quiet.map((option) => (
            <p key={option.id} className="text-xs font-semibold leading-5 text-cgray">
              {option.title} — no saved price for these dates
            </p>
          ))}
        </div>
      ) : null}

      {liveTotals ? (
        <p className="mt-4 text-sm font-semibold leading-6 text-chead" aria-live="polite">
          {selected ? "Stay " : "Stay estimate "}
          {moneyFromCents(liveTotals.stayEstimateCents, currency)}
          <span className="text-cgray"> · Trip total </span>
          {moneyFromCents(liveTotals.totalEstimateCents, currency)}
        </p>
      ) : null}

      {saveFailed ? (
        <p role="alert" className="mt-2 text-xs font-semibold leading-5 text-cred">
          We couldn&apos;t save that pick — your saved trip didn&apos;t change. Try again.
        </p>
      ) : null}

      {selected && pickedPartners.length ? (
        <HotelPartnerChoices
          partners={pickedPartners}
          tripId={tripId}
          title={selected.title}
          recommendationId={selected.id}
        />
      ) : null}

      {selectable.length ? (
        <p className="mt-3 text-[0.7rem] font-semibold leading-5 text-cgray">
          Stay prices from Stay22 partner search — refresh before booking.
        </p>
      ) : null}
    </div>
  );
}
