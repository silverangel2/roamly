import type { HotelProductPresentation } from "@/lib/roamly/hotelProductPresentation";
import { HotelProductChoicePicker } from "@/components/trip/HotelProductChoicePicker";

type PendingHotelProductChoice = {
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

const disclosureCopy: Record<string, string> = {
  PRICE_UNAVAILABLE: "Price unavailable",
  CURRENCY_NOT_COMPARABLE: "Prices shown in different currencies",
  ADDITIONAL_CHARGES_MAY_BE_UNKNOWN: "Additional charges may be unknown",
  CANCELLATION_TERMS_UNAVAILABLE_OR_PARTIAL: "Cancellation terms unavailable or partial",
  PAYMENT_TERMS_UNAVAILABLE: "Payment terms unavailable",
  MEAL_PLAN_UNAVAILABLE: "Meal plan not verified",
  AVAILABILITY_NEEDS_REFRESH: "Availability needs refresh",
  EXACT_PRODUCT_BOOKING_UNVERIFIED: "Exact room/rate booking is not verified yet",
  RECOMMENDED: "Recommended",
  DUPLICATE_PRODUCT_ID: "Detailed options need review",
  PRODUCT_OPTIONS_UNTRUSTED: "Detailed options could not be verified"
};

export function HotelProductOptions({ presentation, tripId, pendingChoice }: { presentation: HotelProductPresentation | null; tripId: string; pendingChoice: PendingHotelProductChoice | null }) {
  if (!presentation || (!presentation.hotelCandidateId && presentation.inventoryStatus !== "CONFIRMED_BOOKING")) return null;
  const disclosures = presentation.stateCodes.map((code) => disclosureCopy[code] || "Some rate details are not verified yet").filter((copy, index, all) => all.indexOf(copy) === index);
  const criticalCodes = ["AVAILABILITY_NEEDS_REFRESH", "PRICE_UNAVAILABLE", "CURRENCY_NOT_COMPARABLE", "EXACT_PRODUCT_BOOKING_UNVERIFIED"];
  const criticalDisclosures = presentation.stateCodes.filter((code) => criticalCodes.includes(code)).map((code) => disclosureCopy[code]);
  const secondaryDisclosures = disclosures.filter((copy) => !criticalDisclosures.includes(copy)).slice(0, 2);

  return (
    <section aria-labelledby="hotel-product-options-title" className="mt-6 rounded-2xl border border-[#e8dfd0] bg-white/90 p-4 shadow-[0_12px_34px_rgba(16,32,51,0.04)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Selected hotel</p>
          <h3 id="hotel-product-options-title" className="mt-1 text-xl font-black text-ink">Room &amp; rate options</h3>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">Room and rate details are for comparison; exact product booking is not verified.</p>
        </div>
      </div>

      {presentation.inventoryStatus === "CONFIRMED_BOOKING" ? (
        <p className="mt-4 rounded-xl border border-ocean/20 bg-ocean/5 px-3 py-3 text-sm font-black text-ocean">Your confirmed hotel booking remains authoritative.</p>
      ) : presentation.products.length ? (
        <HotelProductChoicePicker tripId={tripId} presentation={presentation} initialPendingChoice={pendingChoice} />
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-[#e8dfd0] bg-[#fffdf8] px-3 py-3 text-sm font-black text-slate-500">Detailed room and rate options aren&apos;t available yet.</p>
      )}

      {criticalDisclosures.length || secondaryDisclosures.length ? <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{[...criticalDisclosures, ...secondaryDisclosures].join(" · ")}</p> : null}
      {presentation.requiresRevalidation ? <p className="mt-2 text-xs font-black text-amber-800">Availability needs refresh before relying on these options.</p> : null}
    </section>
  );
}
