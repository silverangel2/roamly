"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";

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
  const { t } = useI18n();
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
      {uncertain ? <span className="mt-1 block text-sm font-bold text-amber-700">{t("ui.booking.checkField")}</span> : null}
    </label>
  );
}

export function ManualBookingForm({ tripId }: ManualBookingFormProps) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [kind, setKind] = useState<BookingKind>("flight");
  const [provider, setProvider] = useState("");
  const [title, setTitle] = useState("");
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
    if (!canSave) {
      setError(t("ui.booking.needsChecking"));
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
          airlineCode: kind === "flight" ? airlineCode : null,
          terminal: kind === "flight" ? terminal : null,
          gate: kind === "flight" ? gate : null,
          startTime: toDateTime(startDate, startTime),
          endTime: kind === "flight" ? toDateTime(endDate || startDate, endTime) : kind === "hotel" ? toDateTime(endDate, "11:00") : null,
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
                    status: "confirmed"
                  }
                ]
              : [],
          travelerConfirmed: true
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || t("ui.status.unexpectedError"));
      router.push(`/trip/${tripId}/bookings`);
      router.refresh();
    } catch (err) {
      setError(localizeCustomerError(locale, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-8">
      <section className="rounded-[1.15rem] border border-slate-200 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.07)] sm:p-7">
        <p className="text-sm font-black text-ocean">{t("ui.booking.add")}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{t("ui.booking.saveWhatBooked")}</h1>
        <p className="mt-2 text-base font-semibold leading-7 text-slate-600">{t("ui.booking.enterOrUpload")}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-ink">
            <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} />
            {t("ui.booking.upload")}
          </label>
          <button type="button" onClick={() => setReview(null)} className="min-h-14 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-ink">
            {t("ui.booking.manual")}
          </button>
          <a href={`/trip/${tripId}/bookings`} className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-ink">
            {t("ui.booking.back")}
          </a>
        </div>

        {review ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-black text-amber-800">{t("ui.booking.review")}</p>
            <p className="mt-1 text-sm font-bold text-amber-800">
              {uncertain ? t("ui.booking.needsChecking") : t("ui.booking.confirmDetails")}
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
              {t(`ui.booking.${item.label}`)}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4">
          {kind === "flight" ? (
            <>
              <Field label={t("ui.booking.airline")} value={provider} onChange={setProvider} uncertain={uncertain && !provider} placeholder="Air Canada" />
              <Field label={t("ui.booking.flightNumber")} value={flightNumber} onChange={setFlightNumber} uncertain={uncertain && !flightNumber} placeholder="AC870" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("ui.booking.date")} type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
                <Field label={t("ui.booking.departureTime")} type="time" value={startTime} onChange={setStartTime} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("ui.booking.arrivalDate")} type="date" value={endDate} onChange={setEndDate} placeholder={startDate} />
                <Field label={t("ui.booking.arrivalTime")} type="time" value={endTime} onChange={setEndTime} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("ui.booking.from")} value={origin} onChange={setOrigin} uncertain={uncertain && !origin} placeholder="YUL" />
                <Field label={t("ui.booking.to")} value={destination} onChange={setDestination} uncertain={uncertain && !destination} placeholder="CDG" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t("ui.booking.airlineCode")} value={airlineCode} onChange={setAirlineCode} placeholder="AC" />
                <Field label={t("ui.status.terminal", "Terminal")} value={terminal} onChange={setTerminal} placeholder="1" />
                <Field label={t("ui.booking.gate")} value={gate} onChange={setGate} placeholder="A12" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("ui.booking.baggage")} value={baggage} onChange={setBaggage} placeholder="1 checked bag" />
                <Field label={t("ui.booking.duration")} value={duration} onChange={setDuration} placeholder="5h 40m" />
              </div>
              <Field label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
            </>
          ) : kind === "hotel" ? (
            <>
              <Field label={t("ui.booking.hotelName")} value={provider} onChange={setProvider} uncertain={uncertain && !provider} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("ui.booking.checkIn")} type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
                <Field label={t("ui.booking.checkOut")} type="date" value={endDate} onChange={setEndDate} uncertain={uncertain && !endDate} />
              </div>
              <Field label={t("ui.booking.address")} value={address} onChange={setAddress} placeholder={t("ui.booking.optional")} />
              <Field label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
            </>
          ) : (
            <>
              <Field label={t("ui.booking.name")} value={title} onChange={setTitle} uncertain={uncertain && !title} />
              <Field label={t("ui.booking.date")} type="date" value={startDate} onChange={setStartDate} uncertain={uncertain && !startDate} />
              <Field label={t("ui.booking.location")} value={address} onChange={setAddress} placeholder={t("ui.booking.optional")} />
              <Field label={t("ui.booking.confirmationCode")} value={confirmationCode} onChange={setConfirmationCode} placeholder={t("ui.booking.optional")} />
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
          {busy ? t("ui.status.saving") : t("ui.booking.saveWhatBooked")}
        </button>
      </section>
    </div>
  );
}
