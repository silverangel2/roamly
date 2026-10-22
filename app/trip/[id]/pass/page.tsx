import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { WalletPassCardView } from "@/components/trip/companionPanelViews";
import { getTripDayFromDate } from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { build2CompanionEnabled } from "@/lib/roamly/build2Flags";
import {
  buildWalletPassView,
  panelActivityFromRecord,
  type PanelActivityInput
} from "@/lib/roamly/companionPanel";
import { getWalletPassSignerFromEnv } from "@/lib/roamly/companionPass";
import {
  customerTripLifecycleState,
  isCustomerTripTerminalState,
  localDateInTimeZone,
  timezoneFromTripMetadata
} from "@/lib/roamly/liveCompanion";
import { localizeActivityRecords } from "@/lib/roamly/liveActivityBinding";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
import { getTripDaysCount, getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { addCalendarDays, instantStringToLocal } from "@/lib/roamly/engine/time";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, groupActivitiesByDay } from "@/lib/trips";

/*
 * Build 2 Live Companion — the day pass page (Phase 7).
 *
 * The wallet pass as an in-app surface: Roamly identity, the day,
 * the next activity, and the essential booking details, rendered
 * from the same WalletPassView the platform payloads are built
 * from (lib/roamly/companionPass.ts). The downloadable Apple/Google
 * wallet files need the owner's pass certificate / service account
 * (injected signer seam — none configured yet), and this page says
 * so plainly instead of faking a download.
 */

function getRowString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function TripPassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!build2CompanionEnabled()) redirect(`/trip/${id}/live`);

  const locale = await getServerLocale();
  const current = await getCurrentUser();
  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/pass`)}`);
  }
  if (!current.configured || !current.user) {
    return (
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink">Connect Supabase to use your day pass.</h1>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const tripLifecycle = customerTripLifecycleState({
    status: bundle.data.trip.status,
    itineraryStatus: bundle.data.trip.itinerary_status,
    startDate: bundle.data.trip.start_date,
    endDate: bundle.data.trip.end_date,
    metadata: bundle.data.trip.metadata
  });
  const tripCompleted = isCustomerTripTerminalState(tripLifecycle);
  if ((!isTripLocked(bundle.data.trip) && !tripCompleted) || (!tripHasTrackingUnlock(bundle.data.trip) && !tripCompleted)) {
    redirect(`/trip/${id}`);
  }

  const timezone = timezoneFromTripMetadata(bundle.data.trip.metadata);
  const daysCount = getTripDaysCount(bundle.data.trip);
  const currentDay = getTripDayFromDate(bundle.data.trip.start_date, daysCount || null, timezone);
  const nowInstant = new Date().toISOString();
  const todayLocal = localDateInTimeZone(nowInstant, timezone);
  const passDate = bundle.data.trip.start_date
    ? addCalendarDays(bundle.data.trip.start_date, Math.max(0, currentDay - 1))
    : todayLocal;
  const nowParts = instantStringToLocal(nowInstant, timezone);

  const localizedFull = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: bundle.data.trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const localizedActivities = localizeActivityRecords(
    bundle.data.activities,
    localizedFull,
    bundle.data.itinerary?.full_json || null
  );
  const activitiesByDay = groupActivitiesByDay(localizedActivities);
  const dayActivities = activitiesByDay[currentDay] || localizedActivities.slice(0, 4);
  const panelActivities: PanelActivityInput[] = dayActivities
    .map((activity) => panelActivityFromRecord(activity, { date: passDate }))
    .filter((activity): activity is PanelActivityInput => activity !== null);

  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("booking_type,title,start_at,start_date,start_time")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .is("superseded_by_booking_id", null)
    .order("start_at", { ascending: true, nullsFirst: false });
  const bookingRows = (bookingsResult.data || []) as Array<Record<string, unknown>>;
  const hotelBooking = bookingRows.find((booking) => getRowString(booking, "booking_type") === "hotel");
  const hotelName = hotelBooking ? getRowString(hotelBooking, "title") : null;
  const hotelCheckInLabel = hotelBooking
    ? getRowString(hotelBooking, "start_at") ||
      (getRowString(hotelBooking, "start_date")
        ? `${getRowString(hotelBooking, "start_date")}${getRowString(hotelBooking, "start_time") ? ` ${getRowString(hotelBooking, "start_time")}` : ""}`
        : null)
    : null;

  const userMeta = (current.user.user_metadata || {}) as Record<string, unknown>;
  const travelerName =
    typeof userMeta.full_name === "string"
      ? userMeta.full_name
      : typeof userMeta.name === "string"
        ? userMeta.name
        : null;

  const passView = buildWalletPassView({
    destination: getTripDestinationLabel(bundle.data.trip) || "your trip",
    date: passDate,
    travelerName,
    partyLabel: null,
    activities: panelActivities,
    hotelName,
    hotelCheckInLabel,
    nowMin: passDate === todayLocal ? nowParts.minutes : 0,
    cachedAt: null,
    pendingSyncActions: 0
  });

  const signer = getWalletPassSignerFromEnv();

  return (
    <div className="safe-bottom mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[0.75rem] font-medium text-slate-500">Live Companion</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] text-ink">Your day pass</h1>
        </div>
        <Button href={`/trip/${id}/live`} tone="secondary">Back to today</Button>
      </div>
      <WalletPassCardView pass={passView} />
      <p className="mx-auto mt-4 w-[358px] max-w-full text-[12px] leading-[1.5] text-slate-600">
        {signer
          ? "Wallet download is configured for this trip — your pass above is the same day the wallet file carries."
          : "This screen is your pass for today — it works offline once your day is cached in the app. Adding it to Apple Wallet or Google Wallet arrives when Roamly's wallet certificate is in place; nothing about your day changes when it does."}
      </p>
    </div>
  );
}
