import type { RoamlyLocale } from "@/lib/i18n";
import { briefingMessage as msg } from "./briefingMessages.mjs";

export type PreTrip7DayBooking = {
  id: string;
  booking_type?: string | null;
  booking_status?: string | null;
  title?: string | null;
  provider_name?: string | null;
  start_at?: string | null;
  check_in_at?: string | null;
  traveler_confirmed?: boolean | null;
};

export type PreTrip7DayContentInput = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  timezone: string;
  confirmedBookings: PreTrip7DayBooking[];
  gmailStatus: "connected" | "disconnected" | null;
  mustDo?: string | null;
  tripPath: string;
  locale?: RoamlyLocale;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function tripStartFromDate(startDate: string | null | undefined, timezone: string) {
  const date = clean(startDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 9, 0));
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const actual = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(guess.getTime() + Date.UTC(year, month - 1, day, 9, 0) - actual);
}

export function preTrip7DayWindow(tripStart: Date, now: Date) {
  const target = new Date(tripStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const usefulUntil = new Date(target.getTime() + 36 * 60 * 60 * 1000);
  return {
    target,
    usefulUntil,
    eligible: now.getTime() >= target.getTime() && now.getTime() < usefulUntil.getTime() && now.getTime() < tripStart.getTime()
  };
}

function activeBooking(booking: PreTrip7DayBooking) {
  return booking.traveler_confirmed === true && ["booked", "paid", "reserved", "confirmed", "modified"].includes(clean(booking.booking_status));
}

function bookingDate(booking: PreTrip7DayBooking, timezone: string, locale: RoamlyLocale) {
  const raw = clean(booking.start_at) || clean(booking.check_in_at);
  const date = raw ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function bookingLabel(booking: PreTrip7DayBooking, timezone: string, locale: RoamlyLocale) {
  return [clean(booking.booking_type), clean(booking.title) || clean(booking.provider_name) || msg(locale, "confirmed"), bookingDate(booking, timezone, locale)].filter(Boolean).join(" · ");
}

export function buildPreTrip7DayBriefingContent(input: PreTrip7DayContentInput) {
  const locale = input.locale || "en";
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.confirmedBookings.filter(activeBooking).slice(0, 4).map((booking) => bookingLabel(booking, input.timezone, locale));
  const attention = input.confirmedBookings
    .filter((booking) => ["cancelled", "needs_confirmation", "detected"].includes(clean(booking.booking_status)))
    .slice(0, 3)
    .map((booking) => `${clean(booking.title) || clean(booking.booking_type) || msg(locale, "confirmed")} ${msg(locale, "bookingAttention")}`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`${msg(locale, "travelerNote")}: ${mustDo.slice(0, 220)}`);
  const ready = attention.length === 0;
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const intro = msg(locale, ready ? "onTrackIntro" : "attentionIntro");
  const body = [
    ready ? msg(locale, "onTrack") : msg(locale, "attentionList"),
    confirmed.length ? `${msg(locale, "confirmed")}: ${confirmed.join("; ")}.` : msg(locale, "noBookings"),
    attention.length ? `${msg(locale, "needsAttention")}: ${attention.join("; ")}.` : "",
    input.gmailStatus === "connected" ? msg(locale, "bookingEmailOn") : "",
    input.gmailStatus === "disconnected" ? msg(locale, "bookingEmailOffWeek") : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: msg(locale, "weekSubject", { destination }),
    preheader: msg(locale, "weekPreheader", { destination }),
    eyebrow: msg(locale, "readiness"),
    title: msg(locale, "weekSubject", { destination }),
    intro,
    body,
    summaryItems: [
      { label: msg(locale, "destination"), value: destination },
      { label: msg(locale, "travelDates"), value: dates },
      { label: msg(locale, "readinessLabel"), value: ready ? msg(locale, "looksOnTrack") : msg(locale, "needsAttention") }
    ],
    ctaLabel: msg(locale, "viewTrip"),
    tripPath: input.tripPath
  };
}
