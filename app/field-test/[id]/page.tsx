import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { LiveTripClient } from "@/components/trip/LiveTripClient";
import { FIELD_TEST_INVALID_MESSAGE, getFieldTestSession } from "@/lib/roamly/fieldTestAccess";
import { getTripBundle, groupActivitiesByDay } from "@/lib/trips";
import { getTripDayFromDate } from "@/lib/itinerary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTripDaysCount, getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { timezoneFromTripMetadata } from "@/lib/roamly/liveCompanion";
import { getCompanionPreferences } from "@/lib/roamly/companionPreferences";

export default async function AdminFieldTestEntry({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const capability = typeof search.capability === "string" ? search.capability : null;
  if (capability) redirect(`/api/field-test/exchange?tripId=${encodeURIComponent(id)}&capability=${encodeURIComponent(capability)}`);

  const session = await getFieldTestSession(id);
  if (!session) {
    return <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-2xl items-center px-4 py-8"><Card><h1 className="text-3xl font-black text-ink">Field test unavailable</h1><p className="mt-3 text-base font-bold leading-7 text-slate-600">{FIELD_TEST_INVALID_MESSAGE}</p></Card></main>;
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return <main className="p-8">{FIELD_TEST_INVALID_MESSAGE}</main>;
  const bundle = await getTripBundle(admin, session.userId, id);
  if (!bundle.data || bundle.data.trip.metadata?.field_test !== true) return <main className="p-8">{FIELD_TEST_INVALID_MESSAGE}</main>;

  const [{ data: locationSettings }, preferences] = await Promise.all([
    admin
      .from("roamly_location_settings")
      .select("last_permission_state,last_seen_latitude,last_seen_longitude,location_tracking_enabled")
      .eq("user_id", session.userId)
      .maybeSingle(),
    getCompanionPreferences({ supabase: admin, userId: session.userId, tripId: id })
  ]);

  const destinationLabel = getTripDestinationLabel(bundle.data.trip) || "Saint John";
  const currentDay = getTripDayFromDate(bundle.data.trip.start_date, getTripDaysCount(bundle.data.trip) || null);
  const activities = groupActivitiesByDay(bundle.data.activities)[currentDay] || bundle.data.activities;
  const initialPermissionState = (locationSettings?.last_permission_state || "prompt") as "prompt" | "granted" | "denied" | "unavailable";
  const initialLocation = typeof locationSettings?.last_seen_latitude === "number" && typeof locationSettings?.last_seen_longitude === "number"
    ? { latitude: locationSettings.last_seen_latitude, longitude: locationSettings.last_seen_longitude }
    : null;
  return (
    <main className="safe-bottom mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <section className="sticky top-2 z-10 mb-5 rounded-2xl border-2 border-coral/40 bg-ink px-4 py-3 text-white shadow-soft"><p className="text-xs font-black uppercase tracking-[0.18em] text-sun">LIVE COMPANION FIELD TEST</p><p className="mt-1 text-sm font-black text-white/85">Desktop: prepare and monitor. Phone: run the real Live Companion.</p></section>
      <section className="mb-5 rounded-[1.75rem] border-2 border-ocean/30 bg-white p-6 shadow-soft"><h1 className="text-4xl font-black tracking-tight text-ink">LIVE COMPANION FIELD TEST</h1><p className="mt-2 text-2xl font-black text-ocean">{destinationLabel}</p><p className="mt-3 text-sm font-bold leading-6 text-slate-600">Install Roamly, allow notifications and location, then run the real Live Companion on this phone.</p></section>
    <LiveTripClient tripId={id} activities={activities} checklist={bundle.data.checklist} canSimulateLocation={false} destinationLabel={destinationLabel} simulatorPlaces={[]} tripStartDate={bundle.data.trip.start_date} tripEndDate={bundle.data.trip.end_date} timezone={timezoneFromTripMetadata(bundle.data.trip.metadata)} companionEnabled={preferences.liveCompanionEnabled} companionPausedUntil={preferences.liveCompanionPausedUntil} backgroundLocationEnabled={preferences.backgroundLocationEnabled} initialPermissionState={initialPermissionState} initialLocation={initialLocation} liveDemoEnabled={false} fieldTestMode />
    </main>
  );
}
