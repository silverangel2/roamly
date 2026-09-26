import { redirect } from "next/navigation";
import { TripBookingsList } from "@/components/roamly/TripBookingsManager";
import { LiveTripClient, type LiveCompanionBookingDetail, type LiveSimulatorPlace } from "@/components/trip/LiveTripClient";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { getTripDayFromDate } from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { formatRoamlyCurrency, formatRoamlyDate } from "@/lib/i18n";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { buildLiveCompanionSummary, scheduleCompanionEvents, unlockLiveCompanion } from "@/lib/roamly/tripCompanion";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";
import { localizeActivityRecords, mergePersistedSkipStatuses } from "@/lib/roamly/liveActivityBinding";
import { timezoneFromTripMetadata, type LiveLocationPermission } from "@/lib/roamly/liveCompanion";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDaysCount,
  getTripDestinationLabel
} from "@/lib/roamly/tripMetadata";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
import { evaluateConfirmedBookingCost } from "@/lib/roamly/bookings";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, groupActivitiesByDay } from "@/lib/trips";
import { CompanionControlCard } from "@/components/roamly/CompanionControlCard";
import CompanionRepairCenter from "@/components/roamly/CompanionRepairCenter";
import CompanionEventTimeline from "@/components/roamly/CompanionEventTimeline";
import { TripContextNav } from "@/components/roamly/TripContextNav";
import { customerTripLifecycleState } from "@/lib/roamly/liveCompanion";

function formatMoney(cents: number | null, currency: string, locale: Parameters<typeof formatRoamlyCurrency>[2]) {
  if (cents == null) return "Not set";
  return formatRoamlyCurrency(cents / 100, (currency || "CAD").toUpperCase(), locale, { maximumFractionDigits: 0 });
}

function daysUntil(date: string | null) {
  if (!date) return null;
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((start.getTime() - today.getTime()) / 86400000);
}

function countdownCopy(value: number | null, currentDay: number) {
  if (value == null) return "Trip date not set";
  if (value > 1) return `${value} days until Day 1`;
  if (value === 1) return "Tomorrow is Day 1";
  if (value === 0) return "Trip activated today";
  return `Current travel day ${currentDay}`;
}

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
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink">Connect Supabase to use Live Trip Companion.</h1>
        </Card>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const access = getRoamlyAccessForUser(current.user.email);
  const bundle = await getTripBundle(supabase, current.user.id, id);

  if (!bundle.data) redirect("/dashboard?tripAccess=denied");
  const locked = isTripLocked(bundle.data.trip);
  const companionUnlocked = tripHasTrackingUnlock(bundle.data.trip);
  const fieldTestMode = fieldTestRequested && access.hasQaAccess && bundle.data.trip.metadata?.field_test === true;
  const tripLifecycle = customerTripLifecycleState({
    status: bundle.data.trip.status,
    itineraryStatus: bundle.data.trip.itinerary_status,
    startDate: bundle.data.trip.start_date,
    endDate: bundle.data.trip.end_date,
    metadata: bundle.data.trip.metadata
  });
  const tripCompleted = tripLifecycle === "completed";
  if (!locked || (!companionUnlocked && !access.hasQaAccess)) redirect(`/trip/${id}`);
  if (access.hasQaAccess && locked && !companionUnlocked) {
    await unlockLiveCompanion(supabase, id, "admin");
  }

  if (!tripCompleted) await scheduleCompanionEvents(supabase, id);
  const destinationLabel = getTripDestinationLabel(bundle.data.trip) || "your trip";
  const localizedFull = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: bundle.data.trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const daysCount = getTripDaysCount(bundle.data.trip);
  const budgetCurrency = getTripBudgetCurrency(bundle.data.trip);
  const currentDay = getTripDayFromDate(bundle.data.trip.start_date, daysCount || null, timezoneFromTripMetadata(bundle.data.trip.metadata));
  const [companion, bookingsResult, trackingActivitiesResult, trackingDaysResult, preferences, locationSettingsResult] = await Promise.all([
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
      .select("last_permission_state,location_tracking_enabled")
      .eq("user_id", current.user.id)
      .maybeSingle()
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
  const nextActivity =
    dayActivities.find((activity) => !["completed", "skipped", "missed"].includes(activity.status)) ||
    dayActivities[0] ||
    null;
  const nearbyActivity = dayActivities.find((activity) => activity.status === "nearby") || null;

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
  const tripCountdown = daysUntil(bundle.data.trip.start_date);
  const bookingRows = ((bookingsResult.data || []) as Record<string, unknown>[]);
  const locationRow = getRecord(locationSettingsResult.data);
  const permissionState = (getRowString(locationRow || {}, "last_permission_state") || "prompt") as LiveLocationPermission;
  const tripTimezone = timezoneFromTripMetadata(bundle.data.trip.metadata);
  const tripUpcoming = tripLifecycle === "upcoming";
  const tripDatesMissing = tripLifecycle === "missing_dates";
  const companionPageStatus = tripCompleted ? "Completed" : tripUpcoming ? "Upcoming" : tripDatesMissing ? "Dates needed" : "Live";
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
      <div className="safe-bottom mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
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
          simulatorPlaces={simulatorPlaces}
          tripStartDate={bundle.data.trip.start_date}
          tripEndDate={bundle.data.trip.end_date}
          timezone={tripTimezone}
          companionEnabled={preferences.liveCompanionEnabled}
          companionPausedUntil={preferences.liveCompanionPausedUntil}
          backgroundLocationEnabled={preferences.backgroundLocationEnabled}
          initialPermissionState={permissionState}
          bookingDetails={bookingDetails}
          liveDemoEnabled={false}
          fieldTestMode
        />
      </div>
    );
  }

  if (!fieldTestMode) {
    return (
      <div className="safe-bottom mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
        <TripContextNav
          tripId={id}
          title={bundle.data.trip.title || destinationLabel}
          destination={destinationLabel}
          dates={bundle.data.trip.start_date && bundle.data.trip.end_date ? `${formatRoamlyDate(bundle.data.trip.start_date, locale, { month: "short", day: "numeric" })} - ${formatRoamlyDate(bundle.data.trip.end_date, locale, { month: "short", day: "numeric" })}` : "Dates flexible"}
          status={companionPageStatus}
        />
        <section className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lagoon">{tripCompleted ? "Trip complete" : tripUpcoming ? "Coming up" : tripDatesMissing ? "Add trip dates" : "Active assistance"}</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-ink sm:text-5xl">{tripCompleted ? `Your trip in ${destinationLabel} is complete` : tripUpcoming ? `Get ready for ${destinationLabel}` : tripDatesMissing ? `Set dates for ${destinationLabel}` : `Live in ${destinationLabel}`}</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">{tripCompleted ? "Your itinerary, saved bookings, and trip details are still available here." : tripUpcoming ? "Your companion is ready. Live assistance begins during your trip dates." : tripDatesMissing ? "Add travel dates to get accurate live timing and trip reminders." : "Today is your plan. Live helps with the next step while you are moving."}</p>
          </div>
          <Button href={`/trip/${id}#day-by-day`} tone="secondary" className="hidden shrink-0 sm:inline-flex">View plan</Button>
        </section>
        <LiveTripClient
          tripId={id}
          activities={dayActivities}
          checklist={bundle.data.checklist}
          canSimulateLocation={false}
          destinationLabel={destinationLabel}
          simulatorPlaces={simulatorPlaces}
          tripStartDate={bundle.data.trip.start_date}
          tripEndDate={bundle.data.trip.end_date}
          timezone={tripTimezone}
          companionEnabled={preferences.liveCompanionEnabled}
          companionPausedUntil={preferences.liveCompanionPausedUntil}
          backgroundLocationEnabled={preferences.backgroundLocationEnabled}
          initialPermissionState={permissionState}
          bookingDetails={bookingDetails}
          liveDemoEnabled={false}
        />
      </div>
    );
  }

  return (
    <div className="safe-bottom mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <TripContextNav
        tripId={id}
        title={bundle.data.trip.title || destinationLabel}
        destination={destinationLabel}
        dates={bundle.data.trip.start_date && bundle.data.trip.end_date ? `${formatRoamlyDate(bundle.data.trip.start_date, locale, { month: "short", day: "numeric" })} - ${formatRoamlyDate(bundle.data.trip.end_date, locale, { month: "short", day: "numeric" })}` : "Dates flexible"}
        status="Today"
      />
      <section className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Live Trip Companion</Badge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Today in {destinationLabel}</h1>
          <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
            Day {currentDay}. Roamly can remind you about packing, documents, check-in times, and what&apos;s up next during your trip.
          </p>
        </div>
        <Button href={`/trip/${id}`} tone="secondary">Full itinerary</Button>
      </section>

      <section className="mb-6 grid gap-4 border-y border-[#e8dfd0] bg-[#fffdf8]/70 py-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-[#e8dfd0]">
        <div className="sm:px-5 sm:first:pl-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Trip activated</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{countdownCopy(tripCountdown, currentDay)}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">Current day: Day {currentDay}</p>
        </div>
        <div className="sm:px-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Up next activity</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{tripCompleted ? "Historical itinerary" : nextActivity?.title || "Flexible time"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {tripCompleted ? "Live actions are unavailable after trip completion." : nextActivity?.time_label || nearbyActivity?.title || "Roamly will surface the next useful stop."}
          </p>
        </div>
        <div className="sm:px-5 sm:last:pr-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Budget remaining</p>
          <h2 className="mt-2 text-2xl font-black text-ink">
            {tripCompleted ? "History retained" : committedBudgetUncertain ? "Budget uncertain" : formatMoney(remainingBudgetCents, budgetCurrency, locale)}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                  {tripCompleted ? "Confirmed bookings and itinerary details remain available." : `Booked items: ${committedBudgetCents == null ? "Amount unavailable" : formatMoney(committedBudgetCents, budgetCurrency, locale)}`}
          </p>
        </div>
      </section>

      <section className="mb-6 grid gap-5 border-b border-[#e8dfd0] pb-5 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Next reminder</p>
          <h2 className="mt-2 text-2xl font-black text-ink">
            {tripCompleted ? "No active reminder" : companion.nextEvent?.title || "No scheduled reminder yet"}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {tripCompleted ? "Historical companion events remain available below." : companion.nextEvent?.body || "Roamly will keep your in-app timeline ready. Phone reminders are optional."}
          </p>
        </div>
        <details className="border-l-2 border-ocean/30 bg-mist/45 px-4 py-3">
          <summary className="min-h-11 cursor-pointer text-sm font-black text-ocean">Phone alerts</summary>
          <div className="mt-2">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Phone alerts</p>
          <h2 className="mt-2 text-xl font-black text-ink">Live Companion setup</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">Complete the one-time mobile setup in the Live Companion panel. Phone push is the primary alert channel.</p>
          </div>
        </details>
      </section>

      {!tripCompleted ? (
        <section className="mb-5">
          <CompanionControlCard tripId={id} />
        </section>
      ) : null}

      {!tripCompleted ? <section
        id="companion-repairs"
        className="mb-5"
      >
        <CompanionRepairCenter tripId={id} />
      </section> : null}

      <section className="mb-5">
        <CompanionEventTimeline tripId={id} />
      </section>

      <section className="mb-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Companion timeline</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(companion.timeline || []).slice(0, 8).map((event) => (
              <article key={event.id} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{event.title || event.event_type}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                  {[event.status, event.scheduled_for ? formatRoamlyDate(event.scheduled_for, locale, { dateStyle: "medium", timeStyle: "short" }) : null]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              </article>
            ))}
            {!companion.timeline?.length ? (
              <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
                No scheduled companion events yet.
              </p>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Country/city info</p>
          <h2 className="mt-2 text-xl font-black text-ink">{countryInfo.title || "Travel notes"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {countryInfo.summary ||
              "Document requirements can change. Please verify official government, embassy, airline, and destination sources before travel."}
          </p>
          <div className="mt-3 grid gap-2">
            {(countryInfo.reminders || []).slice(0, 3).map((item) => (
              <p key={item} className="rounded-2xl bg-mist px-3 py-2 text-xs font-black text-slate-600">{item}</p>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Packing checklist</p>
          <div className="mt-3 grid gap-2">
            {packingItems.slice(0, 6).map((item) => (
              <p key={item} className="rounded-2xl bg-mist px-3 py-2 text-xs font-black text-slate-600">{item}</p>
            ))}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Documents</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Document requirements can change. Please verify official sources before travel.
          </p>
          <div className="mt-3 grid gap-2">
            {documents.slice(0, 6).map((item) => (
              <p key={item} className="rounded-2xl bg-mist px-3 py-2 text-xs font-black text-slate-600">{item}</p>
            ))}
          </div>
        </Card>
      </section>

      <section className="mb-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Booked items timeline</p>
          <div className="mt-4">
            <TripBookingsList tripId={id} bookings={bookingsResult.data || []} />
          </div>
        </Card>
      </section>

      {tripCompleted ? (
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Trip complete</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Live Companion is closed for this trip</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">This historical trip remains viewable, but NOW, NEXT, check-in, skip, starting-soon, and live Maps actions are unavailable.</p>
        </Card>
      ) : (
        <LiveTripClient
          tripId={id}
          activities={dayActivities}
          checklist={bundle.data.checklist}
          canSimulateLocation={false}
          destinationLabel={destinationLabel}
          simulatorPlaces={simulatorPlaces}
          tripStartDate={bundle.data.trip.start_date}
          tripEndDate={bundle.data.trip.end_date}
          timezone={tripTimezone}
          companionEnabled={preferences.liveCompanionEnabled}
          companionPausedUntil={preferences.liveCompanionPausedUntil}
          backgroundLocationEnabled={preferences.backgroundLocationEnabled}
          initialPermissionState={permissionState}
          bookingDetails={bookingDetails}
          liveDemoEnabled={false}
        />
      )}
    </div>
  );
}
