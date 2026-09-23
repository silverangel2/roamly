import { redirect } from "next/navigation";
import { BookingWalletTimeline } from "@/components/companion/BookingWalletTimeline";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, isMissingTableError } from "@/lib/trips";
import { getServerLocale } from "@/lib/i18n-server";
import { legacyRoamlyBookingToWallet, listTripBookings, stableBookingKey, type TripBookingRecord } from "@/lib/roamly/bookingWallet";
import { TripContextNav } from "@/components/roamly/TripContextNav";
import { formatRoamlyDate } from "@/lib/i18n";
import { parseTripActionFocus } from "@/lib/roamly/tripReadiness";
import type { BookingOutcomeReferral } from "@/lib/roamly/bookingOutcome";

function mergeBookings(wallet: TripBookingRecord[], legacy: TripBookingRecord[]) {
  const byKey = new Map<string, TripBookingRecord>();
  for (const booking of [...legacy, ...wallet]) {
    const key = stableBookingKey({
      userId: booking.user_id,
      provider: booking.provider,
      providerBookingId: booking.provider_booking_id,
      confirmationCode: booking.confirmation_code,
      bookingType: booking.booking_type,
      flightNumber: booking.flight_number,
      startTime: booking.start_time || booking.check_in_time,
      origin: booking.origin,
      destination: booking.destination,
      title: booking.title
    });
    byKey.set(key, booking);
  }
  return [...byKey.values()];
}

export default async function TripBookingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const focus = parseTripActionFocus(typeof search.focus === "string" ? search.focus : null);
  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/bookings`)}`);
  }

  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const [walletResult, legacyResult] = await Promise.all([
    listTripBookings({
      supabase,
      userId: current.user.id,
      tripId: id,
      includeSegments: true
    }),
    supabase
      .from("roamly_bookings")
      .select("*")
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .order("start_at", { ascending: true, nullsFirst: false })
  ]);

  const referralsResult = await supabase
    .from("roamly_booking_referrals")
    .select("id,trip_id,recommendation_id,provider,commercial_partner,metadata,created_at")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const walletBookings = walletResult.error && isMissingTableError(walletResult.error) ? [] : walletResult.bookings;
  const legacyBookings =
    legacyResult.error && isMissingTableError(legacyResult.error.message)
      ? []
      : ((legacyResult.data || []) as Record<string, unknown>[]).map((booking) =>
        legacyRoamlyBookingToWallet(booking, { userId: current.user!.id, tripId: id })
      );
  const referrals: BookingOutcomeReferral[] = (referralsResult.data || []).map((row) => {
    const context = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      id: String(row.id),
      trip_id: String(row.trip_id),
      recommendation_id: typeof row.recommendation_id === "string" ? row.recommendation_id : null,
      category: typeof context.category === "string" ? context.category : null,
      provider: typeof row.provider === "string" ? row.provider : typeof row.commercial_partner === "string" ? row.commercial_partner : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null
    };
  });
  const referralDetails = (referralsResult.data || []).map((row) => {
    const context = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      id: String(row.id),
      recommendationId: typeof row.recommendation_id === "string" ? row.recommendation_id : null,
      provider: typeof row.provider === "string" ? row.provider : null,
      category: typeof context.category === "string" ? context.category : null,
      title: typeof context.recommendation_title === "string" ? context.recommendation_title : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null
    };
  });

  const trip = bundle.data.trip;
  const destinationLabel = getTripDestinationLabel(trip) || "Your trip";
  const tripTitle = trip.title || destinationLabel;
  const locale = await getServerLocale();
  const dates = trip.start_date && trip.end_date
    ? `${formatRoamlyDate(trip.start_date, locale, { month: "short", day: "numeric" })} - ${formatRoamlyDate(trip.end_date, locale, { month: "short", day: "numeric" })}`
    : "Dates flexible";

  return (
    <div className="safe-bottom min-h-[calc(100dvh-5rem)] bg-[#fbf8ef] text-ink">
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 sm:pt-8">
        <TripContextNav tripId={id} title={tripTitle} destination={destinationLabel} dates={dates} status="Bookings" />
      </div>
      <BookingWalletTimeline
        tripId={id}
        bookings={mergeBookings(walletBookings, legacyBookings)}
        companionUnlocked={tripHasTrackingUnlock(trip)}
        locale={locale}
        focus={focus === "flight" || focus === "hotel" || focus === "activity" ? focus : null}
        referrals={referrals}
        referralDetails={referralDetails}
      />
    </div>
  );
}
