"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BookingKind = "flight" | "hotel" | "activity" | "restaurant" | "other";

type ExtractedReview = {
  title?: string;
  provider?: string;
  bookingType?: BookingKind;
  confirmationCode?: string;
  flightNumber?: string;
  startDate?: string;
  endDate?: string;
  origin?: string;
  destination?: string;
  address?: string;
  confidence?: "low" | "medium" | "high";
};

type ManualBookingFormProps = {
  tripId: string;
};

const bookingKinds: Array<{ value: BookingKind; label: string }> = [
  { value: "flight", label: "Flight" },
  { value: "hotel", label: "Hotel" },
  { value: "activity", label: "Activity" },
  { value: "restaurant", label: "Restaurant" },
  { value: "other", label: "Other" }
];

function toDateTime(date: string, time = "") {
  if (!date) return null;
  return `${date}T${time || "12:00"}:00`;
}

function fieldClass(uncertain = false) {
  return `mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10 ${
    uncertain ? "border-amber-300" : "border-slate-200"
  }`;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  uncertain = false,
  placeholder = ""
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  uncertain?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label}</span>
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass(uncertain)}
      />
      {uncertain ? <span className="mt-1 block text-sm font-bold text-amber-700">Check this field</span> : null}
    </label>
  );
}

export function ManualBookingForm({ tripId }: ManualBookingFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState<BookingKind>("flight");
  const [provider, setProvider] = useState("");
  const [title, setTitle] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [address, setAddress] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [review, setReview] = useState<ExtractedReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const uncertain = review?.confidence === "low";
  const canSave = useMemo(() => {
    if (kind === "flight") return Boolean((provider || title) && flightNumber && startDate && origin && destination);
    if (kind === "hotel") return Boolean((provider || title) && startDate && endDate);
    return Boolean(title && startDate);
  }, [destination, endDate, flightNumber, kind, origin, provider, startDate, title]);

  function applyReview(next: ExtractedReview) {
    setReview(next);
    if (next.bookingType) setKind(next.bookingType);
    if (next.provider) setProvider(next.provider);
    if (next.title) setTitle(next.title);
    if (next.confirmationCode) setConfirmationCode(next.confirmationCode);
    if (next.flightNumber) setFlightNumber(next.flightNumber);
    if (next.startDate) setStartDate(next.startDate);
    if (next.endDate) setEndDate(next.endDate);
    if (next.origin) setOrigin(next.origin);
    if (next.destination) setDestination(next.destination);
    if (next.address) setAddress(next.address);
  }

  async function upload(file?: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/trips/${tripId}/bookings/extract`, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || "We could not read that file.");
      applyReview(data.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!canSave) {
      setError("Add the required booking details first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingType: kind,
          bookingStatus: "confirmed",
          sourceType: review ? "upload" : "manual",
          title: title || provider || "Trip booking",
          provider: provider || title,
          confirmationCode,
          flightNumber: kind === "flight" ? flightNumber : null,
          startTime: toDateTime(startDate, startTime),
          endTime: kind === "hotel" ? toDateTime(endDate, "11:00") : null,
          checkInTime: kind === "hotel" ? toDateTime(startDate, "15:00") : null,
          checkOutTime: kind === "hotel" ? toDateTime(endDate, "11:00") : null,
          origin,
          destination,
          address,
          travelerConfirmed: true
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || "We could not save this booking.");
      router.push(`/trip/${tripId}/bookings`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not save this booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <section className="rounded-[1.15rem] border border-slate-200 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.07)] sm:p-7">
        <p className="text-sm font-black text-ocean">Add booking</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">Save what you booked</h1>
        <p className="mt-2 text-base font-semibold leading-7 text-slate-600">Enter it yourself or upload a confirmation.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-ink">
            <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
            Upload confirmation
          </label>
          <button type="button" onClick={() => setReview(null)} className="min-h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-ink">
            Enter manually
          </button>
          <a href={`/trip/${tripId}/bookings`} className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-ink">
            Back to bookings
          </a>
        </div>

        {review ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-black text-amber-800">Review booking</p>
            <p className="mt-1 text-sm font-bold text-amber-800">
              {uncertain ? "Some fields need checking before saving." : "Confirm these details before saving."}
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {bookingKinds.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setKind(item.value)}
              className={`min-h-11 rounded-2xl px-4 py-2 text-sm font-black ${
                kind === item.value ? "bg-ink text-white" : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4">
          {kind === "flight" ? (
            <>
              <Field label="Airline" value={provider} onChange={setProvider} uncertain={uncertain && !provider} placeholder="Air Canada" />
              <Field label="Flight number" value={flightNumber} onChange={setFlightNumber} uncertain={uncertain && !flightNumber} placeholder="AC870" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
                <Field label="Departure time" type="time" value={startTime} onChange={setStartTime} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" value={origin} onChange={setOrigin} uncertain={uncertain && !origin} placeholder="YUL" />
                <Field label="To" value={destination} onChange={setDestination} uncertain={uncertain && !destination} placeholder="CDG" />
              </div>
              <Field label="Confirmation code" value={confirmationCode} onChange={setConfirmationCode} placeholder="Optional" />
            </>
          ) : kind === "hotel" ? (
            <>
              <Field label="Hotel name" value={provider} onChange={setProvider} uncertain={uncertain && !provider} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Check-in" type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
                <Field label="Check-out" type="date" value={endDate} onChange={setEndDate} uncertain={uncertain && !endDate} />
              </div>
              <Field label="Address" value={address} onChange={setAddress} placeholder="Optional" />
              <Field label="Confirmation code" value={confirmationCode} onChange={setConfirmationCode} placeholder="Optional" />
            </>
          ) : (
            <>
              <Field label="Name" value={title} onChange={setTitle} uncertain={uncertain && !title} />
              <Field label="Date" type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
              <Field label="Location" value={address} onChange={setAddress} placeholder="Optional" />
              <Field label="Confirmation code" value={confirmationCode} onChange={setConfirmationCode} placeholder="Optional" />
            </>
          )}
        </div>

        {error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-black text-rose-700">{error}</p> : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !canSave}
          className="mt-6 min-h-14 w-full rounded-2xl bg-ink px-5 py-3 text-base font-black text-white disabled:opacity-50 sm:w-auto"
        >
          {busy ? "Saving..." : "Save booking"}
        </button>
      </section>
    </div>
  );
}
