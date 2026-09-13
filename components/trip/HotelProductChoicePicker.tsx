"use client";

import { useRef, useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import type { HotelProductPresentation, HotelProductPresentationOption } from "@/lib/roamly/hotelProductPresentation";

type PendingChoice = {
  tripId: string;
  provider: "booking_demand";
  providerPropertyId: string;
  selectedHotelCandidateId: string;
  providerProductId: string;
  revalidatedAt: string;
  chosenAt: string;
  acknowledgedMaterialChanges: string[];
  bookingContinuity: "UNVERIFIED";
  actionability: "INFORMATIONAL_ONLY";
};

type ChoicePickerProps = {
  tripId: string;
  presentation: HotelProductPresentation;
  initialPendingChoice: PendingChoice | null;
};

type Notice = { tone: "error" | "notice"; text: string } | null;

const changeLabels: Record<string, string> = {
  PRICE_CHANGED: "Price changed",
  CURRENCY_CHANGED: "Currency changed",
  ROOM_DESCRIPTION_CHANGED: "Room description changed",
  CANCELLATION_CHANGED: "Cancellation terms changed",
  CHARGES_CHANGED: "Charges changed",
  AVAILABILITY_CHANGED: "Availability changed"
};

function selectable(presentation: HotelProductPresentation, option: HotelProductPresentationOption) {
  return presentation.inventoryStatus === "CURRENT" &&
    !presentation.requiresRevalidation &&
    option.identity === "IDENTIFIED_INFORMATIONAL" &&
    option.eligibility === "ELIGIBLE" &&
    option.actionability === "PROPERTY_HANDOFF_AVAILABLE" &&
    typeof option.providerProductId === "string" &&
    option.providerProductId.length > 0;
}

function readableChanges(changes: string[]) {
  return changes.map((change) => changeLabels[change] || "A factual detail changed");
}

function amount(option: HotelProductPresentationOption) {
  if (option.price.state === "UNKNOWN") return "Price unavailable";
  const value = option.price.amount == null ? "Price unavailable" : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(option.price.amount);
  return option.price.currency ? `${option.price.currency} ${value}` : value;
}

function cancellationLabel(state: HotelProductPresentationOption["cancellation"]["state"]) {
  if (state === "PROVEN_FLEXIBLE") return "Refundable terms shown";
  if (state === "PROVEN_NON_REFUNDABLE") return "Non-refundable";
  if (state === "PARTIAL") return "Cancellation terms partial";
  return "Cancellation terms unavailable";
}

function safePending(value: unknown): PendingChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.tripId !== "string" || typeof row.providerProductId !== "string") return null;
  return {
    tripId: row.tripId,
    provider: "booking_demand",
    providerPropertyId: typeof row.providerPropertyId === "string" ? row.providerPropertyId : "",
    selectedHotelCandidateId: typeof row.selectedHotelCandidateId === "string" ? row.selectedHotelCandidateId : "",
    providerProductId: row.providerProductId,
    revalidatedAt: typeof row.revalidatedAt === "string" ? row.revalidatedAt : "",
    chosenAt: typeof row.chosenAt === "string" ? row.chosenAt : "",
    acknowledgedMaterialChanges: Array.isArray(row.acknowledgedMaterialChanges) ? row.acknowledgedMaterialChanges.filter((item): item is string => typeof item === "string") : [],
    bookingContinuity: "UNVERIFIED",
    actionability: "INFORMATIONAL_ONLY"
  };
}

export function HotelProductChoicePicker({ tripId, presentation, initialPendingChoice }: ChoicePickerProps) {
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(initialPendingChoice);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [review, setReview] = useState<{ productId: string; changes: string[] } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const mutationInFlight = useRef(false);

  if (presentation.inventoryStatus === "CONFIRMED_BOOKING") return null;

  const displayedProductIds = new Set(presentation.products.map((option) => option.providerProductId).filter((id): id is string => Boolean(id)));
  const pendingMissingFromDisplay = Boolean(pendingChoice && !displayedProductIds.has(pendingChoice.providerProductId));

  async function choose(productId: string, acknowledgedMaterialChanges?: string[]) {
    if (mutationInFlight.current || !productId) return;
    mutationInFlight.current = true;
    setBusyProductId(productId);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { providerProductId: productId };
      if (acknowledgedMaterialChanges?.length) body.acknowledgedMaterialChanges = acknowledgedMaterialChanges;
      const response = await fetchWithSupabaseAuth(`/api/trips/${encodeURIComponent(tripId)}/hotel-product-choice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const next = safePending(data?.pendingChoice);
        if (!next) {
          setNotice({ tone: "error", text: "Your selection could not be confirmed. Please try again." });
          return;
        }
        setPendingChoice(next);
        setReview(null);
        setNotice({ tone: "notice", text: "Your preferred hotel option is selected. Availability and terms can still change." });
        return;
      }
      if (data?.error === "MATERIAL_CHANGE_ACKNOWLEDGEMENT_REQUIRED" && Array.isArray(data?.materialChanges)) {
        const changes = data.materialChanges.filter((item: unknown): item is string => typeof item === "string" && Boolean(changeLabels[item]));
        if (changes.length) {
          setReview({ productId, changes });
          return;
        }
        setNotice({ tone: "error", text: "This option changed in a way we cannot safely review yet." });
        return;
      }
      if (data?.error === "PRODUCT_NO_LONGER_CURRENT") {
        setNotice({ tone: "error", text: "This option is no longer available." });
        return;
      }
      if (data?.error === "PRODUCT_REVALIDATION_FAILED") {
        setNotice({ tone: "error", text: "We couldn't refresh this option right now. Please try again." });
        return;
      }
      if (data?.error === "CONFIRMED_BOOKING_AUTHORITATIVE") {
        setNotice({ tone: "notice", text: "Your confirmed hotel booking remains authoritative." });
        return;
      }
      setNotice({ tone: "error", text: "We couldn't confirm this option right now. Please try again." });
    } catch {
      setNotice({ tone: "error", text: "We couldn't refresh this option right now. Please try again." });
    } finally {
      mutationInFlight.current = false;
      setBusyProductId(null);
    }
  }

  async function clearSelection() {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyProductId("clear");
    setNotice(null);
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${encodeURIComponent(tripId)}/hotel-product-choice`, { method: "DELETE" });
      if (!response.ok) {
        setNotice({ tone: "error", text: "We couldn't clear this selection right now. Please try again." });
        return;
      }
      setPendingChoice(null);
      setReview(null);
      setNotice({ tone: "notice", text: "Selection cleared. Your selected hotel and trip remain unchanged." });
    } catch {
      setNotice({ tone: "error", text: "We couldn't clear this selection right now. Please try again." });
    } finally {
      mutationInFlight.current = false;
      setBusyProductId(null);
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      {pendingMissingFromDisplay ? (
        <p className="rounded-xl border border-sun/40 bg-sun/15 px-3 py-3 text-sm font-black leading-6 text-amber-900">
          Your previous product selection is not shown in the current options. Choose another option only if you want to change it.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={`rounded-xl border px-3 py-3 text-sm font-black leading-6 ${notice.tone === "error" ? "border-coral/25 bg-coral/10 text-coral" : "border-ocean/20 bg-ocean/10 text-ocean"}`}>
          {notice.text}
        </p>
      ) : null}
      {presentation.products.map((option) => {
        const productId = option.providerProductId;
        const isSelected = Boolean(productId && pendingChoice?.providerProductId === productId);
        const canChoose = selectable(presentation, option);
        const busy = busyProductId === productId;
        return (
          <article key={`${productId || "unidentified"}-${option.displayName}`} className={`min-w-0 rounded-xl border p-3 ${isSelected ? "border-ocean/50 bg-ocean/5" : "border-[#eee5d7] bg-[#fffdf8]"}`}>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h4 className="break-words text-base font-black text-ink">{option.displayName}</h4>
                <p className="mt-1 text-sm font-black text-ink">{amount(option)}</p>
              </div>
              {option.recommendation === "RECOMMENDED" && presentation.inventoryStatus === "CURRENT" ? <span className="w-fit shrink-0 rounded-full border border-sun/40 bg-sun/20 px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.08em] text-amber-800">Recommended</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{cancellationLabel(option.cancellation.state)}</span>
              {option.identity === "UNIDENTIFIED_INFORMATIONAL" ? <span className="rounded-full bg-slate-100 px-2.5 py-1">Product identity unavailable</span> : null}
              {option.actionability === "INFORMATIONAL_ONLY" ? <span className="rounded-full bg-slate-100 px-2.5 py-1">Informational only</span> : null}
            </div>
            {option.unresolvedFacts.length ? <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Not verified: {option.unresolvedFacts.join(" · ")}</p> : null}
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {isSelected ? <p className="text-xs font-black uppercase tracking-[0.12em] text-ocean">Selected option</p> : null}
                {!canChoose && !isSelected ? <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Comparison only</p> : null}
              </div>
              {isSelected ? (
                <button type="button" onClick={() => void clearSelection()} disabled={Boolean(busyProductId)} className="min-h-11 rounded-xl border border-ocean/25 bg-white px-4 py-2.5 text-sm font-black text-ocean transition hover:bg-ocean/5 disabled:cursor-wait disabled:opacity-60">
                  {busyProductId === "clear" ? "Clearing…" : "Clear selection"}
                </button>
              ) : canChoose && productId ? (
                <button type="button" onClick={() => void choose(productId)} disabled={Boolean(busyProductId)} aria-label={`Choose this hotel option: ${option.displayName}`} className="min-h-11 rounded-xl bg-ocean px-4 py-2.5 text-sm font-black text-white transition hover:bg-ocean/90 disabled:cursor-wait disabled:opacity-60">
                  {busy ? "Refreshing this option…" : "Choose this option"}
                </button>
              ) : null}
            </div>
            {review?.productId === productId ? (
              <div className="mt-3 rounded-xl border border-sun/40 bg-sun/15 p-3" role="alertdialog" aria-label="Review changed hotel option details">
                <p className="text-sm font-black text-amber-950">A few factual details changed. Review them before choosing this option.</p>
                <ul className="mt-2 grid gap-1 text-sm font-bold text-amber-900">
                  {readableChanges(review.changes).map((change) => <li key={change}>• {change}</li>)}
                </ul>
                <p className="mt-2 text-xs font-bold leading-5 text-amber-900">This still does not book or reserve the room.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void choose(productId, review.changes)} disabled={Boolean(busyProductId)} className="min-h-11 rounded-xl bg-ocean px-4 py-2.5 text-sm font-black text-white transition hover:bg-ocean/90 disabled:opacity-60">
                    {busy ? "Refreshing this option…" : "Accept changes and choose"}
                  </button>
                  <button type="button" onClick={() => setReview(null)} disabled={Boolean(busyProductId)} className="min-h-11 rounded-xl border border-ocean/25 bg-white px-4 py-2.5 text-sm font-black text-ocean transition hover:bg-ocean/5 disabled:opacity-60">
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
      <p className="text-xs font-bold leading-5 text-slate-500">Choosing an option records your preference for this hotel product. It does not guarantee availability, pricing, or booking terms.</p>
    </div>
  );
}
