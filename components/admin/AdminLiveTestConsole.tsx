"use client";

import { useEffect, useMemo, useState } from "react";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { NotificationPermissionCard } from "@/components/roamly/NotificationPermissionCard";
import { QRCodeSVG } from "qrcode.react";

type Trip = {
  id: string;
  user_id?: string | null;
  title: string | null;
  destination?: string | null;
  destination_name?: string | null;
  start_date: string | null;
  itinerary_status: string | null;
  tracking_unlocked?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

type Activity = {
  id: string;
  trip_id: string;
  title: string;
  category: string | null;
  address: string | null;
  scheduled_start: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
};

type Booking = {
  id: string;
  trip_id: string;
  title: string | null;
  booking_type: string;
  address: string | null;
  start_date: string | null;
  start_time: string | null;
  latitude: number | null;
  longitude: number | null;
};

type PushSubscription = {
  id: string;
  user_id: string | null;
  enabled: boolean | null;
  user_agent: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type NotificationRow = {
  id: string;
  user_id: string | null;
  trip_id: string | null;
  title: string | null;
  push_status: string | null;
  push_error: string | null;
  sent_at: string | null;
  created_at: string | null;
};

const actions = [
  ["simulate_one_week_before", "Simulate 1 week before trip"],
  ["simulate_one_day_before", "Simulate 1 day before trip"],
  ["simulate_countdown_24h", "Simulate 24-hour countdown"],
  ["simulate_travel_day_started", "Simulate travel day started"],
  ["simulate_near_first_activity", "Simulate location near first activity"],
  ["simulate_near_next_activity", "Simulate location near next activity"],
  ["simulate_near_hotel", "Simulate location near hotel/check-in"],
  ["simulate_far_away", "Simulate far away location"],
  ["send_test_in_app_notification", "Send test in-app notification"],
  ["send_test_push_notification", "Send test push notification"],
  ["simulate_check_in", "Simulate check-in to nearby activity"],
  ["simulate_skip", "Simulate skip nearby activity"],
  ["simulate_complete", "Simulate complete checked-in activity"],
  ["debug_report", "Refresh server debug report"]
];

function companionStatus(trip: Trip) {
  const companion = trip.metadata?.companion;
  if (companion && typeof companion === "object" && !Array.isArray(companion)) {
    const status = (companion as Record<string, unknown>).status;
    if (typeof status === "string" && status.trim()) return status;
  }
  return "Not set";
}

function ResultPill({ label, value }: { label: string; value: unknown }) {
  const positive = value === true || value === "sent" || (typeof value === "number" && value > 0);
  return (
    <div className={`rounded-2xl px-4 py-3 ${positive ? "bg-ocean/10 text-ocean" : "bg-mist text-slate-600"}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-sm font-black">{String(value ?? "None")}</p>
    </div>
  );
}

export function AdminLiveTestConsole({
  trips,
  activities,
  bookings,
  pushSubscriptions,
  notifications
}: {
  trips: Trip[];
  activities: Activity[];
  bookings: Booking[];
  pushSubscriptions: PushSubscription[];
  notifications: NotificationRow[];
}) {
  const [tripId, setTripId] = useState(trips[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [browserPermission, setBrowserPermission] = useState("unknown");

  const selectedTrip = trips.find((trip) => trip.id === tripId) || null;
  const tripActivities = useMemo(() => activities.filter((activity) => activity.trip_id === tripId), [activities, tripId]);
  const tripBookings = useMemo(() => bookings.filter((booking) => booking.trip_id === tripId), [bookings, tripId]);
  const activePushSubscriptions = useMemo(
    () =>
      pushSubscriptions.filter(
        (subscription) => subscription.user_id === selectedTrip?.user_id && subscription.enabled !== false
      ),
    [pushSubscriptions, selectedTrip?.user_id]
  );
  const latestPushResult = useMemo(
    () =>
      notifications.find(
        (notification) =>
          notification.trip_id === tripId && (Boolean(notification.push_status) || Boolean(notification.push_error))
      ) || null,
    [notifications, tripId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setBrowserPermission("unsupported");
      return;
    }
    setBrowserPermission(Notification.permission);
  }, []);

  async function createQaTrip() {
    setBusy("seed_qa_trip");
    setError("");
    setResult(null);

    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/seed-demo", {
        method: "POST",
        credentials: "include"
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Could not create the controlled QA trip.");
      }

      setResult({
        ok: true,
        test: "qa_trip_created",
        message: "Controlled Live Companion QA trip created. Refreshing..."
      });

      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create the controlled QA trip."
      );
      setBusy("");
    }
  }

  async function createSaintJohnFieldTest() {
    setBusy("seed_field_test");
    setError("");
    setResult(null);

    try {
      const response = await fetchWithSupabaseAuth(
        "/api/admin/roamly/seed-field-test",
        {
          method: "POST",
          credentials: "include"
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Could not create Saint John field test.");
      }

      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create Saint John field test."
      );
      setBusy("");
    }
  }

  async function run(action: string) {
    setBusy(action);
    setError("");
    setResult(null);
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/live-test", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, action })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Live test failed.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live test failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <label className="block">
          <span className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Select recent trip</span>
          <select
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink outline-none focus:border-ocean"
          >
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {(trip.title || getTripDestinationLabel(trip) || "Trip").slice(0, 80)}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={createQaTrip}
            disabled={Boolean(busy)}
            className="rounded-2xl border border-ocean/30 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            {busy === "seed_qa_trip"
              ? "Creating QA trip..."
              : "Create / Reset Live Companion QA Trip"}
          </button>

          <button
            type="button"
            onClick={createSaintJohnFieldTest}
            disabled={Boolean(busy)}
            className="ml-2 rounded-2xl border border-ocean/30 bg-white px-4 py-3 text-sm font-black text-ocean transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            {busy === "seed_field_test"
              ? "Creating Saint John test..."
              : "Create Saint John Field Test"}
          </button>

          <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
            Creates a protected admin-only trip with scheduled activities for the
            Production Live Companion lifecycle test. It does not modify customer trips.
          </p>
        </div>

        {selectedTrip ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ResultPill label="Companion unlocked" value={Boolean(selectedTrip.tracking_unlocked)} />
            <ResultPill label="Companion status" value={companionStatus(selectedTrip)} />
            <ResultPill label="Itinerary status" value={selectedTrip.itinerary_status || "Not set"} />
            <ResultPill label="Start date" value={selectedTrip.start_date || "No date"} />
            <ResultPill label="Push subscriptions" value={activePushSubscriptions.length} />
            <ResultPill label="This browser permission" value={browserPermission} />
            <ResultPill label="Last push status" value={latestPushResult?.push_status || "none"} />
            <ResultPill label="Last push error" value={latestPushResult?.push_error || "none"} />
          </div>
        ) : null}
        {selectedTrip && !activePushSubscriptions.length ? (
          <p className="mt-4 rounded-2xl bg-sun/15 px-4 py-3 text-sm font-black leading-6 text-amber-900">
            No push subscription found. Open Roamly on your phone, enable reminders, then run this test again.
          </p>
        ) : null}
      </section>

      <section>
        {selectedTrip?.metadata?.field_test === true ? (
          <section className="mb-5 rounded-[1.75rem] border-2 border-ocean/30 bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
                  Real Saint John Field Test
                </p>
                <h3 className="mt-1 text-xl font-black text-slate-900">
                  3-stop Live Companion test
                </h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  Real GPS · Saint John local time · No simulated location
                </p>
              </div>

              <span className="rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean">
                America/Moncton
              </span>
            </div>

            <div className="mt-5 rounded-2xl border border-ocean/20 bg-ocean/5 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-ocean">
                Phone field test
              </p>

              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                Open the real Live Companion on your phone. Your phone provides the
                GPS and receives the notifications; this admin page only monitors the test.
              </p>

              {typeof window !== "undefined" && tripId ? (
                <div className="mt-4 flex justify-center rounded-2xl bg-white p-4">
                  <QRCodeSVG
                    value={`${(process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "")}/trip/${tripId}/live?fieldTest=1`}
                    size={180}
                    level="M"
                  />
                </div>
              ) : null}

              <p className="mt-2 text-center text-xs font-bold text-slate-500">
                Scan with your phone camera
              </p>

              <a
                href={`/trip/${tripId}/live?fieldTest=1`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block w-full rounded-2xl bg-ink px-5 py-3 text-center text-sm font-black text-white"
              >
                Open Field Test on Phone
              </a>

              <p className="mt-2 text-xs font-bold text-slate-500">
                On your phone, use this same Roamly address and trip. Do not use simulated location.
              </p>
            </div>

            <div className="mt-5 grid gap-3">
              {tripActivities
                .slice()
                .sort(
                  (a, b) =>
                    new Date(a.scheduled_start || 0).getTime() -
                    new Date(b.scheduled_start || 0).getTime()
                )
                .map((activity, index) => (
                  <div
                    key={activity.id}
                    className="rounded-2xl border border-slate-200 bg-mist/40 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ocean text-sm font-black text-white">
                        {index + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-black text-slate-900">
                            {activity.title}
                          </p>

                          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">
                            {activity.status}
                          </span>
                        </div>

                        <p className="mt-1 text-sm font-bold text-slate-500">
                          {activity.address || "No address"}
                        </p>

                        <p className="mt-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          {activity.scheduled_start
                            ? new Intl.DateTimeFormat("en-CA", {
                                timeZone: "America/Moncton",
                                hour: "numeric",
                                minute: "2-digit"
                              }).format(new Date(activity.scheduled_start))
                            : "No scheduled time"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>

            <p className="mt-4 rounded-2xl bg-sun/15 px-4 py-3 text-sm font-bold leading-6 text-amber-900">
              Field mode must use your actual browser location. Walk or drive normally;
              Roamly should detect approaching, arrival, check-in/skip and progression
              without simulated GPS.
            </p>
          </section>
        ) : null}

        <NotificationPermissionCard qaTripId={tripId || undefined} />
        <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
          This is Roamly&apos;s real notification registration. Enable reminders
          on this device before running the Production Live Companion Test.
        </p>
      </section>

      <section className="rounded-[1.75rem] border-2 border-ocean/30 bg-white p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
          Production acceptance test
        </p>
        <h2 className="mt-2 text-xl font-black text-ink">
          Live Companion
        </h2>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          Runs the controlled QA trip through the actual Live Companion production path:
          detection, real push evidence, duplicate suppression, expiry, retirement and
          automatic advance to the next activity.
        </p>

        <button
          type="button"
          onClick={() => run("production_lifecycle")}
          disabled={!tripId || Boolean(busy)}
          className="mt-5 w-full rounded-2xl bg-ink px-5 py-4 text-center text-sm font-black uppercase tracking-[0.08em] text-white shadow-soft transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {busy === "production_lifecycle"
            ? "Running production test..."
            : "Run Production Live Companion Test"}
        </button>

        <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
          This acceptance test is restricted to the controlled admin QA trip.
          The buttons below are diagnostics and do not certify Live Companion.
        </p>
      </section>

      <section>
        <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          Individual diagnostics
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map(([action, label]) => (
          <button
            key={action}
            type="button"
            onClick={() => run(action)}
            disabled={!tripId || Boolean(busy)}
            className="rounded-[1.25rem] border border-cloud bg-white/90 px-4 py-3 text-left text-sm font-black text-ink shadow-soft transition hover:-translate-y-0.5 hover:border-ocean/40 disabled:opacity-60"
          >
            {busy === action ? "Running..." : label}
          </button>
        ))}
        </div>
      </section>

      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      {result ? (
        <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          {result.test === "production_live_companion_lifecycle" ? (
            <div className="mb-5">
              <div
                className={`rounded-[1.5rem] border-2 p-5 ${
                  result.passed === true
                    ? "border-ocean/40 bg-ocean/10"
                    : "border-coral/40 bg-coral/10"
                }`}
              >
                <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">
                  Production Live Companion
                </p>
                <p className="mt-2 text-3xl font-black text-ink">
                  {result.passed === true ? "PASS" : "FAIL"}
                </p>
                <p className="mt-2 text-sm font-bold text-slate-600">
                  {result.passed === true
                    ? "The controlled lifecycle passed every required production-path check."
                    : "Live Companion did not pass every required production-path check. Review the failed stage below."}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ResultPill
                  label="Activity A detected"
                  value={(result.stages as Record<string, unknown> | undefined)?.activityADetected}
                />
                <ResultPill
                  label="Real push"
                  value={(result.stages as Record<string, unknown> | undefined)?.realPushEvidence}
                />
                <ResultPill
                  label="Duplicate suppressed"
                  value={(result.stages as Record<string, unknown> | undefined)?.duplicateSuppressed}
                />
                <ResultPill
                  label="A expired by production"
                  value={(result.stages as Record<string, unknown> | undefined)?.productionExpiredActivityA}
                />
                <ResultPill
                  label="A stayed retired"
                  value={(result.stages as Record<string, unknown> | undefined)?.activityAStayedRetired}
                />
                <ResultPill
                  label="Advanced to Activity B"
                  value={(result.stages as Record<string, unknown> | undefined)?.productionAdvancedToActivityB}
                />
              </div>
            </div>
          ) : null}

          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Latest result</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ResultPill label="Trip activated" value={result.tripActivated} />
            <ResultPill label="Nearby detected" value={Array.isArray(result.nearbyActivities) ? result.nearbyActivities.length : 0} />
            <ResultPill label="Notification created" value={result.notificationCreated} />
            <ResultPill label="Push status" value={result.pushStatus || "not_attempted"} />
            <ResultPill label="Checked in" value={result.activityCheckedIn} />
            <ResultPill label="Skipped" value={result.activitySkipped} />
            <ResultPill label="Completed" value={result.activityCompleted} />
            <ResultPill label="Distance meters" value={result.distanceMeters} />
          </div>
          {typeof result.message === "string" ? (
            <p className="mt-4 rounded-2xl bg-sun/10 px-4 py-3 text-sm font-black text-amber-800">{result.message}</p>
          ) : null}
          <pre className="mt-4 max-h-96 overflow-auto rounded-2xl bg-ink p-4 text-xs font-bold leading-5 text-white/80">
            {JSON.stringify(result.debug || result, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Activities</p>
          <div className="mt-4 grid gap-2">
            {tripActivities.map((activity) => (
              <div key={activity.id} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{activity.title}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {[activity.status, activity.category, activity.scheduled_start, activity.latitude && activity.longitude ? "has coordinates" : "no coordinates"]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              </div>
            ))}
            {!tripActivities.length ? <p className="text-sm font-black text-slate-500">No activities found.</p> : null}
          </div>
        </div>
        <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Bookings</p>
          <div className="mt-4 grid gap-2">
            {tripBookings.map((booking) => (
              <div key={booking.id} className="rounded-2xl bg-mist px-4 py-3">
                <p className="text-sm font-black text-ink">{booking.title || "Booking"}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {[booking.booking_type, booking.start_date, booking.start_time, booking.latitude && booking.longitude ? "has coordinates" : "no coordinates"]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              </div>
            ))}
            {!tripBookings.length ? <p className="text-sm font-black text-slate-500">No bookings found.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
