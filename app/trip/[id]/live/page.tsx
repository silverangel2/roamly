import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { hasSetupSkip, setupSkipCookieName } from "@/lib/roamly/setupSkip";
import { formatGateEyebrow } from "@/lib/roamly/tripIdentity";
import { LiveTripClient, type LiveCompanionBookingDetail, type LiveSimulatorPlace } from "@/components/trip/LiveTripClient";
import { SetupGateScreen } from "@/components/roamly/TripSetupGate";
import { OfflineTripBanner } from "@/components/roamly/OfflineTripBanner";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { hasPriorTrip, setupGateApplies, setupGateLimitedFeatures } from "@/lib/roamly/setupGate";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { getTripDayFromDate, isCompanionEligibleActivity } from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { buildLiveCompanionSummary, scheduleCompanionEvents } from "@/lib/roamly/tripCompanion";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import { localizeActivityRecords, mergePersistedSkipStatuses } from "@/lib/roamly/liveActivityBinding";
import { localDateInTimeZone, type LiveLocationPermission } from "@/lib/roamly/liveCompanion";
import { resolveTripTimezoneServer } from "@/lib/roamly/tripTimezoneServer";
import { zoneForMath } from "@/lib/roamly/tripTimezone";
import { build2CompanionEnabled } from "@/lib/roamly/build2Flags";
import { CompanionPanel } from "@/components/trip/CompanionPanel";
import {
  buildWalletPassView,
  panelActivityFromRecord,
  type CompanionPanelInput,
  type PanelActivityInput,
  type WalletPassView
} from "@/lib/roamly/companionPanel";
import { SupabaseCompanionLedgerStore } from "@/lib/roamly/companionLedger";
import { addCalendarDays, instantStringToLocal } from "@/lib/roamly/engine/time";
import { hasConfirmedFlightBooking } from "@/lib/roamly/itineraryPresentation";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDaysCount,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { getDestinationPhoto } from "@/lib/roamly/destinationPhoto";
import { buildDayTimelineRows, coerceDayTimelineItem } from "@/lib/roamly/liveDayTimeline";
import { buildVenuePhotoMap } from "@/lib/roamly/venuePhotos";
import { tripDayDateLabel } from "@/lib/roamly/tripClock";
import { itineraryDaysFromDailyItinerary } from "@/lib/roamly/liveItineraryFallback";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
import { evaluateConfirmedBookingCost } from "@/lib/roamly/bookings";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, groupActivitiesByDay } from "@/lib/trips";
import { customerTripLifecycleState, isCustomerTripTerminalState } from "@/lib/roamly/liveCompanion";

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getRowString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function LiveTripPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const fieldTestRequested = search.fieldTest === "1";
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    const next = fieldTestRequested ? `/field-test/${id}` : `/trip/${id}/live`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!current.configured || !current.user) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup</Badge>
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.018em] text-chead">Connect Supabase to use Live Trip Companion.</h1>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const access = getRoamlyAccessForUser(current.user.email);
  const bundle = await getTripBundle(supabase, current.user.id, id);

  if (!bundle.data) redirect("/dashboard?tripAccess=denied");
  // Timezone round (2026-10-26): ONE resolution for every day
  // computation on this page — stored metadata first, then the
  // verified destination registry (Montreal → America/Toronto, etc.).
  // The old metadata-only lookup silently fell back to UTC and showed
  // the NEXT day after 20:00 destination-local time. When the zone is
  // genuinely unknown, day math uses UTC only as the LABELED fallback
  // (timezoneUnknown reaches the client, which renders the label).
  const tripRecord = bundle.data.trip as typeof bundle.data.trip & {
    destination_name?: unknown;
    destination_city?: unknown;
  };
  const tripTimezoneResolution = resolveTripTimezoneServer({
    metadata: bundle.data.trip.metadata,
    destination: getTripDestinationLabel(bundle.data.trip),
    destination_name: tripRecord.destination_name,
    destination_city: tripRecord.destination_city
  });
  const tripTimezoneForMath = zoneForMath(tripTimezoneResolution);
  const locked = isTripLocked(bundle.data.trip);
  const companionUnlocked = tripHasTrackingUnlock(bundle.data.trip);
  const fieldTestMode = fieldTestRequested && access.hasQaAccess && bundle.data.trip.metadata?.field_test === true;
  const tripLifecycle = customerTripLifecycleState({
    status: bundle.data.trip.status,
    itineraryStatus: bundle.data.trip.itinerary_status,
    startDate: bundle.data.trip.start_date,
    endDate: bundle.data.trip.end_date,
    metadata: bundle.data.trip.metadata,
    timezone: tripTimezoneForMath
  });
  const tripCompleted = isCustomerTripTerminalState(tripLifecycle);
  // A trip that has not generated yet still goes back to its trip page,
  // where generation lives. A generated trip whose Companion is not
  // unlocked must NOT bounce silently back to the trip page: the traveler
  // clicked Live on purpose and deserves to be told why it did not open
  // and where the unlock lives (the trip page's Activate control).
  if (!locked && !tripCompleted) redirect(`/trip/${id}`);
  // Correction phase (D7, 2026-10-28): the locked-Live gate was a dead
  // wall — no preview, no skip path. It now shows a preview of the
  // traveler's own first day (localized itinerary; pure computation,
  // safe to run before scheduling) plus the free-flow refusal path.
  // Nothing here unlocks anything: unlocking still lives on the trip
  // page's Activate control, and both buttons land there because the
  // trip page hosts both the itinerary and the unlock.
  const gatePreviewItinerary = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: bundle.data.trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const gatePreviewDay = (gatePreviewItinerary?.daily_itinerary || [])[0] || null;
  const gatePreviewStops = ((gatePreviewDay?.live_timeline || []) as Array<Record<string, unknown>>)
    .map((item) => ({
      time: typeof item.time === "string" ? item.time : typeof item.time_label === "string" ? item.time_label : "",
      title: typeof item.title === "string" ? item.title : ""
    }))
    .filter((stop) => stop.title)
    .slice(0, 4);
  if (!companionUnlocked && !tripCompleted) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Live Companion</Badge>
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.018em] text-chead">Live Companion isn&apos;t unlocked for this trip yet</h1>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Live Companion follows you during the trip with day-by-day help. It needs to be unlocked for this trip before it can open.
          </p>
          <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
            Go back to the trip page to unlock it. Nothing was changed, and your itinerary is still there.
          </p>
          {gatePreviewStops.length ? (
            <div className="mt-5 rounded-2xl bg-mist/50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Preview · Day 1 of your itinerary</p>
              <div className="mt-2 grid gap-1.5">
                {gatePreviewStops.map((stop) => (
                  <p key={`${stop.time}-${stop.title}`} className="text-sm font-semibold leading-6 text-chead">
                    {stop.time ? `${stop.time} · ` : ""}{stop.title}
                  </p>
                ))}
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">Live Companion stays locked until you unlock it on the trip page.</p>
            </div>
          ) : (
            <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">
              When unlocked, Live Companion shows each day&apos;s stops, directions, and check-in as you travel.
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={`/trip/${id}`}
              className="inline-flex min-h-11 items-center rounded-full bg-ocean px-5 py-3 text-sm font-bold text-white"
            >
              Back to trip
            </a>
            <a
              href={`/trip/${id}`}
              className="inline-flex min-h-11 items-center rounded-full border border-cloud bg-white px-5 py-3 text-sm font-bold text-chead"
            >
              Skip for now
            </a>
          </div>
          <p className="mt-3 text-[13px] font-medium leading-5 text-cgray">You can still view your full itinerary. Live Companion stays locked until you unlock it.</p>
        </Card>
      </div>
    );
  }

  if (!tripCompleted) await scheduleCompanionEvents(supabase, id);
  const destinationLabel = getTripDestinationLabel(bundle.data.trip) || "your trip";
  // Repair round P3: origin is no longer a displayed Live header line
  // (the client's hero is the single header); it still reaches the
  // client as a prop for directions links at each render site below.
  const photoPlanning = getTripPlanningMetadata(bundle.data.trip.metadata);
  const localizedFull = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: bundle.data.trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const daysCount = getTripDaysCount(bundle.data.trip);
  const budgetCurrency = getTripBudgetCurrency(bundle.data.trip);
  const currentDay = getTripDayFromDate(bundle.data.trip.start_date, daysCount || null, tripTimezoneForMath);
  const [companion, bookingsResult, trackingActivitiesResult, trackingDaysResult, preferences, locationSettingsResult, destinationPhoto] = await Promise.all([
    buildLiveCompanionSummary(supabase, current.user.id, id),
    supabase
      .from("roamly_bookings")
      .select("*")
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .is("superseded_by_booking_id", null)
      .order("start_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("roamly_activities")
      .select("id,title,category,address,city,country,latitude,longitude,status,sort_order,trip_day_id,metadata")
      .eq("trip_id", id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("roamly_trip_days")
      .select("id,day_number")
      .eq("trip_id", id),
    getCompanionPreferences({
      supabase,
      userId: current.user.id,
      tripId: id
    }),
    supabase
      .from("roamly_location_settings")
      .select("last_permission_state,location_tracking_enabled,last_seen_latitude,last_seen_longitude,last_seen_at")
      .eq("user_id", current.user.id)
      .maybeSingle(),
    // Round 2 hero photo: the SAME destination-photo pipeline the trip
    // page uses (real Wikimedia/Wikidata photo, cached, 6s cap). Null
    // renders the approved bare header — never a generated image.
    getDestinationPhoto({
      label: destinationLabel,
      country: typeof photoPlanning.destinationCountry === "string" ? photoPlanning.destinationCountry : null,
      latitude: typeof photoPlanning.destinationLatitude === "number" ? photoPlanning.destinationLatitude : null,
      longitude: typeof photoPlanning.destinationLongitude === "number" ? photoPlanning.destinationLongitude : null
    }).catch(() => null)
  ]);

  const trackingDayNumbers = new Map(
    ((trackingDaysResult.data || []) as Array<{ id: string; day_number: number }>).map((day) => [day.id, day.day_number])
  );
  const trackingActivityRows = ((trackingActivitiesResult.data || []) as Array<Record<string, unknown>>);
  const activitiesWithServerSkips = mergePersistedSkipStatuses(
    bundle.data.activities,
    trackingActivityRows.map((activity) => ({
      title: getRowString(activity, "title") || "",
      status: getRowString(activity, "status") || "",
      day_number: getRowString(activity, "trip_day_id") ? trackingDayNumbers.get(getRowString(activity, "trip_day_id")!) ?? null : null,
      time_label: getRowString(getRecord(activity.metadata) || {}, "time_label")
    }))
  );
  const localizedActivitiesWithServerSkips = localizeActivityRecords(
    activitiesWithServerSkips,
    localizedFull,
    bundle.data.itinerary?.full_json || null
  );
  const activitiesByDay = groupActivitiesByDay(localizedActivitiesWithServerSkips);
  const dayActivities = activitiesByDay[currentDay] || localizedActivitiesWithServerSkips.slice(0, 4);
  // The Companion surfaces real itinerary items only: a search placeholder
  // must never appear as NEXT; the next real item is shown instead.
  const nextActivity =
    dayActivities.find(
      (activity) => !["completed", "skipped", "missed"].includes(activity.status) && isCompanionEligibleActivity(activity)
    ) ||
    dayActivities.find((activity) => isCompanionEligibleActivity(activity)) ||
    dayActivities[0] ||
    null;
  const nearbyActivity = dayActivities.find((activity) => activity.status === "nearby") || null;

  // Round 2 panels (server-built, real stored data only):
  // - Day timeline rows from the stored live_timeline for the current
  //   day (same source the trip page renders). Times, durations, and
  //   legs come from these seeds; the composite's sample times are
  //   never used. Empty when the itinerary is unavailable.
  // - Full Itinerary tab days from the grouped day activities.
  // - Day plan title from the stored day plan (fallback: trip days).
  const currentDayPlan = localizedFull?.daily_itinerary.find((day) => day.day_number === currentDay) || null;
  const dayTimelineRows = buildDayTimelineRows(
    (currentDayPlan?.live_timeline || [])
      .map((seed) => coerceDayTimelineItem(seed))
      .filter((item): item is NonNullable<typeof item> => item !== null),
    getTripOriginLabel(bundle.data.trip),
    destinationLabel
  );
  const dayPlanTitle =
    currentDayPlan?.title || bundle.data.days.find((day) => day.day_number === currentDay)?.title || null;
  // Venue-row thumbnails (originals pass): one parallel pipeline round
  // over the plan's venue stops; misses stay icon-only downstream.
  const venuePhotos = await buildVenuePhotoMap(
    localizedFull?.daily_itinerary || [],
    typeof photoPlanning.destinationCountry === "string" ? photoPlanning.destinationCountry : bundle.data.trip.destination_country || null
  ).catch(() => ({}));
  // Hoisted out of the map callback: narrowing of bundle.data does not
  // persist into closures, so the start date is read straight-line here.
  const tripStartDateForDays = bundle.data.trip.start_date;
  const trackedItineraryDays = Object.entries(activitiesByDay)
    .map(([dayKey, dayActs]) => ({
      dayNumber: Number(dayKey),
      dateLabel: tripDayDateLabel(tripStartDateForDays, Number(dayKey)),
      activities: (dayActs as Array<{ title?: unknown; time_label?: unknown; status?: unknown; map_query?: unknown; latitude?: unknown; longitude?: unknown }>).map((activity) => ({
        title: typeof activity.title === "string" ? activity.title : "",
        timeLabel: typeof activity.time_label === "string" ? activity.time_label : null,
        status: typeof activity.status === "string" ? activity.status : null,
        mapQuery: typeof activity.map_query === "string" ? activity.map_query : null,
        latitude: getNumberOrNull(activity.latitude),
        longitude: getNumberOrNull(activity.longitude)
      }))
    }))
    .filter((day) => Number.isFinite(day.dayNumber))
    .sort((a, b) => a.dayNumber - b.dayNumber);
  // Correction phase (D5, 2026-10-28): trips whose activities were
  // never materialized into roamly_trip_activities (seeded trips, and
  // any trip whose tracking rows are absent) left the Full Itinerary
  // tab empty even though the itinerary JSON exists — the same source
  // the trip page renders. Fall back to the itinerary's own days,
  // with honest Planned labels. These rows carry no activity ids, so
  // no tracking action can attach to them; the client renders them
  // read-only. All-or-nothing (never mixed with tracked days) so a
  // day can never double-count or mismatch across sources. The
  // mapping lives in lib/roamly/liveItineraryFallback so it is
  // unit-tested against seed-shaped days.
  const itineraryFallbackDays = itineraryDaysFromDailyItinerary(
    localizedFull?.daily_itinerary || [],
    (dayNumber) => tripDayDateLabel(tripStartDateForDays, dayNumber)
  );
  const itineraryDays = trackedItineraryDays.length ? trackedItineraryDays : itineraryFallbackDays;

  const companionMetadata = getRecord(getRecord(companion.trip?.metadata)?.companion) || {};
  const countryInfo = (getRecord(companionMetadata.travelCountryInfo) || {}) as {
    title?: string;
    summary?: string;
    reminders?: string[];
  };
  const packing = getStringArray(companionMetadata.packingChecklist);
  const documents = getStringArray(companionMetadata.documentChecklist);
  const packingItems = packing.length ? packing : localizedFull?.packing_checklist || bundle.data.checklist.map((item) => item.item);
  const committedBudget = evaluateConfirmedBookingCost(bookingsResult.data || [], budgetCurrency);
  const committedBudgetCents = committedBudget.amountCents;
  const committedBudgetUncertain = committedBudget.status !== "known_compatible";
  const budgetAmount = getTripBudgetAmount(bundle.data.trip);
  const totalBudgetCents = budgetAmount == null ? null : Math.round(budgetAmount * 100);
  const remainingBudgetCents = totalBudgetCents == null || committedBudgetCents == null ? null : totalBudgetCents - committedBudgetCents;
  // Repair round P3: the page-level trip-timing header is gone (the
  // client's hero is the single header now), so its countdown/range
  // computations are gone with it — the hero badge from the shared
  // trip clock already carries the same state. No new date logic was
  // introduced for this collapse.
  const bookingRows = ((bookingsResult.data || []) as Record<string, unknown>[]);
  const confirmedFlight = hasConfirmedFlightBooking(bookingRows);
  const locationRow = getRecord(locationSettingsResult.data);
  const permissionState = (getRowString(locationRow || {}, "last_permission_state") || "prompt") as LiveLocationPermission;
  const initialTrackingEnabled = (locationRow as Record<string, unknown> | null)?.location_tracking_enabled === true;
  // Round 2: the Live client starts from the same persisted fix the
  // Alerts page reads through locationEvidence. The client re-checks
  // freshness on every tick (usableLocation), so a stale persisted fix
  // can never pose as current location — and with no fix at all the
  // client honestly reports "Location needed", agreeing with Alerts.
  const persistedLatitude = getNumberOrNull(locationRow?.last_seen_latitude);
  const persistedLongitude = getNumberOrNull(locationRow?.last_seen_longitude);
  const persistedSeenAt = getRowString(locationRow || {}, "last_seen_at");
  const initialLocation =
    persistedLatitude != null && persistedLongitude != null && persistedSeenAt
      ? { latitude: persistedLatitude, longitude: persistedLongitude, capturedAt: persistedSeenAt }
      : null;
  const tripTimezone = tripTimezoneForMath;
  const tripUpcoming = tripLifecycle === "upcoming";
  const tripDatesMissing = tripLifecycle === "missing_dates";
  function bookingTime(row: Record<string, unknown>, dateKey: string, timeKey: string) {
    const date = getRowString(row, dateKey);
    const time = getRowString(row, timeKey);
    if (!date) return null;
    return time ? `${date}T${time}` : `${date}T00:00:00`;
  }
  function canonicalBookingTime(row: Record<string, unknown>, timestampKey: string, dateKey: string, timeKey: string) {
    return getRowString(row, timestampKey) || bookingTime(row, dateKey, timeKey);
  }
  const bookingDetails: LiveCompanionBookingDetail[] = bookingRows.map((booking) => ({
    id: getRowString(booking, "id"),
    title: getRowString(booking, "title"),
    reference: getRowString(booking, "confirmation_number") || getRowString(booking, "provider_booking_id"),
    provider: getRowString(booking, "provider_name") || getRowString(booking, "provider"),
    gate: getRowString(booking, "gate"),
    terminal: getRowString(booking, "terminal"),
    startTime: canonicalBookingTime(booking, "start_at", "start_date", "start_time"),
    endTime: canonicalBookingTime(booking, "end_at", "end_date", "end_time"),
    status: ["confirmed", "modified", "completed", "booked", "paid", "reserved"].includes(getRowString(booking, "booking_status") || "")
      ? "verified"
      : "unknown",
    updatedAt: getRowString(booking, "updated_at") || getRowString(booking, "created_at")
  }));
  // Build 2 (Phase 7): the compact companion panel — a new view over
  // the same day activities this page already loaded, plus the trip's
  // M2 ledger rows. Flag-gated: with ROAMLY_BUILD2_COMPANION_ENABLED
  // off, nothing below runs and the page is byte-for-byte unchanged.
  // The panel mounts only when the panel's date is the traveler's
  // today (its now-geometry is meaningless for other days). Collision
  // alerts arrive with Phase 9's updater; the input carries none yet.
  let companionPanelInput: CompanionPanelInput | null = null;
  let companionPassView: WalletPassView | null = null;
  if (build2CompanionEnabled() && !tripCompleted) {
    const nowInstant = new Date().toISOString();
    const todayLocal = localDateInTimeZone(nowInstant, tripTimezone);
    const panelDate = bundle.data.trip.start_date
      ? addCalendarDays(bundle.data.trip.start_date, Math.max(0, currentDay - 1))
      : todayLocal;
    if (panelDate === todayLocal) {
      const hotelBooking = bookingRows.find(
        (booking) => getRowString(booking, "booking_type") === "hotel"
      );
      const hotelName = hotelBooking ? getRowString(hotelBooking, "title") : null;
      const panelActivities: PanelActivityInput[] = dayActivities
        .map((activity) => panelActivityFromRecord(activity, { date: panelDate }))
        .filter((activity): activity is PanelActivityInput => activity !== null);
      let ledgerEntries: CompanionPanelInput["ledgerEntries"] = [];
      try {
        ledgerEntries = await new SupabaseCompanionLedgerStore(supabase).listForTrip(id);
      } catch {
        ledgerEntries = [];
      }
      const nowParts = instantStringToLocal(nowInstant, tripTimezone);
      companionPanelInput = {
        tripId: id,
        destination: destinationLabel,
        date: panelDate,
        timezone: tripTimezone,
        nowMin: nowParts.minutes,
        activities: panelActivities,
        ledgerEntries,
        alerts: [],
        citymapperCoverage: false,
        bufferMin: 10,
        currentPlace: hotelName
      };
      const userMeta = (current.user.user_metadata || {}) as Record<string, unknown>;
      const travelerName =
        typeof userMeta.full_name === "string"
          ? userMeta.full_name
          : typeof userMeta.name === "string"
            ? userMeta.name
            : null;
      companionPassView = buildWalletPassView({
        destination: destinationLabel,
        date: panelDate,
        travelerName,
        partyLabel: null,
        activities: panelActivities,
        hotelName,
        hotelCheckInLabel: hotelBooking
          ? canonicalBookingTime(hotelBooking, "start_at", "start_date", "start_time")
          : null,
        nowMin: nowParts.minutes,
        cachedAt: null,
        pendingSyncActions: 0
      });
    }
  }
  const simulatorPlaces: LiveSimulatorPlace[] = [
    ...localizedActivitiesWithServerSkips.map((activity, index) => ({
      id: `activity:${activity.id || activity.title || index}`,
      title: activity.title || "Trip activity",
      kind: "activity" as const,
      latitude: getNumberOrNull(trackingActivityRows[index]?.latitude),
      longitude: getNumberOrNull(trackingActivityRows[index]?.longitude),
      address: activity.map_query || activity.location_name || null,
      status: activity.status
    })),
    ...bookingRows.map((booking, index) => {
      const type = getRowString(booking, "booking_type") || "booking";
      return {
        id: `booking:${getRowString(booking, "id") || getRowString(booking, "title") || `${type}-${index}`}`,
        title: getRowString(booking, "title") || `${type.charAt(0).toUpperCase()}${type.slice(1)} booking`,
        kind: type === "hotel" ? ("hotel" as const) : ("booking" as const),
        latitude: getNumberOrNull(booking.latitude),
        longitude: getNumberOrNull(booking.longitude),
        address: [getRowString(booking, "address"), getRowString(booking, "city"), getRowString(booking, "country")]
          .filter(Boolean)
          .join(", ") || null,
        status: getRowString(booking, "start_at") || getRowString(booking, "start_date")
      };
    }),
    {
      id: "destination:center",
      title: destinationLabel,
      kind: "destination" as const,
      latitude: null,
      longitude: null,
      address: destinationLabel,
      status: null
    }
  ];

  if (fieldTestMode) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
        <section className="sticky top-2 z-10 mb-5 rounded-2xl border-2 border-coral/40 bg-white px-4 py-3 text-ink shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sun">Admin field test • Saint John</p>
              <p className="mt-1 text-sm font-black text-slate-600">Real Roamly Live Companion runtime</p>
            </div>
            <a href={`/trip/${id}`} className="rounded-xl bg-ocean px-3 py-2 text-xs font-black text-white">Exit field test</a>
          </div>
        </section>
        <section className="mb-5 rounded-[1.75rem] border-2 border-ocean/30 bg-white p-6 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Admin-controlled mobile setup</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-ink">LIVE COMPANION FIELD TEST</h1>
          <p className="mt-2 text-2xl font-black text-ocean">Saint John</p>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-600">This is the Admin field test using the real Roamly Live Companion.</p>
          <div className="mt-5 grid gap-3 text-sm font-black text-slate-700 sm:grid-cols-3">
            <div className="rounded-2xl bg-mist p-4"><span className="text-ocean">STEP 1</span><br />Install Roamly</div>
            <div className="rounded-2xl bg-mist p-4"><span className="text-ocean">STEP 2</span><br />Notifications</div>
            <div className="rounded-2xl bg-mist p-4"><span className="text-ocean">STEP 3</span><br />Location</div>
          </div>
        </section>
        <LiveTripClient
          tripId={id}
          activities={dayActivities}
          checklist={bundle.data.checklist}
          canSimulateLocation={false}
          destinationLabel={destinationLabel}
          originLabel={getTripOriginLabel(bundle.data.trip)}
          simulatorPlaces={simulatorPlaces}
          tripStartDate={bundle.data.trip.start_date}
          tripEndDate={bundle.data.trip.end_date}
          transportationPreference={bundle.data.trip.transportation_preference}
          hasConfirmedFlight={confirmedFlight}
          timezone={tripTimezone}
          timezoneUnknown={!tripTimezoneResolution.known}
          companionEnabled={preferences.liveCompanionEnabled}
          companionPausedUntil={preferences.liveCompanionPausedUntil}
          backgroundLocationEnabled={preferences.backgroundLocationEnabled}
          initialPermissionState={permissionState}
          initialTrackingEnabled={initialTrackingEnabled}
          initialLocation={initialLocation}
          bookingDetails={bookingDetails}
          liveDemoEnabled={false}
          fieldTestMode
          heroPhoto={destinationPhoto ? { imageUrl: destinationPhoto.imageUrl, credit: destinationPhoto.credit, pageUrl: destinationPhoto.pageUrl } : null}
          dayTimelineRows={dayTimelineRows}
          itineraryDays={itineraryDays}
          dayPlanTitle={dayPlanTitle}
          venuePhotos={venuePhotos}
        />
      </div>
    );
  }

  // The setup gate (owner design, 2026-10-23; second-time law, 2026-10-24):
  // the companion's home sits behind the same one-time setup as the
  // trip — a traveler whose steps were never completed meets the
  // cascade, not a half-live companion — but only from the second trip
  // on (see lib/roamly/setupGate.ts), and never as a wall: skip for now
  // reveals the companion with its limits named. Field-test mode is an
  // internal lane and skips it.
  if (!fieldTestMode) {
    const setupState = await getRoamlySetupState(supabase, current.user).catch(() => null);
    // Round 2: the trip page's remembered skip applies here too — the
    // same per-trip cookie, so skipping once reveals both surfaces on
    // return (see lib/roamly/setupSkip.ts). Never completes a step.
    const skipCookieName = setupSkipCookieName(id);
    const skippedBefore = skipCookieName ? hasSetupSkip((await cookies()).get(skipCookieName)?.value, id) : false;
    const skipLiveGate = search.skipSetupGate === "1" || skippedBefore;
    const priorTrip =
      setupState && !setupState.complete ? await hasPriorTrip(supabase, current.user.id, id) : false;
    const gateApplies = setupState
      ? setupGateApplies({ setupComplete: setupState.complete, hasQaAccess: access.hasQaAccess, hasPriorTrip: priorTrip })
      : false;
    if (gateApplies && !skipLiveGate && setupState) {
      return (
        <SetupGateScreen
          initialState={setupState}
          eyebrow={formatGateEyebrow(destinationLabel, bundle.data.trip.start_date, bundle.data.trip.end_date) || destinationLabel}
          dayCount={daysCount}
          skipHref={`/trip/${id}/live?skipSetupGate=1`}
          limitedFeatures={setupGateLimitedFeatures(setupState)}
          tripId={id}
        />
      );
    }
  }

  if (!fieldTestMode) {
    return (
      <div className="calm-bleed mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
        {/* Offline round (2026-10-27): cached-trip label. Renders
            nothing while online; offline it shows the real
            last-online-load time for this trip. */}
        <OfflineTripBanner tripId={id} />
        {/* Truth rebuild (2026-10-23): no TripContextNav, no page H1
            block, no marketing subline on this surface. The client
            opens with the mock-04 title block (eyebrow · NOW as the
            title · status line); the trip's sections stay reachable
            via the itinerary and the shell's app tab bar. */}
        {/* Repair round P3: NO page-level trip header here anymore.
            The page used to render this trip-timing card AND the
            client's own TripHeroCard AND a "Trip in progress" banner
            title — three destination/state headers stacked. The
            client's hero is now the Live view's ONE authoritative
            header (destination + dates + day + state badge from the
            same trip clock, plus the photo); it already carried the
            countdown/state the card below duplicated, so nothing
            about the trip's state is lost. The origin line leaves
            with the card — origin still reaches the client as a prop
            for directions links, and stays on the trip home. */}
        {companionPanelInput ? (
          <div className="mb-5">
            <CompanionPanel tripId={id} initialInput={companionPanelInput} passView={companionPassView} />
          </div>
        ) : null}
        {tripCompleted ? (
          <Card>
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Trip complete</p>
            <h2 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Live Companion is closed for this trip</h2>
            <p className="mt-2 text-[15px] font-normal leading-[1.45] text-cink">This historical trip remains viewable, but NOW, NEXT, check-in, skip, starting-soon, and live Maps actions are unavailable.</p>
          </Card>
        ) : (
          <LiveTripClient
            tripId={id}
            activities={dayActivities}
            checklist={bundle.data.checklist}
            canSimulateLocation={false}
            destinationLabel={destinationLabel}
          originLabel={getTripOriginLabel(bundle.data.trip)}
            simulatorPlaces={simulatorPlaces}
            tripStartDate={bundle.data.trip.start_date}
            tripEndDate={bundle.data.trip.end_date}
            transportationPreference={bundle.data.trip.transportation_preference}
          hasConfirmedFlight={confirmedFlight}
            timezone={tripTimezone}
          timezoneUnknown={!tripTimezoneResolution.known}
            companionEnabled={preferences.liveCompanionEnabled}
            companionPausedUntil={preferences.liveCompanionPausedUntil}
            backgroundLocationEnabled={preferences.backgroundLocationEnabled}
            initialPermissionState={permissionState}
            initialTrackingEnabled={initialTrackingEnabled}
            initialLocation={initialLocation}
            bookingDetails={bookingDetails}
            liveDemoEnabled={false}
            heroPhoto={destinationPhoto ? { imageUrl: destinationPhoto.imageUrl, credit: destinationPhoto.credit, pageUrl: destinationPhoto.pageUrl } : null}
            dayTimelineRows={dayTimelineRows}
            itineraryDays={itineraryDays}
            dayPlanTitle={dayPlanTitle}
          venuePhotos={venuePhotos}
          />
        )}
      </div>
    );
  }
}
