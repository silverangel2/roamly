import type { RoamlyLocale } from "@/lib/i18n";
import { briefingMessage as msg } from "./briefingMessages.mjs";

export type PreTrip1DayBooking = {
  id: string;
  booking_type?: string | null;
  booking_status?: string | null;
  title?: string | null;
  provider_name?: string | null;
  start_at?: string | null;
  check_in_at?: string | null;
  origin?: string | null;
  destination?: string | null;
  traveler_confirmed?: boolean | null;
};

export type PreTrip1DayActivity = {
  id: string;
  title?: string | null;
  scheduled_start?: string | null;
  address?: string | null;
  status?: string | null;
};

export type PreTrip1DayContentInput = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  timezone: string;
  tripStart: Date;
  bookings: PreTrip1DayBooking[];
  firstActivity?: PreTrip1DayActivity | null;
  gmailStatus: "connected" | "disconnected" | null;
  liveCompanionIncluded: boolean;
  mustDo?: string | null;
  tripPath: string;
  locale?: RoamlyLocale;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateLabel(value: string | null | undefined, timezone: string, locale: RoamlyLocale) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function isConfirmed(booking: PreTrip1DayBooking) {
  return booking.traveler_confirmed === true && ["booked", "paid", "reserved", "confirmed", "modified"].includes(clean(booking.booking_status));
}

function isTransport(booking: PreTrip1DayBooking) {
  return ["flight", "train", "bus", "ferry", "transport", "transportation", "rental_car", "car_rental"].includes(clean(booking.booking_type));
}

function isStay(booking: PreTrip1DayBooking) {
  return ["hotel", "accommodation", "lodging", "stay"].includes(clean(booking.booking_type));
}

function bookingLabel(booking: PreTrip1DayBooking, timezone: string, locale: RoamlyLocale) {
  const name = clean(booking.title) || clean(booking.provider_name) || clean(booking.booking_type) || msg(locale, "confirmed");
  const when = dateLabel(booking.start_at || booking.check_in_at, timezone, locale);
  const route = [clean(booking.origin), clean(booking.destination)].filter(Boolean).join(" to ");
  return [name, route, when].filter(Boolean).join(" · ");
}

export function preTrip1DayWindow(tripStart: Date, now: Date) {
  const target = new Date(tripStart.getTime() - 24 * 60 * 60 * 1000);
  return {
    target,
    usefulUntil: tripStart,
    eligible: now.getTime() >= target.getTime() && now.getTime() < tripStart.getTime()
  };
}

export function buildPreTrip1DayBriefingContent(input: PreTrip1DayContentInput) {
  const locale = input.locale || "en";
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.bookings.filter(isConfirmed);
  const transport = confirmed.filter(isTransport).slice(0, 2).map((booking) => bookingLabel(booking, input.timezone, locale));
  const stay = confirmed.filter(isStay).slice(0, 1).map((booking) => bookingLabel(booking, input.timezone, locale));
  const attention = input.bookings
    .filter((booking) => ["cancelled", "needs_confirmation", "detected"].includes(clean(booking.booking_status)))
    .slice(0, 2)
    .map((booking) => `${clean(booking.title) || clean(booking.booking_type) || msg(locale, "confirmed")} ${msg(locale, "bookingAttention")}`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`${msg(locale, "travelerNote")}: ${mustDo.slice(0, 220)}`);
  const firstPlan = input.firstActivity && !["completed", "skipped"].includes(clean(input.firstActivity.status))
    ? [clean(input.firstActivity.title) || msg(locale, "firstUp"), dateLabel(input.firstActivity.scheduled_start, input.timezone, locale), clean(input.firstActivity.address)].filter(Boolean).join(" · ")
    : "";
  const ready = attention.length === 0;
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const tomorrow = dateLabel(input.tripStart.toISOString(), input.timezone, locale);
  const body = [
    msg(locale, ready ? "tomorrowReady" : "tomorrowAttention"),
    `${msg(locale, "tomorrowLine")}: ${tomorrow}.`,
    transport.length ? `${msg(locale, "transport")}: ${transport.join("; ")}.` : "",
    stay.length ? `${msg(locale, "stay")}: ${stay[0]}.` : "",
    firstPlan ? `${msg(locale, "firstUp")}: ${firstPlan}.` : "",
    attention.length ? `${msg(locale, "needsAttention")}: ${attention.join("; ")}.` : "",
    input.gmailStatus === "connected" ? msg(locale, "bookingEmailOn") : "",
    input.gmailStatus === "disconnected" ? msg(locale, "bookingEmailOff") : "",
    input.liveCompanionIncluded ? msg(locale, "companionTomorrow") : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: msg(locale, "tomorrowSubject", { destination }),
    preheader: msg(locale, "tomorrowPreheader", { destination }),
    eyebrow: msg(locale, "tomorrowEyebrow"),
    title: msg(locale, "tomorrowSubject", { destination }),
    intro: msg(locale, ready ? "tomorrowIntroReady" : "tomorrowIntroAttention"),
    body,
    summaryItems: [
      { label: msg(locale, "destination"), value: destination },
      { label: msg(locale, "travelDates"), value: dates },
      { label: msg(locale, "departure"), value: tomorrow }
    ],
    ctaLabel: msg(locale, "viewTomorrow"),
    tripPath: input.tripPath
  };
}
