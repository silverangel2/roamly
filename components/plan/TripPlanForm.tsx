"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  accommodationOptions,
  currencyOptions,
  paceOptions,
  transportationOptions,
  travelStyles,
  tripInterests,
  type TripPlannerPayload
} from "@/lib/trip-planner";
import { useI18n } from "@/components/i18n/I18nProvider";

const steps = [
  { title: "Destination", detail: "Where and how long" },
  { title: "Budget", detail: "Dates and money" },
  { title: "Style", detail: "Trip personality" },
  { title: "Interests", detail: "What matters" },
  { title: "Review", detail: "Generate and lock" }
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toNumberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-black text-ink">{children}</span>;
}

type PriceDiscoveryResult = {
  flightEstimateCents: number;
  hotelEstimateCents: number;
  activitiesEstimateCents: number;
  foodEstimateCents: number;
  localTransportEstimateCents: number;
  bufferEstimateCents: number;
  totalEstimateCents: number;
  committedBudgetCents: number;
  remainingBudgetCents: number | null;
  budgetStatus: "within_budget" | "tight" | "over_budget";
  budgetCurrency: string;
  coverageNote: string;
};

function formatMoney(cents: number | null, currency: string) {
  if (cents == null) return "Not set";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function budgetStatusCopy(status: PriceDiscoveryResult["budgetStatus"]) {
  if (status === "tight") {
    return "Your budget is tight. Roamly will prioritize affordable stays, free attractions, public transit, and low-cost food.";
  }
  if (status === "over_budget") {
    return "This trip may exceed your budget. You can still continue, but Roamly recommends changing dates, destination, trip length, or excluding flights/hotel.";
  }
  return "Your trip looks possible within budget.";
}

function TextInput({
  value,
  onChange,
  ariaLabel,
  type = "text"
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  type?: "text" | "date" | "number";
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={type}
      min={type === "date" ? todayIsoDate() : undefined}
      aria-label={ariaLabel}
      className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
    />
  );
}

function SelectField({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  const { translateText } = useI18n();

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {translateText(option)}
        </option>
      ))}
    </select>
  );
}

function Chip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-2xl border px-4 py-3 text-sm font-black transition",
        selected
          ? "border-ink bg-ink text-white shadow-soft"
          : "border-cloud bg-white text-slate-600 hover:border-ocean/40 hover:text-ink"
      )}
    >
      {label}
    </button>
  );
}

export function TripPlanForm({ freeItineraryUsed = false }: { freeItineraryUsed?: boolean }) {
  const router = useRouter();
  const { locale } = useI18n();
  const [step, setStep] = useState(0);
  const [destination, setDestination] = useState("");
  const [origin, setOrigin] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [daysCount, setDaysCount] = useState("");
  const [travelersCount, setTravelersCount] = useState("1");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<(typeof currencyOptions)[number]>("CAD");
  const [budgetIncludesFlights, setBudgetIncludesFlights] = useState(true);
  const [budgetIncludesHotel, setBudgetIncludesHotel] = useState(true);
  const [travelStyle, setTravelStyle] = useState<(typeof travelStyles)[number]>("Balanced");
  const [interests, setInterests] = useState<string[]>(["Food", "Culture"]);
  const [pace, setPace] = useState<(typeof paceOptions)[number]>("Normal");
  const [accommodationPreference, setAccommodationPreference] =
    useState<(typeof accommodationOptions)[number]>("Mid-range");
  const [transportationPreference, setTransportationPreference] =
    useState<(typeof transportationOptions)[number]>("Mixed");
  const [specialNotes, setSpecialNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [priceChecking, setPriceChecking] = useState(false);
  const [priceDiscovery, setPriceDiscovery] = useState<PriceDiscoveryResult | null>(null);
  const [priceDiscoveryId, setPriceDiscoveryId] = useState<string | null>(null);
  const [budgetConstraint, setBudgetConstraint] = useState("");

  const progress = Math.round(((step + 1) / steps.length) * 100);

  const payload: TripPlannerPayload = useMemo(
    () => ({
      origin: origin.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      daysCount: toNumberOrNull(daysCount),
      travelersCount: toNumberOrNull(travelersCount) || 1,
      budgetAmount: toNumberOrNull(budgetAmount),
      budgetCurrency,
      budgetIncludesFlights,
      budgetIncludesHotel,
      travelStyle,
      interests,
      pace,
      accommodationPreference,
      transportationPreference,
      specialNotes: specialNotes.trim(),
      language: locale,
      priceDiscoveryId,
      budgetConstraint
    }),
    [
      accommodationPreference,
      budgetAmount,
      budgetConstraint,
      budgetCurrency,
      budgetIncludesFlights,
      budgetIncludesHotel,
      daysCount,
      destination,
      endDate,
      interests,
      locale,
      origin,
      pace,
      priceDiscoveryId,
      specialNotes,
      startDate,
      transportationPreference,
      travelersCount,
      travelStyle
    ]
  );

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest]
    );
  }

  function validateCurrentStep() {
    if (step === 0 && !destination.trim()) return "Add a destination first.";
    if (step === 0 && !daysCount && (!startDate || !endDate)) {
      return "Add dates or a number of days.";
    }
    if (step === 1 && !budgetAmount) return "Add an estimated budget.";
    if (step === 3 && interests.length === 0) return "Pick at least one interest.";
    return "";
  }

  function goNext() {
    const validation = validateCurrentStep();
    setError(validation);
    if (validation) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  function goBack() {
    setError("");
    setNotice("");
    setStep((current) => Math.max(current - 1, 0));
  }

  async function runPriceDiscovery() {
    setPriceChecking(true);
    setNotice("Checking trip costs...");
    setError("");

    try {
      const response = await fetch("/api/roamly/price-discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) {
        router.push("/login?next=/plan");
        return false;
      }
      if (!response.ok) throw new Error(data?.message || data?.error || "Could not check trip costs.");
      setPriceDiscovery(data.discovery);
      setPriceDiscoveryId(data.discoveryId || null);
      setBudgetConstraint(data.budgetConstraint || "");
      setNotice("");
      return true;
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not check trip costs.");
      return false;
    } finally {
      setPriceChecking(false);
    }
  }

  async function openFinalConfirmation() {
    const validation = validateCurrentStep();
    setError(validation);
    setNotice("");
    if (validation) return;
    const checked = await runPriceDiscovery();
    if (!checked) return;
    setConfirming(true);
  }

  async function submitPlan() {
    const validation = validateCurrentStep();
    setError(validation);
    setNotice("");
    if (validation) return;

    setLoading(true);

    try {
      const response = await fetch("/api/trips/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        router.push("/login?next=/plan");
        return;
      }

      if (response.ok && data?.tripId) {
        router.push(data.previewUrl || `/trip/${data.tripId}`);
        return;
      }

      if (response.status === 402 && data?.previewUrl) {
        router.push(data.previewUrl);
        return;
      }

      if (response.status === 404 || response.status === 501) {
        setNotice("Planner form is ready, but itinerary generation is not connected yet.");
        return;
      }

      throw new Error(data?.setupHint || data?.error || "Trip generation is not ready yet.");
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Trip generation is not ready yet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[2rem] border border-cloud bg-white/92 p-4 shadow-soft backdrop-blur sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            Step {step + 1} of {steps.length}
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-ink">{steps[step].title}</h2>
          <p className="mt-1 text-sm font-bold text-slate-500">{steps[step].detail}</p>
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-mist text-sm font-black text-ocean">
          {progress}%
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-cloud">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ocean to-lagoon transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-5 min-h-[24rem]">
        {step === 0 ? (
          <div className="grid gap-4">
            <label className="block">
              <FieldLabel>Origin / leaving from</FieldLabel>
              <TextInput value={origin} onChange={setOrigin} ariaLabel="Origin city or country" />
            </label>
            <label className="block">
              <FieldLabel>Destination / city / country</FieldLabel>
              <TextInput value={destination} onChange={setDestination} ariaLabel="Destination city or country" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>Start date</FieldLabel>
                <TextInput value={startDate} onChange={setStartDate} type="date" ariaLabel="Start date" />
              </label>
              <label className="block">
                <FieldLabel>End date</FieldLabel>
                <TextInput value={endDate} onChange={setEndDate} type="date" ariaLabel="End date" />
              </label>
            </div>
            <label className="block">
              <FieldLabel>Or number of days</FieldLabel>
              <TextInput value={daysCount} onChange={setDaysCount} type="number" ariaLabel="Number of travel days" />
            </label>
            <label className="block">
              <FieldLabel>Travelers</FieldLabel>
              <TextInput value={travelersCount} onChange={setTravelersCount} type="number" ariaLabel="Number of travelers" />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr]">
              <label className="block">
                <FieldLabel>Budget amount</FieldLabel>
                <TextInput value={budgetAmount} onChange={setBudgetAmount} type="number" ariaLabel="Budget amount" />
              </label>
              <label className="block">
                <FieldLabel>Currency</FieldLabel>
                <SelectField value={budgetCurrency} onChange={(value) => setBudgetCurrency(value as typeof budgetCurrency)} options={currencyOptions} />
              </label>
            </div>
            <div className="rounded-2xl bg-mist p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Roamly budget rule</p>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                Use your comfortable total. Roamly checks flights, stays, food, activities, local transportation, and buffer before generation.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setBudgetIncludesFlights((value) => !value)}
                className={`rounded-2xl px-4 py-3 text-sm font-black ring-1 ring-cloud ${budgetIncludesFlights ? "bg-ink text-white" : "bg-white text-ink"}`}
              >
                {budgetIncludesFlights ? "Budget includes flights" : "Flights already handled"}
              </button>
              <button
                type="button"
                onClick={() => setBudgetIncludesHotel((value) => !value)}
                className={`rounded-2xl px-4 py-3 text-sm font-black ring-1 ring-cloud ${budgetIncludesHotel ? "bg-ink text-white" : "bg-white text-ink"}`}
              >
                {budgetIncludesHotel ? "Budget includes hotel" : "Hotel already handled"}
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-5">
            <div>
              <FieldLabel>Travel style</FieldLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {travelStyles.map((style) => (
                  <Chip
                    key={style}
                    label={style}
                    selected={travelStyle === style}
                    onClick={() => setTravelStyle(style)}
                  />
                ))}
              </div>
            </div>
            <label className="block">
              <FieldLabel>Pace</FieldLabel>
              <SelectField value={pace} onChange={(value) => setPace(value as typeof pace)} options={paceOptions} />
            </label>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-5">
            <div>
              <FieldLabel>Interests</FieldLabel>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {tripInterests.map((interest) => (
                  <Chip
                    key={interest}
                    label={interest}
                    selected={interests.includes(interest)}
                    onClick={() => toggleInterest(interest)}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>Accommodation</FieldLabel>
                <SelectField
                  value={accommodationPreference}
                  onChange={(value) => setAccommodationPreference(value as typeof accommodationPreference)}
                  options={accommodationOptions}
                />
              </label>
              <label className="block">
                <FieldLabel>Transportation</FieldLabel>
                <SelectField
                  value={transportationPreference}
                  onChange={(value) => setTransportationPreference(value as typeof transportationPreference)}
                  options={transportationOptions}
                />
              </label>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4">
            <label className="block">
              <FieldLabel>Special notes</FieldLabel>
              <textarea
                value={specialNotes}
                onChange={(event) => setSpecialNotes(event.target.value)}
                rows={5}
                aria-label="Special trip notes"
                className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold leading-7 text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
              />
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                Add mobility needs, must-see spots, food restrictions, celebrations, weather backup plans, or anything Roamly should consider.
              </p>
            </label>
            <div className="rounded-[1.5rem] bg-ink p-4 text-white">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-lagoon">Trip brief</p>
              <h3 className="mt-2 text-xl font-black">{payload.destination || "Destination pending"}</h3>
              <div className="mt-3 grid gap-2 text-sm font-bold text-white/76">
                <p>{payload.daysCount ? `${payload.daysCount} days` : `${payload.startDate || "Start"} to ${payload.endDate || "End"}`}</p>
                <p>{payload.travelersCount || 1} traveler{(payload.travelersCount || 1) === 1 ? "" : "s"}</p>
                <p>{payload.budgetAmount ? `${payload.budgetCurrency} ${payload.budgetAmount}` : "Budget pending"}</p>
                <p>{payload.travelStyle} style · {payload.pace} pace</p>
                <p>{payload.interests.join(", ") || "No interests selected"}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-4 rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {notice}
        </p>
      ) : null}

      {loading || priceChecking ? (
        <div className="mt-4 overflow-hidden rounded-2xl bg-mist p-4">
          <div className="h-2 animate-pulse rounded-full bg-lagoon" />
          <p className="mt-3 text-sm font-black text-ink">
            {priceChecking ? "Checking trip costs..." : "Generating and locking your itinerary..."}
          </p>
        </div>
      ) : null}

      {step === steps.length - 1 ? (
        <div className="mt-4 rounded-[1.25rem] border border-sun/30 bg-sun/10 p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Before you generate</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
            Review your trip details carefully. Once your itinerary is generated, it cannot be edited. New
            destinations, date changes, or major changes require a new itinerary.
          </p>
        </div>
      ) : null}

      {step === steps.length - 1 && priceDiscovery ? (
        <div className="mt-4 rounded-[1.5rem] border border-cloud bg-white p-4 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Budget check</p>
          <h3 className="mt-2 text-xl font-black text-ink">{budgetStatusCopy(priceDiscovery.budgetStatus)}</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              ["Flights", priceDiscovery.flightEstimateCents],
              ["Hotel/stay", priceDiscovery.hotelEstimateCents],
              ["Activities", priceDiscovery.activitiesEstimateCents],
              ["Food", priceDiscovery.foodEstimateCents],
              ["Local transport", priceDiscovery.localTransportEstimateCents],
              ["Buffer", priceDiscovery.bufferEstimateCents],
              ["Committed bookings", priceDiscovery.committedBudgetCents],
              ["Total estimate", priceDiscovery.totalEstimateCents],
              ["Remaining budget", priceDiscovery.remainingBudgetCents]
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl bg-mist p-3">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-black text-ink">
                  {formatMoney(value as number | null, priceDiscovery.budgetCurrency)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">{priceDiscovery.coverageNote}</p>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || loading}
          className="rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-ocean/30 disabled:translate-y-0 disabled:opacity-40"
        >
          Back
        </button>
        {step < steps.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={loading}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={openFinalConfirmation}
            disabled={loading || priceChecking}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
          >
            {priceChecking
              ? "Checking costs..."
              : freeItineraryUsed
                ? "Unlock full itinerary - $4.99 CAD"
                : "Generate my free itinerary"}
          </button>
        )}
      </div>

      {step === steps.length - 1 ? (
        <p className="mt-3 text-center text-xs font-bold leading-5 text-slate-500">
          {freeItineraryUsed
            ? "One custom itinerary for one trip. No subscription."
            : "You get 1 free itinerary per account."}
        </p>
      ) : null}

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
                disabled={loading}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink ring-1 ring-cloud transition hover:ring-ocean/30 disabled:opacity-60"
              >
                Go back and edit
              </button>
              <button
                type="button"
                onClick={submitPlan}
                disabled={loading}
                className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-ocean disabled:opacity-60"
              >
                {loading ? "Generating..." : "Generate itinerary"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
