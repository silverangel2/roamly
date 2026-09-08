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
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateLabel(value: string | null | undefined, timezone: string) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
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

function bookingLabel(booking: TravelDayBooking, timezone: string) {
  const name = clean(booking.title) || clean(booking.provider_name) || clean(booking.booking_type) || "Confirmed booking";
  const when = dateLabel(booking.start_at || booking.check_in_at, timezone);
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
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.bookings.filter(isConfirmed);
  const transport = confirmed.filter((booking) => ["flight", "train", "bus", "ferry", "transport", "transportation", "rental_car", "car_rental"].includes(clean(booking.booking_type))).slice(0, 2).map((booking) => bookingLabel(booking, input.timezone));
  const stay = confirmed.filter((booking) => ["hotel", "accommodation", "lodging", "stay"].includes(clean(booking.booking_type))).slice(0, 1).map((booking) => bookingLabel(booking, input.timezone));
  const firstPlan = input.firstActivity && !["completed", "skipped", "expired", "cancelled"].includes(clean(input.firstActivity.status))
    ? [clean(input.firstActivity.title) || "First plan", dateLabel(input.firstActivity.scheduled_start, input.timezone), clean(input.firstActivity.address)].filter(Boolean).join(" · ")
    : "";
  const attention = input.bookings.filter((booking) => ["cancelled", "needs_confirmation"].includes(clean(booking.booking_status))).slice(0, 2).map((booking) => `${clean(booking.title) || clean(booking.booking_type) || "Travel booking"} needs attention`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`Traveler note: ${mustDo.slice(0, 220)}`);
  const startLabel = new Intl.DateTimeFormat("en", { timeZone: input.timezone, hour: "numeric", minute: "2-digit" }).format(input.tripStart);
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const body = [
    "Your trip starts today. Here is the short version of what matters first.",
    `Today: your trip begins around ${startLabel}.`,
    transport.length ? `Confirmed transport: ${transport.join("; ")}.` : "",
    stay.length ? `Stay: ${stay[0]}.` : "",
    firstPlan ? `First up: ${firstPlan}.` : "",
    attention.length ? `Needs attention: ${attention.join("; ")}.` : "",
    input.liveCompanionIncluded ? "Live Companion is available for this trip and will guide you during travel." : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: `${destination} starts today`,
    preheader: `A concise travel-day handoff for your ${destination} trip.`,
    eyebrow: "Travel day",
    title: `${destination} starts today`,
    intro: attention.length ? "One quick check before you get moving." : "Your trip is here.",
    body,
    summaryItems: [
      { label: "Destination", value: destination },
      { label: "Travel dates", value: dates },
      { label: "Today", value: startLabel }
    ],
    ctaLabel: "Open my trip",
    tripPath: input.tripPath
  };
}
