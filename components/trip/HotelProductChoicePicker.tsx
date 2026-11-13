"use client";

import { useRef, useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { BuiCard } from "@/components/boardui/Card";
import { BuiButton } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiChip } from "@/components/boardui/Badge";
import { cx } from "@/components/boardui/cx";
import { useI18n } from "@/components/i18n/I18nProvider";
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

function readableChanges(changes: string[], translateText: (text: string) => string) {
  return changes.map((change) => translateText(changeLabels[change] || "A factual detail changed"));
}

function amount(option: HotelProductPresentationOption, translateText: (text: string) => string) {
  if (option.price.state === "UNKNOWN") return translateText("Price unavailable");
  const value = option.price.amount == null ? translateText("Price unavailable") : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(option.price.amount);
  return option.price.currency ? `${option.price.currency} ${value}` : value;
}

function cancellationLabel(state: HotelProductPresentationOption["cancellation"]["state"], translateText: (text: string) => string) {
  if (state === "PROVEN_FLEXIBLE") return translateText("Refundable terms shown");
  if (state === "PROVEN_NON_REFUNDABLE") return translateText("Non-refundable");
  if (state === "PARTIAL") return translateText("Cancellation terms partial");
  return translateText("Cancellation terms unavailable");
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
  const { translateText } = useI18n();
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
          setNotice({ tone: "error", text: translateText("Your selection could not be confirmed. Please try again.") });
          return;
        }
        setPendingChoice(next);
        setReview(null);
        setNotice({ tone: "notice", text: translateText("Your preferred hotel option is selected. Availability and terms can still change.") });
        return;
      }
      if (data?.error === "MATERIAL_CHANGE_ACKNOWLEDGEMENT_REQUIRED" && Array.isArray(data?.materialChanges)) {
        const changes = data.materialChanges.filter((item: unknown): item is string => typeof item === "string" && Boolean(changeLabels[item]));
        if (changes.length) {
          setReview({ productId, changes });
          return;
        }
        setNotice({ tone: "error", text: translateText("This option changed in a way we cannot safely review yet.") });
        return;
      }
      if (data?.error === "PRODUCT_NO_LONGER_CURRENT") {
        setNotice({ tone: "error", text: translateText("This option is no longer available.") });
        return;
      }
      if (data?.error === "PRODUCT_REVALIDATION_FAILED") {
        setNotice({ tone: "error", text: translateText("We couldn't refresh this option right now. Please try again.") });
        return;
      }
      if (data?.error === "CONFIRMED_BOOKING_AUTHORITATIVE") {
        setNotice({ tone: "notice", text: translateText("Your confirmed hotel booking remains authoritative.") });
        return;
      }
      setNotice({ tone: "error", text: translateText("We couldn't confirm this option right now. Please try again.") });
    } catch {
      setNotice({ tone: "error", text: translateText("We couldn't refresh this option right now. Please try again.") });
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
        setNotice({ tone: "error", text: translateText("We couldn't clear this selection right now. Please try again.") });
        return;
      }
      setPendingChoice(null);
      setReview(null);
      setNotice({ tone: "notice", text: translateText("Selection cleared. Your selected hotel and trip remain unchanged.") });
    } catch {
      setNotice({ tone: "error", text: translateText("We couldn't clear this selection right now. Please try again.") });
    } finally {
      mutationInFlight.current = false;
      setBusyProductId(null);
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      {pendingMissingFromDisplay ? (
        <p role="status" className="rounded-bui-card border border-sun/40 bg-sun/15 px-3 py-3 text-sm font-black leading-6 text-amber-900">
          {translateText("Your previous product selection is not shown in the current options. Choose another option only if you want to change it.")}
        </p>
      ) : null}
      {notice ? (
        <BuiNotice tone={notice.tone === "error" ? "error" : "info"} title={notice.text} />
      ) : null}
      {presentation.products.map((option) => {
        const productId = option.providerProductId;
        const isSelected = Boolean(productId && pendingChoice?.providerProductId === productId);
        const canChoose = selectable(presentation, option);
        const busy = busyProductId === productId;
        return (
          <BuiCard key={`${productId || "unidentified"}-${option.displayName}`} className={cx("min-w-0 p-3", isSelected && "bg-cblue/5 ring-1 ring-cblue/50")}>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h4 className="break-words text-base font-black text-ink">{option.displayName}</h4>
                <p className="mt-1 text-sm font-black text-ink">{amount(option, translateText)}</p>
              </div>
              {option.recommendation === "RECOMMENDED" && presentation.inventoryStatus === "CURRENT" ? <BuiChip tone="warm" className="shrink-0">{translateText("Recommended")}</BuiChip> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <BuiChip>{cancellationLabel(option.cancellation.state, translateText)}</BuiChip>
              {option.identity === "UNIDENTIFIED_INFORMATIONAL" ? <BuiChip>{translateText("Product identity unavailable")}</BuiChip> : null}
              {option.actionability === "INFORMATIONAL_ONLY" ? <BuiChip>{translateText("Informational only")}</BuiChip> : null}
            </div>
            {option.unresolvedFacts.length ? <p className="mt-2 text-xs font-bold leading-5 text-cgray">{translateText("Not verified:")}{" "}{option.unresolvedFacts.join(" · ")}</p> : null}
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {isSelected ? <p className="text-xs font-black uppercase tracking-[0.12em] text-cblue">{translateText("Selected option")}</p> : null}
                {!canChoose && !isSelected ? <p className="text-xs font-black uppercase tracking-[0.12em] text-cgray">{translateText("Comparison only")}</p> : null}
              </div>
              {isSelected ? (
                <BuiButton variant="secondary" onClick={() => void clearSelection()} disabled={Boolean(busyProductId)} busy={busyProductId === "clear"}>
                  {busyProductId === "clear" ? translateText("Clearing…") : translateText("Clear selection")}
                </BuiButton>
              ) : canChoose && productId ? (
                <BuiButton onClick={() => void choose(productId)} disabled={Boolean(busyProductId)} busy={busy} aria-label={`Choose this hotel option: ${option.displayName}`}>
                  {busy ? translateText("Refreshing this option…") : translateText("Choose this option")}
                </BuiButton>
              ) : null}
            </div>
            {review?.productId === productId ? (
              <div className="mt-3 rounded-bui-card border border-sun/40 bg-sun/15 p-3" role="alertdialog" aria-label={translateText("Review changed hotel option details")}>
                <p className="text-sm font-black text-amber-950">{translateText("A few factual details changed. Review them before choosing this option.")}</p>
                <ul className="mt-2 grid gap-1 text-sm font-bold text-amber-900">
                  {readableChanges(review.changes, translateText).map((change) => <li key={change}>• {change}</li>)}
                </ul>
                <p className="mt-2 text-xs font-bold leading-5 text-amber-900">{translateText("This still does not book or reserve the room.")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <BuiButton onClick={() => void choose(productId, review.changes)} disabled={Boolean(busyProductId)} busy={busy}>
                    {busy ? translateText("Refreshing this option…") : translateText("Accept changes and choose")}
                  </BuiButton>
                  <BuiButton variant="secondary" onClick={() => setReview(null)} disabled={Boolean(busyProductId)}>
                    {translateText("Cancel")}
                  </BuiButton>
                </div>
              </div>
            ) : null}
          </BuiCard>
        );
      })}
      <p className="text-xs font-bold leading-5 text-cgray">{translateText("Choosing an option records your preference for this hotel product. It does not guarantee availability, pricing, or booking terms.")}</p>
    </div>
  );
}
