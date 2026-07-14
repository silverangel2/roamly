import { redirect } from "next/navigation";
import { BookingWalletTimeline } from "@/components/companion/BookingWalletTimeline";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, isMissingTableError } from "@/lib/trips";
import { legacyRoamlyBookingToWallet, listTripBookings, stableBookingKey, type TripBookingRecord } from "@/lib/roamly/bookingWallet";

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

export default async function TripBookingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      .order("start_date", { ascending: true, nullsFirst: false })
  ]);

  const walletBookings = walletResult.error && isMissingTableError(walletResult.error) ? [] : walletResult.bookings;
  const legacyBookings =
    legacyResult.error && isMissingTableError(legacyResult.error.message)
      ? []
      : ((legacyResult.data || []) as Record<string, unknown>[]).map((booking) =>
          legacyRoamlyBookingToWallet(booking, { userId: current.user!.id, tripId: id })
        );

  const trip = bundle.data.trip;
  const destinationLabel = getTripDestinationLabel(trip) || "Your trip";
  const tripTitle = trip.title || destinationLabel;

  return (
    <main className="safe-bottom min-h-[calc(100dvh-5rem)] bg-[#fbf8ef] text-ink">
      <BookingWalletTimeline
        tripId={id}
        tripTitle={tripTitle}
        destinationLabel={destinationLabel}
        bookings={mergeBookings(walletBookings, legacyBookings)}
        companionUnlocked={tripHasTrackingUnlock(trip)}
      />
    </main>
  );
}
