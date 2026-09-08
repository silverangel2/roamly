export type DailyTripBooking = {
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

export type DailyTripActivity = {
  id: string;
  title?: string | null;
  scheduled_start?: string | null;
  address?: string | null;
  status?: string | null;
};

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function validDate(value: string | null | undefined) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dateKeyParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function localDateTimeToUtc(dateKeyValue: string, hour: number, minute: number, timezone: string) {
  const parts = dateKeyParts(dateKeyValue);
  if (!parts) return null;
  const [year, month, day] = parts;
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const value = (type: string) => Number(local.find((part) => part.type === type)?.value || 0);
  const actual = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return new Date(guess.getTime() + (Date.UTC(year, month - 1, day, hour, minute) - actual));
}

export function localDayStart(date: Date, timezone: string) {
  return localDateTimeToUtc(dateKey(date, timezone), 0, 0, timezone) || new Date(NaN);
}

export function dailyTripWindow(params: {
  tripStart: Date;
  tripEnd?: string | null;
  timezone: string;
  now: Date;
  firstEventAt?: Date | null;
}) {
  const today = dateKey(params.now, params.timezone);
  const firstDay = dateKey(params.tripStart, params.timezone);
  const endDay = clean(params.tripEnd).slice(0, 10);
  const dayStart = localDayStart(params.now, params.timezone);
  const normalTarget = localDateTimeToUtc(today, 7, 30, params.timezone);
  const normalUsefulUntil = localDateTimeToUtc(today, 11, 30, params.timezone);
  const event = params.firstEventAt && dateKey(params.firstEventAt, params.timezone) === today ? params.firstEventAt : null;
  const target = event && normalTarget ? new Date(Math.max(dayStart.getTime(), Math.min(normalTarget.getTime(), event.getTime() - 3 * 60 * 60 * 1000))) : normalTarget;
  const usefulUntil = event || normalUsefulUntil;
  const inTripDates = today > firstDay && Boolean(endDay) && today <= endDay;
  return {
    dayKey: today,
    firstDay,
    dayStart,
    target: target || new Date(NaN),
    usefulUntil: usefulUntil || new Date(NaN),
    eligible: inTripDates && Boolean(target && usefulUntil) && params.now.getTime() >= target!.getTime() && params.now.getTime() < usefulUntil!.getTime()
  };
}

function confirmed(booking: DailyTripBooking) {
  return booking.traveler_confirmed === true && ["booked", "paid", "reserved", "confirmed", "modified"].includes(clean(booking.booking_status));
}

function bookingTime(booking: DailyTripBooking) {
  return validDate(booking.start_at || booking.check_in_at);
}

function labelTime(value: string | null | undefined, timezone: string) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date) : "";
}

function bookingLabel(booking: DailyTripBooking, timezone: string) {
  const name = clean(booking.title) || clean(booking.provider_name) || clean(booking.booking_type) || "Confirmed booking";
  const route = [clean(booking.origin), clean(booking.destination)].filter(Boolean).join(" to ");
  return [name, route, labelTime(booking.start_at || booking.check_in_at, timezone)].filter(Boolean).join(" · ");
}

export function findFirstDailyEvent(params: { date: Date; timezone: string; bookings: DailyTripBooking[]; activities: DailyTripActivity[] }) {
  const day = dateKey(params.date, params.timezone);
  const bookingTimes = params.bookings.filter(confirmed).map(bookingTime).filter((time): time is Date => time !== null && dateKey(time, params.timezone) === day);
  const activityTimes = params.activities
    .filter((activity) => !["completed", "skipped", "expired", "cancelled"].includes(clean(activity.status)))
    .map((activity) => validDate(activity.scheduled_start))
    .filter((time): time is Date => time !== null && dateKey(time, params.timezone) === day);
  return [...bookingTimes, ...activityTimes].sort((a, b) => a.getTime() - b.getTime())[0] || null;
}

export function buildDailyTripBriefingContent(input: {
  destination: string;
  dayKey: string;
  timezone: string;
  bookings: DailyTripBooking[];
  activities: DailyTripActivity[];
  now: Date;
  mustDo?: string | null;
  liveCompanionIncluded: boolean;
  tripPath: string;
}) {
  const destination = clean(input.destination) || "your trip";
  const confirmedBookings = input.bookings.filter(confirmed).filter((booking) => {
    const time = bookingTime(booking);
    return !time || dateKey(time, input.timezone) === input.dayKey;
  });
  const relevantActivities = input.activities.filter((activity) => {
    if (["completed", "skipped", "expired", "cancelled"].includes(clean(activity.status))) return false;
    const scheduled = validDate(activity.scheduled_start);
    if (clean(activity.scheduled_start) && !scheduled) return false;
    return !scheduled || dateKey(scheduled, input.timezone) === input.dayKey;
  });
  const nowMs = input.now.getTime();
  const upcomingActivities = relevantActivities.filter((activity) => {
    const scheduled = validDate(activity.scheduled_start);
    return !scheduled || scheduled.getTime() >= nowMs;
  });
  const first = upcomingActivities[0] || null;
  const later = upcomingActivities.slice(1, 3).map((activity) => [clean(activity.title) || "Plan", labelTime(activity.scheduled_start, input.timezone)].filter(Boolean).join(" · "));
  const transport = confirmedBookings.filter((booking) => ["flight", "train", "bus", "ferry", "transport", "transportation", "rental_car", "car_rental"].includes(clean(booking.booking_type))).slice(0, 2).map((booking) => bookingLabel(booking, input.timezone));
  const stay = confirmedBookings.filter((booking) => ["hotel", "accommodation", "lodging", "stay"].includes(clean(booking.booking_type))).slice(0, 1).map((booking) => bookingLabel(booking, input.timezone));
  const firstLabel = first ? [clean(first.title) || "Plan", labelTime(first.scheduled_start, input.timezone), clean(first.address)].filter(Boolean).join(" · ") : "";
  const mustDo = clean(input.mustDo);
  const attention = input.bookings.filter((booking) => ["cancelled", "needs_confirmation"].includes(clean(booking.booking_status))).slice(0, 2).map((booking) => `${clean(booking.title) || clean(booking.booking_type) || "Travel booking"} needs attention`);
  if (mustDo) attention.push(`Traveler note: ${mustDo.slice(0, 220)}`);
  const body = [
    `Today in ${destination}: ${upcomingActivities.length || confirmedBookings.length ? "here is what matters first." : "your schedule is open."}`,
    firstLabel ? `First up: ${firstLabel}.` : "",
    later.length ? `Later: ${later.join("; ")}.` : "",
    transport.length ? `Confirmed: ${transport.join("; ")}.` : "",
    stay.length ? `Stay: ${stay[0]}.` : "",
    attention.length ? `Needs attention: ${attention.join("; ")}.` : "",
    input.liveCompanionIncluded ? "Live Companion is available for immediate travel guidance." : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: `Your day in ${destination}`,
    preheader: `A concise overview of today's plan in ${destination}.`,
    eyebrow: "Today's plan",
    title: `Your day in ${destination}`,
    intro: "A short overview for today.",
    body,
    summaryItems: [{ label: "Destination", value: destination }, { label: "Day", value: input.dayKey }],
    ctaLabel: "View today's plan",
    tripPath: input.tripPath
  };
}
