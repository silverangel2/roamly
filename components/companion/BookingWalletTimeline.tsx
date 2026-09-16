import Link from "next/link";
import type { TripBookingRecord, TripBookingStatus, TripBookingType } from "@/lib/roamly/bookingWallet";
import { bookingWalletSummary, bookingWalletTimelineSortKey, isActiveTripBooking, isConfirmedBooking } from "@/lib/roamly/bookingWallet";
import { formatRoamlyCurrency, formatRoamlyDate, type RoamlyLocale } from "@/lib/i18n";
import { bookingOutcomeLabel, deriveBookingOutcome, type BookingOutcomeReferral } from "@/lib/roamly/bookingOutcome";

type BookingWalletTimelineProps = {
  tripId: string;
  bookings: TripBookingRecord[];
  companionUnlocked?: boolean;
  locale: RoamlyLocale;
  focus?: "flight" | "hotel" | "activity" | null;
  referrals?: BookingOutcomeReferral[];
};

function statusClass(status: TripBookingStatus) {
  if (status === "confirmed" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "modified" || status === "detected" || status === "needs_confirmation") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "cancelled" || status === "refunded") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function customerStatus(booking: TripBookingRecord, outcome: ReturnType<typeof deriveBookingOutcome>) {
  if (isConfirmedBooking(booking)) return booking.booking_status === "modified" ? "Confirmed · updated" : booking.booking_status === "completed" ? "Completed" : "Confirmed";
  if (booking.booking_status === "needs_confirmation" || booking.booking_status === "detected") return "Action needed";
  if (booking.booking_status === "cancelled" || booking.booking_status === "refunded") return "No longer active";
  if (booking.booking_status === "recommended") return "Recommended · not booked";
  return bookingOutcomeLabel(outcome);
}

function bookingCategory(type: TripBookingType) {
  if (["flight", "train", "bus", "ferry"].includes(type)) return "Getting there";
  if (type === "hotel") return "Stay";
  if (["activity", "restaurant", "insurance"].includes(type)) return "Activities and reservations";
  if (["transfer", "rental_car"].includes(type)) return "Getting around";
  return "Other travel details";
}

function bookingCategoryOrder(title: string) {
  return ["Getting there", "Stay", "Activities and reservations", "Getting around", "Other travel details"].indexOf(title);
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

function formatDateTime(value: string | null, locale: RoamlyLocale) {
  if (!value) return "Date not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return formatRoamlyDate(date, locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDateRange(booking: TripBookingRecord, locale: RoamlyLocale) {
  const start = booking.check_in_time || booking.start_time;
  const end = booking.check_out_time || booking.end_time;
  if (!start && !end) return "Date not set";
  if (!end) return formatDateTime(start, locale);
  const startDate = new Date(start || "");
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return formatDateTime(start, locale);
  const formatter = (date: Date) => formatRoamlyDate(date, locale, { month: "short", day: "numeric" });
  return `${formatter(startDate)}-${formatter(endDate)}`;
}

function routeLine(booking: TripBookingRecord) {
  if (booking.origin || booking.destination) return [booking.origin, booking.destination].filter(Boolean).join(" -> ");
  if (booking.location_name) return booking.location_name;
  if (booking.address) return booking.address;
  return booking.provider || "Booking";
}

function primaryDetail(booking: TripBookingRecord, locale: RoamlyLocale) {
  if (booking.booking_type === "hotel") return formatDateRange(booking, locale);
  return formatDateTime(booking.start_time || booking.check_in_time, locale);
}

function essentialReference(booking: TripBookingRecord) {
  return booking.confirmation_code || booking.flight_number || "";
}

function money(booking: TripBookingRecord, locale: RoamlyLocale) {
  if (booking.total_price == null || !booking.currency) return null;
  return formatRoamlyCurrency(booking.total_price, booking.currency, locale, { maximumFractionDigits: 0 });
}

function detailRows(booking: TripBookingRecord, locale: RoamlyLocale) {
  return [
    ["Confirmation", booking.confirmation_code],
    ["Flight", booking.flight_number],
    ["Terminal", booking.terminal],
    ["Gate", booking.gate],
    ["Room", booking.room_type],
    ["Address", booking.address],
    ["Price", money(booking, locale)],
    ["Cancellation", booking.cancellation_deadline ? formatDateTime(booking.cancellation_deadline, locale) : booking.cancellation_terms]
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
  return `rounded-2xl px-3 py-3 text-center text-sm font-black ${active ? "bg-ocean text-white" : "border border-slate-200 bg-white text-slate-700"}`;
}

export function BookingWalletTimeline({ tripId, bookings, companionUnlocked = false, locale, focus = null, referrals = [] }: BookingWalletTimelineProps) {
  const activeBookings = bookings.filter(isActiveTripBooking).sort((a, b) => bookingWalletTimelineSortKey(a).localeCompare(bookingWalletTimelineSortKey(b)));
  const summary = bookingWalletSummary(bookings);
  const next = nextBooking(activeBookings);
  const actionNeeded = activeBookings.filter((booking) => booking.booking_status === "needs_confirmation" || booking.booking_status === "detected");
  const outcomeFor = (booking: TripBookingRecord) => deriveBookingOutcome({ tripId, category: booking.booking_type, booking, bookings, referrals });
  const visibleReferrals = referrals
    .map((referral) => ({ referral, outcome: deriveBookingOutcome({ tripId, category: referral.category || "other", recommendationId: referral.recommendation_id, bookings, referrals: [referral] }) }))
    .filter(({ outcome }) => outcome.state === "REFERRED" || outcome.state === "AWAITING_CONFIRMATION" || outcome.state === "NEEDS_REVIEW");
  const groups = Array.from(new Set(activeBookings.map((booking) => bookingCategory(booking.booking_type))))
    .sort((left, right) => bookingCategoryOrder(left) - bookingCategoryOrder(right))
    .map((title) => ({ title, bookings: activeBookings.filter((booking) => bookingCategory(booking.booking_type) === title) }));

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
      <section className="bg-[#fbf8ef]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Your trip, secured</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-ink sm:text-4xl">Bookings</h1>
          </div>
          <Link href={`/trip/${tripId}/bookings/add`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white">
            Add booking
          </Link>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-[#e8dfd0] py-3 text-sm font-bold text-slate-600">
          <span>{summary.confirmed} confirmed</span>
          <span>{actionNeeded.length ? `${actionNeeded.length} to review` : "Nothing needs review"}</span>
          <span>{companionUnlocked ? "Live Companion available" : "Live Companion not active"}</span>
        </div>
      </section>

      <nav aria-hidden="true" className="hidden">
        <Link href={`/trip/${tripId}/live`} className={navLinkClass(false)}>Live (Today)</Link>
        <Link href={`/trip/${tripId}`} className={navLinkClass(false)}>Trip</Link>
        <Link href={`/trip/${tripId}/bookings`} className={navLinkClass(true)}>Bookings</Link>
        <Link href={`/trip/${tripId}/companion`} className={navLinkClass(false)}>Companion</Link>
      </nav>

      {actionNeeded.length ? (
        <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">Action needed</p>
          <p className="mt-1 text-base font-black text-ink">Review {actionNeeded.length === 1 ? actionNeeded[0].title : `${actionNeeded.length} booking details`}</p>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">These details were found but are not confirmed for travel yet.</p>
        </section>
      ) : null}

      {focus ? <p className="mt-5 border-l-2 border-ocean bg-ocean/5 px-3 py-2 text-sm font-bold text-slate-700">You arrived here to review your {focus === "hotel" ? "stay" : focus} details. Confirmed information remains authoritative; anything unresolved is still marked below.</p> : null}

      {visibleReferrals.length ? (
        <section className="mt-5 border-y border-[#e8dfd0] py-4" aria-labelledby="booking-referrals-title">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">External booking activity</p>
          <h2 id="booking-referrals-title" className="mt-1 text-lg font-black text-ink">Options you viewed</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">Roamly has not marked these as booked unless confirmation evidence exists.</p>
          <div className="mt-3 grid gap-2">
            {visibleReferrals.map(({ referral, outcome }) => (
              <div key={referral.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink">{referral.category ? `${referral.category[0].toUpperCase()}${referral.category.slice(1)}` : "Travel"} option</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{referral.provider || "External provider"}</p>
                </div>
                <span className="shrink-0 text-xs font-black text-amber-800">{bookingOutcomeLabel(outcome)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="mt-6 text-sm font-bold text-slate-600">Confirmed details come first. Recommendations and items still needing review follow below.</p>

      {next ? (
        <section className="mt-5 border-b border-[#e8dfd0] pb-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Next booking</p>
          <div className="mt-3 flex items-start gap-3">
            <BookingIcon type={next.booking_type} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black text-ink">{next.title}</h2>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(next.booking_status)}`}>{customerStatus(next, outcomeFor(next))}</span>
              </div>
              <p className="mt-1 text-sm font-bold text-slate-700">{routeLine(next)}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">{primaryDetail(next, locale)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        {groups.length ? groups.map((group) => (
          <section key={group.title} id={focus && ((focus === "flight" && group.title === "Getting there") || (focus === "hotel" && group.title === "Stay") || (focus === "activity" && group.title === "Activities and reservations")) ? `booking-${focus}` : undefined} className="mb-7 scroll-mt-32">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-black tracking-tight text-ink">{group.title}</h2>
              <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{group.bookings.length}</span>
            </div>
            <div className="mt-2 divide-y divide-[#e8dfd0] border-y border-[#e8dfd0]">
              {group.bookings.map((booking) => {
                const rows = detailRows(booking, locale);
                const reference = essentialReference(booking);
                return (
                  <article key={booking.id} className="py-4">
                    <div className="flex items-start gap-3">
                      <BookingIcon type={booking.booking_type} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="text-base font-black text-ink">{booking.title || booking.provider || "Booking"}</h3>
                            <p className="mt-1 text-sm font-bold text-slate-700">{routeLine(booking)}</p>
                            <p className="mt-1 text-sm font-bold text-slate-500">{primaryDetail(booking, locale)}</p>
                            {reference ? <p className="mt-1 text-xs font-black text-slate-500">Reference: {reference}</p> : null}
                          </div>
                          <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(booking.booking_status)}`}>
                            {customerStatus(booking, outcomeFor(booking))}
                          </span>
                        </div>
                        {rows.length ? (
                          <details className="mt-3">
                            <summary className="min-h-11 cursor-pointer text-sm font-black text-ocean">More details</summary>
                            <div className="mt-2 grid gap-1 text-sm font-bold text-slate-600 sm:grid-cols-2">
                              {rows.filter(([label]) => label !== "Confirmation" && label !== "Flight").map(([label, value]) => <p key={label}>{label}: {value}</p>)}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )) : (
          <div className="border-y border-dashed border-[#e8dfd0] py-6">
            <h2 className="text-xl font-black text-ink">Nothing booked yet</h2>
            <p className="mt-1 max-w-md text-sm font-semibold leading-6 text-slate-600">When you book a flight, stay, ticket, or reservation, add it here so the important details are ready when you travel.</p>
            <Link href={`/trip/${tripId}/bookings/add`} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white">Add booking</Link>
          </div>
        )}
      </section>
    </div>
  );
}
