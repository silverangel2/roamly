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
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateLabel(value: string | null | undefined, timezone: string) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
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

function bookingLabel(booking: PreTrip1DayBooking, timezone: string) {
  const name = clean(booking.title) || clean(booking.provider_name) || clean(booking.booking_type) || "Confirmed booking";
  const when = dateLabel(booking.start_at || booking.check_in_at, timezone);
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
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.bookings.filter(isConfirmed);
  const transport = confirmed.filter(isTransport).slice(0, 2).map((booking) => bookingLabel(booking, input.timezone));
  const stay = confirmed.filter(isStay).slice(0, 1).map((booking) => bookingLabel(booking, input.timezone));
  const attention = input.bookings
    .filter((booking) => ["cancelled", "needs_confirmation", "detected"].includes(clean(booking.booking_status)))
    .slice(0, 2)
    .map((booking) => `${clean(booking.title) || clean(booking.booking_type) || "Travel booking"} needs attention`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`Traveler note: ${mustDo.slice(0, 220)}`);
  const firstPlan = input.firstActivity && !["completed", "skipped"].includes(clean(input.firstActivity.status))
    ? [clean(input.firstActivity.title) || "First plan", dateLabel(input.firstActivity.scheduled_start, input.timezone), clean(input.firstActivity.address)].filter(Boolean).join(" · ")
    : "";
  const ready = attention.length === 0;
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const tomorrow = dateLabel(input.tripStart.toISOString(), input.timezone);
  const body = [
    ready ? "You are ready for tomorrow. Here is the short version of what Roamly knows." : "There is one short list to check before you go.",
    `Tomorrow: your trip starts ${tomorrow}.`,
    transport.length ? `Transport: ${transport.join("; ")}.` : "",
    stay.length ? `Stay: ${stay[0]}.` : "",
    firstPlan ? `First up: ${firstPlan}.` : "",
    attention.length ? `Needs attention: ${attention.join("; ")}.` : "",
    input.gmailStatus === "connected" ? "Booking email monitoring is connected." : "",
    input.gmailStatus === "disconnected" ? "Reconnect your booking email if you want Roamly to keep organizing confirmations." : "",
    input.liveCompanionIncluded ? "Live Companion is included for this trip and will guide you during travel." : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: `${destination} starts tomorrow`,
    preheader: `Your concise ${destination} travel-day briefing.`,
    eyebrow: "Tomorrow with Roamly",
    title: `${destination} starts tomorrow`,
    intro: ready ? "Your trip is nearly here." : "A quick check before your trip begins.",
    body,
    summaryItems: [
      { label: "Destination", value: destination },
      { label: "Travel dates", value: dates },
      { label: "Departure", value: tomorrow }
    ],
    ctaLabel: "View tomorrow's plan",
    tripPath: input.tripPath
  };
}
