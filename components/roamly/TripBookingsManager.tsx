"use client";

import { useMemo, useState } from "react";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";

type Booking = {
  id?: string;
  booking_type: string;
  provider_name?: string | null;
  title?: string | null;
  confirmation_number?: string | null;
  booking_status?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raw_extracted_text?: string | null;
  extraction_confidence?: string | null;
};

const bookingTypes = ["flight", "hotel", "attraction", "restaurant", "transport", "car_rental", "event", "other"];

function formatMoney(cents?: number | null, currency = "CAD") {
  if (cents == null) return "No cost saved";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: (currency || "CAD").toUpperCase(),
    maximumFractionDigits: 0
  }).format(cents / 100);
}

export function CommittedBudgetCard({ bookings }: { bookings: Booking[] }) {
  const committed = bookings
    .filter((booking) => booking.booking_status !== "cancelled")
    .reduce((sum, booking) => sum + (booking.amount_cents || 0), 0);

  return (
    <div className="rounded-[1.5rem] border border-cloud bg-mist p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Committed budget</p>
      <p className="mt-2 text-3xl font-black text-ink">{formatMoney(committed)}</p>
      <p className="mt-1 text-sm font-bold leading-6 text-slate-600">
        Confirmed bookings count as committed cost. Price estimates stay separate.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <input
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10"
      />
    </label>
  );
}

export function TripBookingsList({ tripId, bookings }: { tripId: string; bookings: Booking[] }) {
  if (!bookings.length) {
    return (
      <div className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
        No confirmed bookings yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {bookings.map((booking) => (
        <article key={booking.id || booking.title} className="rounded-[1.25rem] border border-cloud bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">{booking.booking_type}</p>
              <h3 className="mt-1 text-lg font-black text-ink">{booking.title || "Booking"}</h3>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {[booking.provider_name, booking.start_date, booking.start_time].filter(Boolean).join(" · ")}
              </p>
              {booking.address ? <p className="mt-1 text-sm font-bold text-slate-500">{booking.address}</p> : null}
            </div>
            <div className="rounded-full bg-mist px-3 py-2 text-xs font-black text-ink">
              {formatMoney(booking.amount_cents, booking.currency || "CAD")}
            </div>
          </div>
          <NavigationButtons
            tripId={tripId}
            destinationLabel={booking.title}
            address={booking.address || [booking.city, booking.region, booking.country].filter(Boolean).join(", ")}
            latitude={booking.latitude}
            longitude={booking.longitude}
            className="mt-3"
          />
        </article>
      ))}
    </div>
  );
}

export function ExtractedBookingReviewCard({
  booking,
  setBooking,
  onConfirm,
  busy
}: {
  booking: Booking;
  setBooking: (booking: Booking) => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-[1.5rem] border border-ocean/20 bg-ocean/5 p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Review extracted booking</p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        Roamly extracted these details. Please confirm before adding them to your trip.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Type</span>
          <select
            value={booking.booking_type || "other"}
            onChange={(event) => setBooking({ ...booking, booking_type: event.target.value })}
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          >
            {bookingTypes.map((type) => (
              <option key={type} value={type}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <Field label="Title" value={booking.title || ""} onChange={(value) => setBooking({ ...booking, title: value })} />
        <Field
          label="Provider"
          value={booking.provider_name || ""}
          onChange={(value) => setBooking({ ...booking, provider_name: value })}
        />
        <Field
          label="Confirmation"
          value={booking.confirmation_number || ""}
          onChange={(value) => setBooking({ ...booking, confirmation_number: value })}
        />
        <Field
          label="Amount"
          type="number"
          value={booking.amount_cents == null ? "" : String(Math.round(booking.amount_cents / 100))}
          onChange={(value) => setBooking({ ...booking, amount_cents: value ? Number(value) * 100 : null })}
        />
        <Field
          label="Currency"
          value={(booking.currency || "CAD").toUpperCase()}
          onChange={(value) => setBooking({ ...booking, currency: value })}
        />
        <Field label="Start date" type="date" value={booking.start_date || ""} onChange={(value) => setBooking({ ...booking, start_date: value })} />
        <Field label="Start time" type="time" value={booking.start_time || ""} onChange={(value) => setBooking({ ...booking, start_time: value })} />
        <Field label="Address" value={booking.address || ""} onChange={(value) => setBooking({ ...booking, address: value })} />
        <Field label="City" value={booking.city || ""} onChange={(value) => setBooking({ ...booking, city: value })} />
      </div>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="mt-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400 disabled:opacity-60"
      >
        {busy ? "Saving booking..." : "Confirm and add to trip"}
      </button>
    </div>
  );
}

export function BookingScreenshotUploader({
  onExtracted,
  setBusy,
  setError
}: {
  onExtracted: (booking: Booking) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
}) {
  async function upload(file?: File | null) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/roamly/bookings/extract", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Booking extraction failed.");
      onExtracted(data.booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="block cursor-pointer rounded-[1.5rem] border border-dashed border-ocean/40 bg-white/80 p-5 text-center shadow-soft transition hover:border-ocean">
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <span className="text-sm font-black text-ink">Upload booking screenshot</span>
      <span className="mt-2 block text-xs font-bold leading-5 text-slate-500">
        Flight, hotel, ticket, restaurant, car rental, or reservation screenshot.
      </span>
    </label>
  );
}

export function TripBookingsManager({ tripId, initialBookings }: { tripId: string; initialBookings: Booking[] }) {
  const [bookings, setBookings] = useState(initialBookings);
  const [extracted, setExtracted] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasOverBudgetWarning = useMemo(
    () => bookings.some((booking) => (booking.amount_cents || 0) > 0),
    [bookings]
  );

  async function confirmBooking() {
    if (!extracted) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/roamly/bookings/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, booking: extracted })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save booking.");
      setBookings((current) => [data.booking, ...current]);
      setExtracted(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Already booked something?</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Import bookings by screenshot.</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Upload a screenshot of your flight, hotel, ticket, or reservation. Roamly will read it and add it to your trip.
          </p>
        </div>
        <BookingScreenshotUploader onExtracted={setExtracted} setBusy={setBusy} setError={setError} />
        <CommittedBudgetCard bookings={bookings} />
        {hasOverBudgetWarning ? (
          <p className="rounded-2xl bg-sun/10 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
            If confirmed bookings exceed your budget, Roamly will prioritize free and low-cost activities.
          </p>
        ) : null}
        {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
        {busy && !extracted ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-ink">Reading screenshot...</p> : null}
      </div>
      <div className="space-y-4">
        {extracted ? (
          <ExtractedBookingReviewCard booking={extracted} setBooking={setExtracted} onConfirm={confirmBooking} busy={busy} />
        ) : null}
        <TripBookingsList tripId={tripId} bookings={bookings} />
      </div>
    </section>
  );
}
