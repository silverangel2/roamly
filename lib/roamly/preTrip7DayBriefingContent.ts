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
};

export function preTrip7DayWindow(tripStart: Date, now: Date) {
  const target = new Date(tripStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const usefulUntil = new Date(target.getTime() + 36 * 60 * 60 * 1000);
  return {
    target,
    usefulUntil,
    eligible: now.getTime() >= target.getTime() && now.getTime() < usefulUntil.getTime() && now.getTime() < tripStart.getTime()
  };
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function activeBooking(booking: PreTrip7DayBooking) {
  return booking.traveler_confirmed === true && ["booked", "paid", "reserved", "confirmed", "modified"].includes(clean(booking.booking_status));
}

function bookingDate(booking: PreTrip7DayBooking, timezone: string) {
  const raw = clean(booking.start_at) || clean(booking.check_in_at);
  const date = raw ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function bookingLabel(booking: PreTrip7DayBooking, timezone: string) {
  return [clean(booking.booking_type), clean(booking.title) || clean(booking.provider_name) || "Confirmed booking", bookingDate(booking, timezone)].filter(Boolean).join(" · ");
}

export function buildPreTrip7DayBriefingContent(input: PreTrip7DayContentInput) {
  const destination = clean(input.destination) || "your trip";
  const confirmed = input.confirmedBookings.filter(activeBooking).slice(0, 4).map((booking) => bookingLabel(booking, input.timezone));
  const attention = input.confirmedBookings
    .filter((booking) => ["cancelled", "needs_confirmation", "detected"].includes(clean(booking.booking_status)))
    .slice(0, 3)
    .map((booking) => `${clean(booking.title) || clean(booking.booking_type) || "Travel booking"} needs attention`);
  const mustDo = clean(input.mustDo);
  if (mustDo) attention.push(`Traveler note: ${mustDo.slice(0, 220)}`);
  const ready = attention.length === 0;
  const dates = input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : input.startDate || null;
  const intro = ready
    ? "Your trip looks on track. Roamly has checked the travel details currently connected to this trip."
    : "Roamly found a few items worth checking before you travel.";
  const body = [
    ready ? "Everything important currently looks in order." : "Here is what deserves your attention:",
    confirmed.length ? `Confirmed: ${confirmed.join("; ")}.` : "No confirmed bookings are attached yet.",
    attention.length ? `Needs attention: ${attention.join("; ")}.` : "",
    input.gmailStatus === "connected" ? "Booking email monitoring is connected." : "",
    input.gmailStatus === "disconnected" ? "Connect your booking email from the trip if you want Roamly to organize future confirmations." : ""
  ].filter(Boolean).join("\n\n");
  return {
    subject: `${destination} is one week away`,
    preheader: `A concise readiness check for your ${destination} trip.`,
    eyebrow: "Trip readiness",
    title: `${destination} is one week away`,
    intro,
    body,
    summaryItems: [
      { label: "Destination", value: destination },
      { label: "Travel dates", value: dates },
      { label: "Readiness", value: ready ? "Looks on track" : "Needs attention" }
    ],
    ctaLabel: "View my trip",
    tripPath: input.tripPath
  };
}
