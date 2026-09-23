import type { RoamlyLocale } from "@/lib/i18n";
import { briefingMessage as msg } from "./briefingMessages.mjs";

export type TravelDayBooking = {
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

export type TravelDayActivity = {
  id: string;
  title?: string | null;
  scheduled_start?: string | null;
  address?: string | null;
  status?: string | null;
};

export type TravelDayContentInput = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  timezone: string;
  tripStart: Date;
  bookings: TravelDayBooking[];
  firstActivity?: TravelDayActivity | null;
  gmailStatus: "connected" | "disconnected" | null;
  liveCompanionIncluded: boolean;
  mustDo?: string | null;
  tripPath: string;
  locale?: RoamlyLocale;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateLabel(value: string | null | undefined, timezone: string, locale = "en") {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function isConfirmed(booking: TravelDayBooking) {
  return booking.traveler_confirmed === true && ["booked", "paid", "reserved", "confirmed", "modified"].includes(clean(booking.booking_status));
}

function bookingTime(booking: TravelDayBooking) {
  const raw = clean(booking.start_at) || clean(booking.check_in_at);
  const time = raw ? new Date(raw) : null;
  return time && Number.isFinite(time.getTime()) ? time : null;
}

function localDateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function bookingLabel(booking: TravelDayBooking, timezone: string, locale: RoamlyLocale) {
  const name = clean(booking.title) || clean(booking.provider_name) || clean(booking.booking_type) || msg(locale, "confirmed");
  const when = dateLabel(booking.start_at || booking.check_in_at, timezone, locale);
  const route = [clean(booking.origin), clean(booking.destination)].filter(Boolean).join(" to ");
  return [name, route, when].filter(Boolean).join(" · ");
}

export function tripLocalDayStart(tripStart: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(tripStart);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) return new Date(NaN);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const localValue = (type: string) => Number(local.find((part) => part.type === type)?.value || 0);
  const actual = Date.UTC(localValue("year"), localValue("month") - 1, localValue("day"), localValue("hour"), localValue("minute"));
  return new Date(guess.getTime() + (Date.UTC(year, month - 1, day) - actual));
}

export function travelDayWindow(tripStart: Date, timezone: string, firstEventAt: Date | null, now: Date) {
  const dayStart = tripLocalDayStart(tripStart, timezone);
  const defaultUsefulUntil = new Date(dayStart.getTime() + 12 * 60 * 60 * 1000);
  const event = firstEventAt && firstEventAt.getTime() >= dayStart.getTime() ? firstEventAt : null;
  const target = event
    ? new Date(Math.max(dayStart.getTime(), event.getTime() - 3 * 60 * 60 * 1000))
    : new Date(dayStart.getTime() + 6 * 60 * 60 * 1000);
  const usefulUntil = event || defaultUsefulUntil;
  return {
    dayStart,
    target,
    usefulUntil,
    eligible: now.getTime() >= target.getTime() && now.getTime() < usefulUntil.getTime()
  };
}

export function findFirstTravelDayEvent(params: {
  tripStart: Date;
  timezone: string;
  now: Date;
  bookings: TravelDayBooking[];
  activities: TravelDayActivity[];
}) {
  const windowStart = tripLocalDayStart(params.tripStart, params.timezone).getTime();
  const travelDay = localDateKey(params.tripStart, params.timezone);
  const bookingTimes = params.bookings
    .filter(isConfirmed)
    .map((booking) => bookingTime(booking))
    .filter((time): time is Date => time !== null && time.getTime() >= windowStart && localDateKey(time, params.timezone) === travelDay);
  const activityTimes = params.activities
    .filter((activity) => !["completed", "skipped", "expired", "cancelled"].includes(clean(activity.status)))
    .map((activity) => activity.scheduled_start ? new Date(activity.scheduled_start) : null)
    .filter((time): time is Date => time !== null && Number.isFinite(time.getTime()) && time.getTime() >= windowStart && localDateKey(time, params.timezone) === travelDay);
  return [...bookingTimes, ...activityTimes].sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

export function buildTravelDayBriefingContent(input: TravelDayContentInput) {
  const locale = input.locale || "en";
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.bookings.filter(isConfirmed);
  const transport = confirmed.filter((booking) => ["flight", "train", "bus", "ferry", "transport", "transportation", "rental_car", "car_rental"].includes(clean(booking.booking_type))).slice(0, 2).map((booking) => bookingLabel(booking, input.timezone, locale));
  const stay = confirmed.filter((booking) => ["hotel", "accommodation", "lodging", "stay"].includes(clean(booking.booking_type))).slice(0, 1).map((booking) => bookingLabel(booking, input.timezone, locale));
  const firstPlan = input.firstActivity && !["completed", "skipped", "expired", "cancelled"].includes(clean(input.firstActivity.status))
    ? [clean(input.firstActivity.title) || msg(locale, "firstUp"), dateLabel(input.firstActivity.scheduled_start, input.timezone, locale), clean(input.firstActivity.address)].filter(Boolean).join(" · ")
    : "";
  const attention = input.bookings.filter((booking) => ["cancelled", "needs_confirmation"].includes(clean(booking.booking_status))).slice(0, 2).map((booking) => `${clean(booking.title) || clean(booking.booking_type) || msg(locale, "confirmed")} ${msg(locale, "bookingAttention")}`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`${msg(locale, "travelerNote")}: ${mustDo.slice(0, 220)}`);
  const startLabel = new Intl.DateTimeFormat(locale, { timeZone: input.timezone, hour: "numeric", minute: "2-digit" }).format(input.tripStart);
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const body = [
    msg(locale, "travelReady"),
    msg(locale, "around", { time: startLabel }),
    transport.length ? `${msg(locale, "confirmedTransportFull")}: ${transport.join("; ")}.` : "",
    stay.length ? `${msg(locale, "stay")}: ${stay[0]}.` : "",
    firstPlan ? `${msg(locale, "firstUp")}: ${firstPlan}.` : "",
    attention.length ? `${msg(locale, "needsAttention")}: ${attention.join("; ")}.` : "",
    input.liveCompanionIncluded ? msg(locale, "companionTravel") : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: msg(locale, "travelSubject", { destination }),
    preheader: msg(locale, "travelPreheader", { destination }),
    eyebrow: msg(locale, "travelDay"),
    title: msg(locale, "travelSubject", { destination }),
    intro: msg(locale, attention.length ? "quickCheck" : "tripHere"),
    body,
    summaryItems: [
      { label: msg(locale, "destination"), value: destination },
      { label: msg(locale, "travelDates"), value: dates },
      { label: msg(locale, "today"), value: startLabel }
    ],
    ctaLabel: msg(locale, "openTrip"),
    tripPath: input.tripPath
  };
}
