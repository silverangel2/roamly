"use client";

import { useMemo, useState } from "react";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import { formatRoamlyCurrency, formatRoamlyDate } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { groupConfirmedBudgetTotals } from "@/lib/roamly/bookingBudgetCard";

type Booking = {
  id?: string;
  booking_type: string;
  booking_status?: string | null;
  traveler_confirmed?: boolean | null;
  superseded_by_booking_id?: string | null;
  provider_name?: string | null;
  provider?: string | null;
  title?: string | null;
  confirmation_number?: string | null;
  confirmation_code?: string | null;
  amount_cents?: number | null;
  total_price?: number | null;
  currency?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  flight_number?: string | null;
  terminal?: string | null;
  gate?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  extraction_confidence?: string | null;
};

const bookingTypes = ["flight", "hotel", "attraction", "restaurant", "transport", "car_rental", "event", "other"];

function formatMoney(cents: number | null | undefined, currency: string, locale: Parameters<typeof formatRoamlyCurrency>[2]) {
  if (cents == null) return "No cost saved";
  return formatRoamlyCurrency(cents / 100, (currency || "CAD").toUpperCase(), locale, { maximumFractionDigits: 0 });
}

function bookingProvider(booking: Booking) {
  return booking.provider_name || booking.provider || "";
}

function bookingCostLabel(booking: Booking, locale: Parameters<typeof formatRoamlyCurrency>[2]) {
  if (typeof booking.amount_cents === "number") return formatMoney(booking.amount_cents, booking.currency || "CAD", locale);
  if (typeof booking.total_price === "number") {
    return formatRoamlyCurrency(booking.total_price, (booking.currency || "CAD").toUpperCase(), locale, { maximumFractionDigits: 0 });
  }
  return "No cost saved";
}

function bookingWhen(booking: Booking, locale: Parameters<typeof formatRoamlyDate>[1]) {
  const timestamp = booking.start_at || booking.start_time || "";
  if (timestamp && timestamp.includes("T")) {
    const date = new Date(timestamp);
    if (Number.isFinite(date.getTime())) {
      return formatRoamlyDate(date, locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
  }
  return [booking.start_date, booking.start_time].filter(Boolean).join(" ");
}

export function CommittedBudgetCard({ bookings }: { bookings: Booking[] }) {
  const { locale } = useI18n();
  // B13: canonical confirmation + per-currency totals (see
  // lib/roamly/bookingBudgetCard.ts). Pending, cancelled, superseded, and
  // unknown-amount rows never count as committed cost.
  const { confirmedCount, totals } = groupConfirmedBudgetTotals(bookings);

  return (
    <BuiCard className="p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Committed budget</p>
      {totals.length ? (
        totals.map(({ currency, cents }) => (
          <p key={currency} className="bui-display-number mt-2 text-3xl font-black text-ink">{formatMoney(cents, currency, locale)}</p>
        ))
      ) : (
        <p className="mt-2 text-3xl font-black text-ink">No confirmed bookings yet</p>
      )}
      <p className="mt-1 text-sm font-bold leading-6 text-slate-600">
        {confirmedCount ? `${confirmedCount} confirmed booking${confirmedCount === 1 ? "" : "s"} count${confirmedCount === 1 ? "s" : ""} as committed cost. ` : ""}
        Pending and unconfirmed bookings are not counted here. Price estimates stay separate.
      </p>
    </BuiCard>
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
        inputMode={type === "number" ? "decimal" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="bui-input mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10"
      />
    </label>
  );
}

export function TripBookingsList({ tripId, bookings }: { tripId: string; bookings: Booking[] }) {
  const { locale } = useI18n();
  void tripId;
  if (!bookings.length) {
    return (
      <div className="rounded-bui-card border border-chair bg-csoft px-4 py-3 text-sm font-black text-cgray">
        No confirmed bookings yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {bookings.map((booking) => {
        const address = booking.address || [booking.city, booking.region, booking.country].filter(Boolean).join(", ");
        const mapsLink = buildNavigationLinks({
          destinationLabel: booking.title,
          address,
          latitude: booking.latitude,
          longitude: booking.longitude
        })[0];
        return (
          <article key={booking.id || booking.title} className="bui-enter bui-lift rounded-bui-card border border-chair bg-white p-4 shadow-bui-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">{booking.booking_type}</p>
                <h3 className="mt-1 text-lg font-black text-ink">{booking.title || "Booking"}</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  {[bookingProvider(booking), booking.flight_number, bookingWhen(booking, locale)].filter(Boolean).join(" · ")}
                </p>
                {address ? <p className="mt-1 text-sm font-bold text-slate-500">{address}</p> : null}
              </div>
              <div className="bui-display-number w-fit rounded-full bg-csoft px-3 py-2 text-xs font-black text-ink">
                {bookingCostLabel(booking, locale)}
              </div>
            </div>
            <details className="mt-3 rounded-2xl bg-mist px-3 py-3">
              <summary className="cursor-pointer text-sm font-black text-ink">Booking details</summary>
              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600">
                {booking.confirmation_number || booking.confirmation_code ? <p>Reference: <span className="bui-display-number">{booking.confirmation_number || booking.confirmation_code}</span></p> : null}
                {booking.terminal ? <p>Terminal: {booking.terminal}</p> : null}
                {booking.gate ? <p>Gate: {booking.gate}</p> : null}
                {booking.booking_status ? <p>Status: {booking.booking_status}</p> : null}
                {booking.extraction_confidence ? <p>Extraction: {booking.extraction_confidence}</p> : null}
                {!booking.confirmation_number && !booking.booking_status && !booking.extraction_confidence ? <p>No extra details saved.</p> : null}
              </div>
            </details>
            {mapsLink ? (
              <BuiButtonLink href={mapsLink.href} target="_blank" rel="noreferrer" className="mt-3 w-full">
                Open in Maps
              </BuiButtonLink>
            ) : null}
          </article>
        );
      })}
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
    <div className="bui-enter rounded-bui-panel border border-cblue/25 bg-csoft p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Review extracted booking</p>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        Roamly extracted these details. Submit them for review; screenshot extraction alone does not confirm a booking.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Type</span>
          <select
            value={booking.booking_type || "other"}
            onChange={(event) => setBooking({ ...booking, booking_type: event.target.value })}
            className="bui-input mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none focus:border-ocean focus:ring-4 focus:ring-ocean/10"
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
      <BuiButton type="button" onClick={onConfirm} busy={busy} className="mt-4">
        {busy ? "Saving for review..." : "Submit booking details for review"}
      </BuiButton>
    </div>
  );
}

export function BookingScreenshotUploader({
  tripId,
  onExtracted,
  setBusy,
  setError
}: {
  onExtracted: (booking: Booking, evidenceToken: string) => void;
  tripId: string;
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
      form.append("tripId", tripId);
      const response = await fetch("/api/roamly/bookings/extract", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Booking extraction failed.");
      if (typeof data.evidenceToken !== "string" || !data.evidenceToken) throw new Error("Booking evidence signing failed.");
      onExtracted(data.booking, data.evidenceToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="bui-press block cursor-pointer rounded-bui-panel border border-dashed border-cblue/40 bg-white/80 p-5 text-center shadow-bui-card transition hover:border-cblue">
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
  const [evidenceToken, setEvidenceToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const hasOverBudgetWarning = useMemo(
    () => bookings.some((booking) => (booking.amount_cents || 0) > 0),
    [bookings]
  );

  async function confirmBooking() {
    if (!extracted) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/roamly/bookings/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // B10: send the traveler's review edits with the confirm. The server
        // diffs them against the signed extraction and stores any real
        // corrections as a separate pending assertion — the edits are neither
        // discarded nor treated as confirmed facts.
        body: JSON.stringify({ tripId, evidenceToken, corrections: extracted })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not save booking.");
      const refreshed = await fetch(`/api/roamly/bookings?tripId=${encodeURIComponent(tripId)}`, { cache: "no-store" });
      const refreshedData = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !Array.isArray(refreshedData?.bookings)) {
        throw new Error(refreshedData?.error || "Booking saved, but canonical booking reload failed.");
      }
      setBookings(refreshedData.bookings);
      setExtracted(null);
      setEvidenceToken("");
      if (data?.correctionsSaved) {
        setNotice(`Your corrections were saved for review (${data.correctionCount || 0} field${data.correctionCount === 1 ? "" : "s"}). They are not confirmed yet.`);
      }
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
        <BookingScreenshotUploader tripId={tripId} onExtracted={(booking, token) => { setExtracted(booking); setEvidenceToken(token); }} setBusy={setBusy} setError={setError} />
        <CommittedBudgetCard bookings={bookings} />
        {hasOverBudgetWarning ? (
          <BuiNotice tone="info" title="If confirmed bookings exceed your budget, Roamly will prioritize free and low-cost activities." />
        ) : null}
        {error ? <BuiNotice tone="error" title={error} /> : null}
        {notice ? <BuiNotice tone="success" title={notice} /> : null}
        {busy && !extracted ? (
          <div className="flex items-center gap-3 rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card">
            <BuiSkeleton className="h-4 w-24 shrink-0" />
            <p className="text-sm font-black text-ink">Reading screenshot...</p>
          </div>
        ) : null}
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
