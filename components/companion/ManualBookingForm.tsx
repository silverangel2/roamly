"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BOOKING_ADDED_FLAG } from "@/components/companion/BookingAddedToast";
import { localizeCustomerError } from "@/lib/i18n";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiErrorSummary, BuiFieldError, useBuiField, type BuiField } from "@/components/boardui/Field";

type BookingKind = "flight" | "hotel" | "activity" | "restaurant" | "other";

type ExtractedReview = {
  title?: string;
  provider?: string;
  bookingType?: BookingKind;
  confirmationCode?: string;
  flightNumber?: string;
  airlineCode?: string;
  terminal?: string;
  gate?: string;
  baggage?: string;
  duration?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  origin?: string;
  destination?: string;
  address?: string;
  confidence?: "low" | "medium" | "high";
};

type ManualBookingFormProps = {
  tripId: string;
  // The trip's own currency (planner budget currency). Sent with every manual
  // kind so the server never has to guess the unit for an unknown price; null
  // means unknown and the server falls back to the trip, then the "XXX"
  // no-currency marker.
  tripCurrency?: string | null;
  referral?: {
    affiliateClickId: string;
    recommendationId: string | null;
    provider: string | null;
    title: string | null;
    bookingType: string | null;
  } | null;
};

const bookingKinds: Array<{ value: BookingKind; label: string }> = [
  { value: "flight", label: "flight" }, { value: "hotel", label: "hotel" }, { value: "activity", label: "activity" },
  { value: "restaurant", label: "restaurant" }, { value: "other", label: "other" }
];

function toDateTime(date: string, time = "", fallbackTime = "") {
  if (!date) return null;
  const clock = time || fallbackTime;
  if (!clock) return null;
  return `${date}T${clock}:00`;
}

/**
 * One labelled field on the BoardUI form pattern (owner form rules,
 * 2026-11-03): a real visible label that never leaves (never
 * placeholder-as-label), the foundation `bui-input` styling (16px
 * text, styled autofill), and — for fields with a validator — the
 * reserved BuiFieldError slot under the input, so an error appearing
 * never pushes the layout or the submit button down. Validation runs
 * on blur via useBuiField; once a field has errored, every keystroke
 * re-checks so the error clears the moment it is fixed. The optional
 * amber "check this field" hint is the screenshot-review assist, not
 * a validation error, and stays distinct from the red error slot.
 */
function BookingField({
  id,
  label,
  value,
  onChange,
  field,
  type = "text",
  uncertain = false,
  placeholder = ""
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field?: BuiField;
  type?: string;
  uncertain?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  return (
    <label className={field && field.shakeKey > 0 ? "bui-shake block" : "block"}>
      <span className="text-sm font-black text-chead">{label}</span>
      <input
        id={id}
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          field?.onChange(event.target.value);
        }}
        onBlur={field ? () => field.onBlur(value) : undefined}
        aria-invalid={field?.error ? true : undefined}
        aria-describedby={field?.error ? `${id}-error` : undefined}
        className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
          field?.error
            ? "border-cred focus:border-cred"
            : uncertain
              ? "border-amber-300 focus:border-amber-300"
              : "border-chair focus:border-cblue"
        }`}
      />
      {uncertain ? <span className="mt-1 block text-sm font-bold text-amber-700">{t("ui.booking.checkField")}</span> : null}
      {field ? <BuiFieldError id={`${id}-error`} message={field.error} /> : null}
    </label>
  );
}

export function ManualBookingForm({ tripId, tripCurrency = null, referral = null }: ManualBookingFormProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const referralKind = referral?.bookingType as BookingKind | null;
  const [kind, setKind] = useState<BookingKind>(referralKind && bookingKinds.some((option) => option.value === referralKind) ? referralKind : "flight");
  const [provider, setProvider] = useState(referral?.provider || "");
  const [title, setTitle] = useState(referral?.title || "");
  const [flightNumber, setFlightNumber] = useState("");
  const [airlineCode, setAirlineCode] = useState("");
  const [terminal, setTerminal] = useState("");
  const [gate, setGate] = useState("");
  const [baggage, setBaggage] = useState("");
  const [duration, setDuration] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [address, setAddress] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [review, setReview] = useState<ExtractedReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uncertain = review?.confidence === "low";

  /* Form rules (2026-11-03): the required set mirrors exactly what
     the save has always required per kind — flight: airline (or a
     review/referral title) + flight number + date + from + to;
     hotel: hotel name (or title) + check-in + check-out; other
     kinds: name + date. Validators run on blur, re-check per
     keystroke once errored, and run again at submit, where the
     BuiErrorSummary at the top names every broken field. */
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const providerLabel = kind === "hotel" ? t("ui.booking.hotelName") : t("ui.booking.airline");
  const startDateLabel = kind === "hotel" ? t("ui.booking.checkIn") : t("ui.booking.date");
  const providerField = useBuiField((value) => (!value.trim() && !title.trim() ? `${providerLabel} is required.` : ""));
  const titleField = useBuiField((value) => (!value.trim() ? `${t("ui.booking.name")} is required.` : ""));
  const flightNumberField = useBuiField((value) => (!value.trim() ? `${t("ui.booking.flightNumber")} is required.` : ""));
  const startDateField = useBuiField((value) => (!value ? `${startDateLabel} is required.` : ""));
  const endDateField = useBuiField((value) => (kind === "hotel" && !value ? `${t("ui.booking.checkOut")} is required.` : ""));
  const originField = useBuiField((value) => (!value.trim() ? `${t("ui.booking.from")} is required.` : ""));
  const destinationField = useBuiField((value) => (!value.trim() ? `${t("ui.booking.to")} is required.` : ""));

  const requiredFields: Array<{ id: string; label: string; field: BuiField; value: string }> =
    kind === "flight"
      ? [
          { id: "booking-provider", label: providerLabel, field: providerField, value: provider },
          { id: "booking-flight-number", label: t("ui.booking.flightNumber"), field: flightNumberField, value: flightNumber },
          { id: "booking-start-date", label: startDateLabel, field: startDateField, value: startDate },
          { id: "booking-origin", label: t("ui.booking.from"), field: originField, value: origin },
          { id: "booking-destination", label: t("ui.booking.to"), field: destinationField, value: destination }
        ]
      : kind === "hotel"
        ? [
            { id: "booking-provider", label: providerLabel, field: providerField, value: provider },
            { id: "booking-start-date", label: startDateLabel, field: startDateField, value: startDate },
            { id: "booking-end-date", label: t("ui.booking.checkOut"), field: endDateField, value: endDate }
          ]
        : [
            { id: "booking-title", label: t("ui.booking.name"), field: titleField, value: title },
            { id: "booking-start-date", label: startDateLabel, field: startDateField, value: startDate }
          ];
  const fieldSummary = requiredFields
    .filter((entry) => entry.field.error)
    .map((entry) => ({ fieldId: entry.id, label: entry.label, message: entry.field.error }));

  function applyReview(next: ExtractedReview) {
    setReview(next);
    if (next.bookingType) setKind(next.bookingType);
    if (next.provider) setProvider(next.provider);
    if (next.title) setTitle(next.title);
    if (next.confirmationCode) setConfirmationCode(next.confirmationCode);
    if (next.flightNumber) setFlightNumber(next.flightNumber);
    if (next.airlineCode) setAirlineCode(next.airlineCode);
    if (next.terminal) setTerminal(next.terminal);
    if (next.gate) setGate(next.gate);
    if (next.baggage) setBaggage(next.baggage);
    if (next.duration) setDuration(next.duration);
    if (next.startDate) setStartDate(next.startDate);
    if (next.startTime) setStartTime(next.startTime);
    if (next.endDate) setEndDate(next.endDate);
    if (next.endTime) setEndTime(next.endTime);
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
      if (!response.ok) throw new Error(data?.message || data?.error || t("ui.status.unexpectedError"));
      applyReview(data.booking);
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    setSubmitAttempted(true);
    const failures = requiredFields.filter((entry) => entry.field.runValidation(entry.value)).length;
    if (failures > 0) {
      setError("");
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
          bookingStatus: null,
          travelerConfirmed: false,
          // One currency field for every manual kind (flight, hotel, activity,
          // restaurant, other). Null means "no price known"; the server resolves
          // it from the trip and never writes null into the bookings table.
          currency: tripCurrency || null,
          recommendationId: referral?.recommendationId || null,
          affiliateClickId: referral?.affiliateClickId || null,
          sourceType: review ? "upload" : "manual",
          title: title || provider || "Trip booking",
          provider: provider || title,
          confirmationCode,
          flightNumber: kind === "flight" ? flightNumber : null,
          airlineCode: kind === "flight" ? airlineCode : null,
          terminal: kind === "flight" ? terminal : null,
          gate: kind === "flight" ? gate : null,
          startTime: toDateTime(startDate, startTime),
          endTime: kind === "flight" ? toDateTime(endDate || startDate, endTime) : kind === "hotel" ? toDateTime(endDate, "11:00") : null,
          // B04: the calendar dates travel as dates, so a date-only
          // activity or restaurant keeps its chosen date even when no
          // clock was given (the timestamp fields above stay null then).
          startDate: startDate || null,
          endDate: endDate || null,
          checkInTime: kind === "hotel" ? toDateTime(startDate, "15:00") : null,
          checkOutTime: kind === "hotel" ? toDateTime(endDate, "11:00") : null,
          origin,
          destination,
          address,
          reservationRequirements:
            kind === "flight"
              ? {
                  baggage: baggage || null,
                  duration: duration || null,
                  extraction_confidence: review?.confidence || null
                }
              : null,
          segments:
            kind === "flight"
              ? [
                  {
                    sequence: 1,
                    origin,
                    destination,
                    departureTime: toDateTime(startDate, startTime),
                    arrivalTime: toDateTime(endDate || startDate, endTime),
                    provider: provider || title,
                    serviceNumber: flightNumber,
                    terminal,
                    gate,
                    status: "unknown"
                  }
                ]
              : [],
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || t("ui.status.unexpectedError"));
      // Success Rules pass (2026-11-03), census row 13: this add
      // used to complete silently — the traveller landed on the
      // list with nothing naming what just happened. Leave the
      // booking's title as an arrival flag; BookingAddedToast on
      // the bookings page turns it into a named ~4s toast there.
      try {
        window.sessionStorage.setItem(
          BOOKING_ADDED_FLAG,
          JSON.stringify({ title: title.trim() || provider.trim() || "" })
        );
      } catch {
        // Storage unavailable: the list itself remains the record.
      }
      router.push(`/trip/${tripId}/bookings`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message === "BOOKING_SAVE_FAILED"
          ? t("ui.booking.saveFailed", "Couldn't save your booking. Please try again.")
          : localizeCustomerError(locale, err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <BuiCard className="p-5 sm:p-7">
        <p className="text-sm font-black text-cblue">{t("ui.booking.add")}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{t("ui.booking.saveWhatBooked")}</h1>
        <p className="mt-2 text-base font-semibold leading-7 text-slate-600">{t("ui.booking.enterOrUpload")}</p>

        {/* Rule 3: form-level problems surface at the TOP of the form —
            the submit summary links to each broken field, and server
            errors land in the same slot. Nothing error-shaped renders
            between the last field and the submit button, so appearing
            text can never push the button down. */}
        {submitAttempted ? (
          <div className="mt-4">
            <BuiErrorSummary errors={fieldSummary} />
          </div>
        ) : null}
        {error ? (
          <div className="mt-4">
            <BuiNotice tone="error" title={error} />
          </div>
        ) : null}

        {referral ? (
          <div className="mt-4">
            <BuiNotice tone="info" title="You marked a referred option as booked.">
              Add the actual booking details from your confirmation so Roamly can record them; this will not mark the booking confirmed by itself.
            </BuiNotice>
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            aria-label={t("ui.booking.upload")}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <BuiButton type="button" variant="secondary" busy={busy} onClick={() => fileInputRef.current?.click()} className="w-full">
            {t("ui.booking.upload")}
          </BuiButton>
          <BuiButton type="button" variant="secondary" onClick={() => setReview(null)} className="w-full">
            {t("ui.booking.manual")}
          </BuiButton>
          <BuiButtonLink href={`/trip/${tripId}/bookings`} variant="secondary" className="w-full">
            {t("ui.booking.back")}
          </BuiButtonLink>
        </div>

        {review ? (
          <div className="mt-5">
            <BuiNotice tone="info" title={t("ui.booking.review")}>
              {uncertain ? t("ui.booking.needsChecking") : t("ui.booking.confirmDetails")}
            </BuiNotice>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {bookingKinds.map((item) => (
            <BuiButton
              key={item.value}
              type="button"
              variant={kind === item.value ? "primary" : "secondary"}
              aria-pressed={kind === item.value}
              onClick={() => setKind(item.value)}
            >
              {t(`ui.booking.${item.label}`)}
            </BuiButton>
          ))}
        </div>

        <div className="mt-5 grid gap-4">
          {kind === "flight" ? (
            <>
              <BookingField key={`provider-${providerField.shakeKey}`} id="booking-provider" label={t("ui.booking.airline")} value={provider} onChange={setProvider} field={providerField} uncertain={uncertain && !provider} placeholder="Air Canada" />
              <BookingField key={`flight-number-${flightNumberField.shakeKey}`} id="booking-flight-number" label={t("ui.booking.flightNumber")} value={flightNumber} onChange={setFlightNumber} field={flightNumberField} uncertain={uncertain && !flightNumber} placeholder="AC870" />
              <div className="grid gap-4 sm:grid-cols-2">
                <BookingField key={`start-date-${startDateField.shakeKey}`} id="booking-start-date" label={t("ui.booking.date")} type="date" value={startDate} onChange={setStartDate} field={startDateField} uncertain={uncertain && !startDate} />
                <BookingField id="booking-start-time" label={t("ui.booking.departureTime")} type="time" value={startTime} onChange={setStartTime} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <BookingField id="booking-end-date" label={t("ui.booking.arrivalDate")} type="date" value={endDate} onChange={setEndDate} placeholder={startDate} />
                <BookingField id="booking-end-time" label={t("ui.booking.arrivalTime")} type="time" value={endTime} onChange={setEndTime} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <BookingField key={`origin-${originField.shakeKey}`} id="booking-origin" label={t("ui.booking.from")} value={origin} onChange={setOrigin} field={originField} uncertain={uncertain && !origin} placeholder="YUL" />
                <BookingField key={`destination-${destinationField.shakeKey}`} id="booking-destination" label={t("ui.booking.to")} value={destination} onChange={setDestination} field={destinationField} uncertain={uncertain && !destination} placeholder="CDG" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <BookingField id="booking-airline-code" label={t("ui.booking.airlineCode")} value={airlineCode} onChange={setAirlineCode} placeholder="AC" />
                <BookingField id="booking-terminal" label={t("ui.status.terminal", "Terminal")} value={terminal} onChange={setTerminal} placeholder="1" />
                <BookingField id="booking-gate" label={t("ui.booking.gate")} value={gate} onChange={setGate} placeholder="A12" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <BookingField id="booking-baggage" label={t("ui.booking.baggage")} value={baggage} onChange={setBaggage} placeholder="1 checked bag" />
                <BookingField id="booking-duration" label={t("ui.booking.duration")} value={duration} onChange={setDuration} placeholder="5h 40m" />
              </div>
              <BookingField id="booking-confirmation-code" label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
            </>
          ) : kind === "hotel" ? (
            <>
              <BookingField key={`provider-${providerField.shakeKey}`} id="booking-provider" label={t("ui.booking.hotelName")} value={provider} onChange={setProvider} field={providerField} uncertain={uncertain && !provider} />
              <div className="grid gap-4 sm:grid-cols-2">
                <BookingField key={`start-date-${startDateField.shakeKey}`} id="booking-start-date" label={t("ui.booking.checkIn")} type="date" value={startDate} onChange={setStartDate} field={startDateField} uncertain={uncertain && !startDate} />
                <BookingField key={`end-date-${endDateField.shakeKey}`} id="booking-end-date" label={t("ui.booking.checkOut")} type="date" value={endDate} onChange={setEndDate} field={endDateField} uncertain={uncertain && !endDate} />
              </div>
              <BookingField id="booking-address" label={t("ui.booking.address")} value={address} onChange={setAddress} placeholder={t("ui.booking.optional")} />
              <BookingField id="booking-confirmation-code" label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
            </>
          ) : (
            <>
              <BookingField key={`title-${titleField.shakeKey}`} id="booking-title" label={t("ui.booking.name")} value={title} onChange={setTitle} field={titleField} uncertain={uncertain && !title} />
              <BookingField key={`start-date-${startDateField.shakeKey}`} id="booking-start-date" label={t("ui.booking.date")} type="date" value={startDate} onChange={setStartDate} field={startDateField} uncertain={uncertain && !startDate} />
              <BookingField id="booking-location" label={t("ui.booking.location")} value={address} onChange={setAddress} placeholder={t("ui.booking.optional")} />
              <BookingField id="booking-confirmation-code" label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
            </>
          )}
        </div>

        <BuiButton type="button" onClick={() => void save()} busy={busy} className="mt-6 w-full sm:w-auto">
          {busy ? t("ui.status.saving") : t("ui.booking.saveWhatBooked")}
        </BuiButton>
      </BuiCard>
    </div>
  );
}
