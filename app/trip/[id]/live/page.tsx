import { redirect } from "next/navigation";
import { NotificationPermissionCard } from "@/components/roamly/NotificationPermissionCard";
import { TripBookingsList } from "@/components/roamly/TripBookingsManager";
import { LiveTripClient, type LiveSimulatorPlace } from "@/components/trip/LiveTripClient";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { getTripDayFromDate, type RoamlyItinerary } from "@/lib/itinerary";
import { getServerLocale } from "@/lib/i18n-server";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { buildLiveCompanionSummary, scheduleCompanionEvents, unlockLiveCompanion } from "@/lib/roamly/tripCompanion";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDaysCount,
  getTripDestinationLabel
} from "@/lib/roamly/tripMetadata";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, groupActivitiesByDay, type ActivityRecord } from "@/lib/trips";
import { CompanionControlCard } from "@/components/roamly/CompanionControlCard";

function formatMoney(cents: number | null, currency = "CAD") {
  if (cents == null) return "Not set";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: (currency || "CAD").toUpperCase(),
    maximumFractionDigits: 0
  }).format(cents / 100);
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

function localizeActivityRecords(activities: ActivityRecord[], itinerary: RoamlyItinerary | null) {
  if (!itinerary) return activities;
  const localizedByDay = new Map(itinerary.daily_itinerary.map((day) => [day.day_number, day.live_timeline]));
  const seenByDay = new Map<number, number>();

  return activities.map((activity) => {
    const index = seenByDay.get(activity.day_number) || 0;
    seenByDay.set(activity.day_number, index + 1);
    const localized = localizedByDay.get(activity.day_number)?.[index];
    if (!localized) return activity;
    return {
      ...activity,
      title: localized.title || activity.title,
      description: localized.description || activity.description,
      location_name: localized.location_name || activity.location_name,
      estimated_cost: localized.estimated_cost ?? activity.estimated_cost,
      category: localized.category || activity.category,
      map_query: localized.map_query || activity.map_query
    };
  });
}

export default async function LiveTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getServerLocale();
  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/live`)}`);
  }

  if (!current.configured || !current.user) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink">Connect Supabase to use Live Trip Companion.</h1>
        </Card>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");
  const access = getRoamlyAccessForUser(current.user.email);
  const bundle = await getTripBundle(supabase, current.user.id, id);

  if (!bundle.data) redirect("/dashboard?tripAccess=denied");
  const locked = isTripLocked(bundle.data.trip);
  const companionUnlocked = tripHasTrackingUnlock(bundle.data.trip);
  if (!locked || (!companionUnlocked && !access.hasQaAccess)) redirect(`/trip/${id}`);
  if (access.hasQaAccess && locked && !companionUnlocked) {
    await unlockLiveCompanion(supabase, id, "admin");
  }

  await scheduleCompanionEvents(supabase, id);
  const destinationLabel = getTripDestinationLabel(bundle.data.trip) || "your trip";
  const localizedFull = bundle.data.itinerary?.full_json
    ? getLocalizedItinerary({ metadata: bundle.data.trip.metadata, baseItinerary: bundle.data.itinerary.full_json, locale }).itinerary
    : null;
  const localizedActivities = localizeActivityRecords(bundle.data.activities, localizedFull);
  const daysCount = getTripDaysCount(bundle.data.trip);
  const budgetCurrency = getTripBudgetCurrency(bundle.data.trip);
  const currentDay = getTripDayFromDate(bundle.data.trip.start_date, daysCount || null);
  const activitiesByDay = groupActivitiesByDay(localizedActivities);
  const dayActivities = activitiesByDay[currentDay] || bundle.data.activities.slice(0, 4);
  const nextActivity =
    dayActivities.find((activity) => !["completed", "skipped", "missed"].includes(activity.status)) ||
    dayActivities[0] ||
    null;
  const nearbyActivity = dayActivities.find((activity) => activity.status === "nearby") || null;
  const [companion, bookingsResult, trackingActivitiesResult] = await Promise.all([
    buildLiveCompanionSummary(supabase, current.user.id, id),
    supabase
      .from("roamly_bookings")
      .select("*")
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .order("start_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("roamly_activities")
      .select("id,title,category,address,city,country,latitude,longitude,status,sort_order")
      .eq("trip_id", id)
      .order("sort_order", { ascending: true })
  ]);

  const companionMetadata = getRecord(getRecord(companion.trip?.metadata)?.companion) || {};
  const countryInfo = (getRecord(companionMetadata.travelCountryInfo) || {}) as {
    title?: string;
    summary?: string;
    reminders?: string[];
  };
  const packing = getStringArray(companionMetadata.packingChecklist);
  const documents = getStringArray(companionMetadata.documentChecklist);
  const packingItems = packing.length ? packing : localizedFull?.packing_checklist || bundle.data.checklist.map((item) => item.item);
  const committedBudgetCents = (bookingsResult.data || []).reduce(
    (sum, booking) => sum + (booking.booking_status === "cancelled" ? 0 : Number(booking.amount_cents || 0)),
    0
  );
  const budgetAmount = getTripBudgetAmount(bundle.data.trip);
  const totalBudgetCents = budgetAmount == null ? null : Math.round(budgetAmount * 100);
  const remainingBudgetCents = totalBudgetCents == null ? null : totalBudgetCents - committedBudgetCents;
  const tripCountdown = daysUntil(bundle.data.trip.start_date);
  const trackingActivityRows = ((trackingActivitiesResult.data || []) as Record<string, unknown>[]);
  const bookingRows = ((bookingsResult.data || []) as Record<string, unknown>[]);
  const simulatorPlaces: LiveSimulatorPlace[] = [
    ...localizedActivities.map((activity, index) => ({
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
        status: getRowString(booking, "start_date")
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

  return (
    <main className="safe-bottom mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
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

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Trip activated</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{countdownCopy(tripCountdown, currentDay)}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">Current day: Day {currentDay}</p>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Up next activity</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{nextActivity?.title || "Flexible time"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {nextActivity?.time_label || nearbyActivity?.title || "Roamly will surface the next useful stop."}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Budget remaining</p>
          <h2 className="mt-2 text-2xl font-black text-ink">
            {formatMoney(remainingBudgetCents, budgetCurrency)}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Booked items: {formatMoney(committedBudgetCents, budgetCurrency)}
          </p>
        </Card>
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Next reminder</p>
          <h2 className="mt-2 text-2xl font-black text-ink">
            {companion.nextEvent?.title || "No scheduled reminder yet"}
          </h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {companion.nextEvent?.body || "Roamly will keep your in-app timeline ready. Phone reminders are optional."}
          </p>
        </Card>
        <NotificationPermissionCard />
      </section>

      <section className="mb-5">
        <CompanionControlCard tripId={id} />
      </section>

      <section className="mb-5">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Companion timeline</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(companion.timeline || []).slice(0, 8).map((event) => (
              <article key={event.id} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{event.title || event.event_type}</p>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                  {[event.status, event.scheduled_for ? new Date(event.scheduled_for).toLocaleString("en-CA") : null]
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

      <LiveTripClient
        tripId={id}
        activities={dayActivities}
        checklist={bundle.data.checklist}
        canSimulateLocation={access.hasQaAccess}
        destinationLabel={destinationLabel}
        simulatorPlaces={simulatorPlaces}
      />
    </main>
  );
}
