import Link from "next/link";
import type { TripBookingRecord, TripBookingStatus, TripBookingType } from "@/lib/roamly/bookingWallet";
import { bookingWalletSummary, bookingWalletTimelineSortKey, isActiveTripBooking } from "@/lib/roamly/bookingWallet";

type BookingWalletTimelineProps = {
  tripId: string;
  tripTitle: string;
  destinationLabel: string;
  bookings: TripBookingRecord[];
  companionUnlocked?: boolean;
};

const statusCopy: Record<TripBookingStatus, string> = {
  recommended: "Recommended",
  clicked: "Clicked",
  detected: "Detected",
  needs_confirmation: "Review",
  confirmed: "Confirmed",
  modified: "Updated",
  cancelled: "Cancelled",
  refunded: "Refunded",
  completed: "Completed"
};

function statusClass(status: TripBookingStatus) {
  if (status === "confirmed" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "modified" || status === "detected" || status === "needs_confirmation") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "cancelled" || status === "refunded") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function iconPath(type: TripBookingType) {
  if (type === "flight") return "M3 11l18-7-7 18-3-8-8-3zm9 1l2 5 3-9-5 4z";
  if (type === "hotel") return "M4 20V7a3 3 0 013-3h10a3 3 0 013 3v13M7 20v-6h10v6M8 10h.01M12 10h.01M16 10h.01";
  if (type === "train" || type === "bus" || type === "ferry" || type === "transfer") return "M6 4h12a2 2 0 012 2v8a3 3 0 01-3 3H7a3 3 0 01-3-3V6a2 2 0 012-2zm2 15l-2 2m10-2l2 2M7 8h10M8 14h.01M16 14h.01";
  if (type === "rental_car") return "M5 17h14M7 17v2m10-2v2M6 13l2-5h8l2 5M5 13h14v4H5z";
  if (type === "restaurant") return "M7 3v8m3-8v8m-3 0h3m-1.5 0v10M16 3v18";
  return "M5 6h14v14H5zM8 3h8v3H8z";
}

function BookingIcon({ type }: { type: TripBookingType }) {
  return (
    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ocean/20 bg-ocean/10 text-ocean" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d={iconPath(type)} />
      </svg>
    </span>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "Date not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDateRange(booking: TripBookingRecord) {
  const start = booking.check_in_time || booking.start_time;
  const end = booking.check_out_time || booking.end_time;
  if (!start && !end) return "Date not set";
  if (!end) return formatDateTime(start);
  const startDate = new Date(start || "");
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return formatDateTime(start);
  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  return `${formatter.format(startDate)}-${formatter.format(endDate)}`;
}

function routeLine(booking: TripBookingRecord) {
  if (booking.origin || booking.destination) return [booking.origin, booking.destination].filter(Boolean).join(" -> ");
  if (booking.location_name) return booking.location_name;
  if (booking.address) return booking.address;
  return booking.provider || "Booking";
}

function primaryDetail(booking: TripBookingRecord) {
  if (booking.booking_type === "hotel") return formatDateRange(booking);
  return formatDateTime(booking.start_time || booking.check_in_time);
}

function money(booking: TripBookingRecord) {
  if (booking.total_price == null || !booking.currency) return null;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: booking.currency,
    maximumFractionDigits: 0
  }).format(booking.total_price);
}

function detailRows(booking: TripBookingRecord) {
  return [
    ["Confirmation", booking.confirmation_code],
    ["Flight", booking.flight_number],
    ["Terminal", booking.terminal],
    ["Gate", booking.gate],
    ["Room", booking.room_type],
    ["Address", booking.address],
    ["Price", money(booking)],
    ["Cancellation", booking.cancellation_deadline ? formatDateTime(booking.cancellation_deadline) : booking.cancellation_terms]
  ].filter((row): row is [string, string] => Boolean(row[1]));
}

function nextBooking(bookings: TripBookingRecord[]) {
  const now = Date.now();
  return (
    bookings.find((booking) => {
      const value = booking.start_time || booking.check_in_time;
      return value ? new Date(value).getTime() >= now : false;
    }) || bookings[0] || null
  );
}

function navLinkClass(active = false) {
  return `rounded-2xl px-3 py-3 text-center text-sm font-black ${active ? "bg-ink text-white" : "border border-slate-200 bg-white text-slate-700"}`;
}

export function BookingWalletTimeline({ tripId, tripTitle, destinationLabel, bookings, companionUnlocked = false }: BookingWalletTimelineProps) {
  const activeBookings = bookings.filter(isActiveTripBooking).sort((a, b) => bookingWalletTimelineSortKey(a).localeCompare(bookingWalletTimelineSortKey(b)));
  const summary = bookingWalletSummary(bookings);
  const next = nextBooking(activeBookings);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <section className="rounded-[1.15rem] border border-slate-200 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.07)] sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black text-ocean">Bookings</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{tripTitle}</h1>
            <p className="mt-2 text-base font-semibold text-slate-600">{destinationLabel}</p>
          </div>
          <Link href={`/trip/${tripId}#bookings`} className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white">
            Add booking
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-500">Trip status</p>
            <p className="mt-1 text-xl font-black text-ink">{summary.needsConfirmation ? "Review needed" : summary.confirmed ? "Organized" : "No bookings yet"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-500">Confirmed</p>
            <p className="mt-1 text-xl font-black text-ink">{summary.confirmed}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-500">Companion</p>
            <p className="mt-1 text-xl font-black text-ink">{companionUnlocked ? "On" : "Available"}</p>
          </div>
        </div>
      </section>

      {next ? (
        <section className="mt-4 rounded-[1.15rem] border border-ocean/20 bg-ocean/10 p-5">
          <p className="text-sm font-black text-ocean">Next</p>
          <div className="mt-3 flex items-start gap-3">
            <BookingIcon type={next.booking_type} />
            <div className="min-w-0">
              <h2 className="text-2xl font-black text-ink">{next.title}</h2>
              <p className="mt-1 text-sm font-bold text-slate-700">{routeLine(next)}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">{primaryDetail(next)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-5">
        {activeBookings.length ? (
          <div className="grid gap-3">
            {activeBookings.map((booking) => {
              const rows = detailRows(booking);
              return (
                <article key={booking.id} className="rounded-[1.1rem] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex items-start gap-3">
                    <BookingIcon type={booking.booking_type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-black text-ink">{booking.provider || booking.title}</h3>
                          <p className="mt-1 text-base font-black text-slate-700">{routeLine(booking)}</p>
                          <p className="mt-1 text-sm font-bold text-slate-500">{primaryDetail(booking)}</p>
                        </div>
                        <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-sm font-black ${statusClass(booking.booking_status)}`}>
                          {statusCopy[booking.booking_status]}
                        </span>
                      </div>
                      <details className="mt-3">
                        <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-ink">
                          View details
                        </summary>
                        <div className="mt-3 grid gap-2 text-sm font-bold text-slate-600 sm:grid-cols-2">
                          {rows.length ? rows.map(([label, value]) => (
                            <p key={label} className="rounded-2xl bg-slate-50 px-3 py-2">
                              <span className="block text-slate-400">{label}</span>
                              <span className="text-ink">{value}</span>
                            </p>
                          )) : (
                            <p className="rounded-2xl bg-slate-50 px-3 py-2">No extra details saved.</p>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[1.1rem] border border-dashed border-slate-300 bg-white p-6 text-center">
            <h2 className="text-2xl font-black text-ink">No bookings yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-slate-600">
              Add flights, hotels, tickets, and reservations when you book them.
            </p>
            <Link href={`/trip/${tripId}#bookings`} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white">
              Add booking
            </Link>
          </div>
        )}
      </section>

      <nav className="sticky bottom-0 -mx-4 mt-6 grid grid-cols-4 gap-2 border-t border-slate-200 bg-[#fbf8ef]/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:max-w-xl sm:border-0 sm:bg-transparent sm:px-0">
        <Link href={`/trip/${tripId}/live`} className={navLinkClass(false)}>Today</Link>
        <Link href={`/trip/${tripId}`} className={navLinkClass(false)}>Trip</Link>
        <Link href={`/trip/${tripId}/bookings`} className={navLinkClass(true)}>Bookings</Link>
        <Link href={`/trip/${tripId}/companion`} className={navLinkClass(false)}>Companion</Link>
      </nav>
    </div>
  );
}
