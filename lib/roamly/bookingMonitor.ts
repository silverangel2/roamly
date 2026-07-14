import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  syncGmailConnection,
  syncOutlookConnection
} from "@/lib/roamly/emailConnections";
import {
  airportGateAdapter,
  liveFlightStatusAdapter,
  recordLiveProviderSnapshot,
  type LiveProviderResult,
  type NormalizedLiveFlightStatus
} from "@/lib/roamly/liveProviderAdapters";
import { processCompanionBookingChange } from "@/lib/roamly/companionOrchestrator";

type ConnectionRow = {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  last_synced_at: string | null;
};

type FlightBookingRow = {
  id: string;
  user_id: string;
  trip_id: string;
  title: string | null;
  flight_number: string;
  booking_status: string;
  start_at: string | null;
  end_at: string | null;
  origin: string | null;
  destination: string | null;
  gate: string | null;
  terminal: string | null;
  updated_at: string | null;
};

type FlightMonitorResult = {
  bookingId: string;
  flightNumber: string;
  providerStatus: string;
  gateProviderStatus: string;
  changed: boolean;
  changeType: string | null;
  error: string | null;
};

const LOCK_NAME = "roamly-booking-monitor";
const LOCK_MINUTES = 12;
const SYNC_INTERVAL_MINUTES = 10;
const MAX_CONNECTIONS_PER_RUN = 25;
const MAX_FLIGHTS_PER_RUN = 40;
const FLIGHT_LOOKAHEAD_HOURS = 72;
const FLIGHT_LOOKBACK_HOURS = 8;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function validTimestamp(value: unknown) {
  const text = cleanText(value);

  if (!text) return null;

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString();
}

function minuteDifference(
  first: string | null,
  second: string | null
) {
  if (!first || !second) return null;

  return Math.round(
    (
      new Date(second).getTime() -
      new Date(first).getTime()
    ) / 60000
  );
}

function normalizedResult(
  result: LiveProviderResult<unknown>
): NormalizedLiveFlightStatus | null {
  if (
    result.status !== "available" ||
    !result.normalized_result ||
    typeof result.normalized_result !== "object"
  ) {
    return null;
  }

  return result.normalized_result as NormalizedLiveFlightStatus;
}

function flightDepartureDate(startAt: string | null) {
  if (!startAt) return null;
  return startAt.slice(0, 10);
}

async function acquireMonitorLock() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      ok: false as const,
      acquired: false,
      error: "Supabase service role is not configured."
    };
  }

  const now = new Date();
  const lockOwner = randomUUID();
  const lockedUntil = new Date(
    now.getTime() + LOCK_MINUTES * 60_000
  ).toISOString();

  await admin
    .from("roamly_cron_locks")
    .upsert(
      {
        lock_name: LOCK_NAME,
        locked_until: new Date(0).toISOString(),
        locked_by: null,
        updated_at: now.toISOString()
      },
      {
        onConflict: "lock_name",
        ignoreDuplicates: true
      }
    );

  const result = await admin
    .from("roamly_cron_locks")
    .update({
      locked_until: lockedUntil,
      locked_by: lockOwner,
      updated_at: now.toISOString()
    })
    .eq("lock_name", LOCK_NAME)
    .lte("locked_until", now.toISOString())
    .select("lock_name,locked_by,locked_until")
    .maybeSingle();

  if (result.error) {
    return {
      ok: false as const,
      acquired: false,
      error: result.error.message
    };
  }

  return {
    ok: true as const,
    acquired: result.data?.locked_by === lockOwner,
    lockOwner,
    admin
  };
}

async function releaseMonitorLock(lockOwner: string) {
  const admin = createSupabaseAdminClient();

  if (!admin) return;

  await admin
    .from("roamly_cron_locks")
    .update({
      locked_until: new Date(0).toISOString(),
      locked_by: null,
      updated_at: new Date().toISOString()
    })
    .eq("lock_name", LOCK_NAME)
    .eq("locked_by", lockOwner);
}

async function monitorSingleFlight(params: {
  supabase: SupabaseClient;
  booking: FlightBookingRow;
}): Promise<FlightMonitorResult> {
  const { supabase, booking } = params;

  const request = {
    flightNumber: booking.flight_number,
    departureDate: flightDepartureDate(
      booking.start_at
    ),
    origin: booking.origin,
    destination: booking.destination
  };

  const [flightSettled, gateSettled] =
    await Promise.allSettled([
      liveFlightStatusAdapter(request),
      airportGateAdapter(request)
    ]);

  const flightResult =
    flightSettled.status === "fulfilled"
      ? flightSettled.value
      : null;

  const gateResult =
    gateSettled.status === "fulfilled"
      ? gateSettled.value
      : null;

  if (flightResult) {
    await recordLiveProviderSnapshot({
      supabase,
      tripId: booking.trip_id,
      userId: booking.user_id,
      bookingId: booking.id,
      result: flightResult
    });
  }

  if (gateResult) {
    await recordLiveProviderSnapshot({
      supabase,
      tripId: booking.trip_id,
      userId: booking.user_id,
      bookingId: booking.id,
      result: gateResult
    });
  }

  const flight = flightResult
    ? normalizedResult(flightResult)
    : null;

  const gate = gateResult
    ? normalizedResult(gateResult)
    : null;

  if (!flight && !gate) {
    const errors = [
      flightSettled.status === "rejected"
        ? String(flightSettled.reason)
        : null,
      gateSettled.status === "rejected"
        ? String(gateSettled.reason)
        : null
    ].filter(Boolean);

    return {
      bookingId: booking.id,
      flightNumber: booking.flight_number,
      providerStatus:
        flightResult?.status || "unavailable",
      gateProviderStatus:
        gateResult?.status || "unavailable",
      changed: false,
      changeType: null,
      error:
        errors.length > 0
          ? errors.join("; ")
          : null
    };
  }

  const status =
    flight?.status ||
    gate?.status ||
    "unknown";

  const cancelled =
    flight?.cancelled === true ||
    gate?.cancelled === true ||
    status === "cancelled";

  const providerDeparture =
    validTimestamp(
      flight?.estimatedDeparture ||
      flight?.actualDeparture ||
      flight?.scheduledDeparture ||
      gate?.estimatedDeparture ||
      gate?.scheduledDeparture
    );

  const providerArrival =
    validTimestamp(
      flight?.estimatedArrival ||
      flight?.actualArrival ||
      flight?.scheduledArrival ||
      gate?.estimatedArrival ||
      gate?.scheduledArrival
    );

  const providerGate =
    cleanText(
      gate?.departureGate ||
      flight?.departureGate
    );

  const providerTerminal =
    cleanText(
      gate?.departureTerminal ||
      flight?.departureTerminal
    );

  const departureDifference = minuteDifference(
    booking.start_at,
    providerDeparture
  );

  const delayMinutes =
    flight?.delayMinutes ??
    gate?.delayMinutes ??
    (
      departureDifference !== null &&
      departureDifference > 0
        ? departureDifference
        : null
    );

  const departureChanged =
    providerDeparture !== null &&
    departureDifference !== null &&
    Math.abs(departureDifference) >= 5;

  const arrivalChanged =
    providerArrival !== null &&
    booking.end_at !== null &&
    Math.abs(
      minuteDifference(
        booking.end_at,
        providerArrival
      ) || 0
    ) >= 5;

  const gateChanged =
    providerGate !== null &&
    providerGate !== booking.gate;

  const terminalChanged =
    providerTerminal !== null &&
    providerTerminal !== booking.terminal;

  const cancellationChanged =
    cancelled &&
    booking.booking_status !== "cancelled";

  if (
    !departureChanged &&
    !arrivalChanged &&
    !gateChanged &&
    !terminalChanged &&
    !cancellationChanged
  ) {
    return {
      bookingId: booking.id,
      flightNumber: booking.flight_number,
      providerStatus:
        flightResult?.status || "unavailable",
      gateProviderStatus:
        gateResult?.status || "unavailable",
      changed: false,
      changeType: null,
      error: null
    };
  }

  const updatedAt = new Date().toISOString();

  const updatePayload: Record<string, unknown> = {
    updated_at: updatedAt,
    last_synced_at: updatedAt
  };

  if (cancellationChanged) {
    updatePayload.booking_status = "cancelled";
  }

  if (departureChanged) {
    updatePayload.start_at = providerDeparture;
  }

  if (arrivalChanged) {
    updatePayload.end_at = providerArrival;
  }

  if (gateChanged) {
    updatePayload.gate = providerGate;
  }

  if (terminalChanged) {
    updatePayload.terminal = providerTerminal;
  }

  const updateResult = await supabase
    .from("roamly_bookings")
    .update(updatePayload)
    .eq("id", booking.id)
    .eq("user_id", booking.user_id)
    .select("*")
    .single();

  if (updateResult.error) {
    return {
      bookingId: booking.id,
      flightNumber: booking.flight_number,
      providerStatus:
        flightResult?.status || "unavailable",
      gateProviderStatus:
        gateResult?.status || "unavailable",
      changed: false,
      changeType: null,
      error: updateResult.error.message
    };
  }

  const updatedBooking =
    updateResult.data as Record<string, unknown>;

  const flightTitle =
    booking.title ||
    booking.flight_number ||
    "Your flight";

  let eventType:
    | "flight_delayed"
    | "flight_cancelled"
    | "flight_time_changed"
    | "booking_updated";

  let severity:
    | "minor"
    | "routine"
    | "important"
    | "critical";

  let title: string;
  let summary: string;
  let requiresUserApproval: boolean;

  if (cancellationChanged) {
    eventType = "flight_cancelled";
    severity = "critical";
    title = `${flightTitle} was cancelled`;
    summary =
      "Roamly detected a live flight cancellation and checked the itinerary for affected plans.";
    requiresUserApproval = true;
  } else if (
    delayMinutes !== null &&
    delayMinutes >= 15
  ) {
    eventType = "flight_delayed";
    severity =
      delayMinutes >= 180
        ? "critical"
        : "important";
    title = `${flightTitle} is delayed`;
    summary =
      `Roamly detected a ${delayMinutes}-minute live flight delay and checked the itinerary for timing conflicts.`;
    requiresUserApproval =
      delayMinutes >= 60;
  } else if (
    departureChanged ||
    arrivalChanged
  ) {
    eventType = "flight_time_changed";
    severity = "important";
    title = `${flightTitle} schedule changed`;
    summary =
      "Roamly detected a validated live flight schedule change and checked the itinerary for timing conflicts.";
    requiresUserApproval = true;
  } else {
    eventType = "booking_updated";
    severity = "routine";
    title = `${flightTitle} gate information changed`;
    summary =
      "Roamly detected a validated gate or terminal change.";
    requiresUserApproval = false;
  }

  await processCompanionBookingChange({
    supabase,
    userId: booking.user_id,
    tripId: booking.trip_id,
    bookingId: booking.id,
    eventType,
    severity,
    title,
    summary,
    oldValue: booking,
    newValue: updatedBooking,
    source: "live_flight_provider",
    effectiveAt:
      flightResult?.effective_at ||
      gateResult?.effective_at ||
      updatedAt,
    affectedLayers: [
      "booking_wallet",
      "itinerary",
      "live_companion",
      "transportation"
    ],
    requiresUserApproval,
    fingerprintParts: [
      flightResult?.retrieved_at || null,
      gateResult?.retrieved_at || null,
      status,
      providerDeparture,
      providerGate,
      providerTerminal
    ]
  });

  return {
    bookingId: booking.id,
    flightNumber: booking.flight_number,
    providerStatus:
      flightResult?.status || "unavailable",
    gateProviderStatus:
      gateResult?.status || "unavailable",
    changed: true,
    changeType: eventType,
    error: null
  };
}

async function monitorUpcomingFlights(
  supabase: SupabaseClient
) {
  const now = Date.now();

  const windowStart = new Date(
    now - FLIGHT_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const windowEnd = new Date(
    now + FLIGHT_LOOKAHEAD_HOURS * 60 * 60 * 1000
  ).toISOString();

  const flightsResult = await supabase
    .from("roamly_bookings")
    .select(
      "id,user_id,trip_id,title,flight_number,booking_status,start_at,end_at,origin,destination,gate,terminal,updated_at"
    )
    .eq("booking_type", "flight")
    .in(
      "booking_status",
      ["booked", "paid", "reserved"]
    )
    .not("trip_id", "is", null)
    .not("flight_number", "is", null)
    .gte("start_at", windowStart)
    .lte("start_at", windowEnd)
    .order("start_at", {
      ascending: true
    })
    .limit(MAX_FLIGHTS_PER_RUN);

  if (flightsResult.error) {
    return {
      ok: false as const,
      flightsFound: 0,
      flightsProcessed: 0,
      changesDetected: 0,
      failures: 1,
      error: flightsResult.error.message,
      results: [] as FlightMonitorResult[]
    };
  }

  const flights =
    (flightsResult.data || []) as FlightBookingRow[];

  const results: FlightMonitorResult[] = [];

  for (const booking of flights) {
    try {
      results.push(
        await monitorSingleFlight({
          supabase,
          booking
        })
      );
    } catch (error) {
      results.push({
        bookingId: booking.id,
        flightNumber: booking.flight_number,
        providerStatus: "error",
        gateProviderStatus: "error",
        changed: false,
        changeType: null,
        error:
          error instanceof Error
            ? error.message
            : "Live flight monitoring failed."
      });
    }
  }

  const failures = results.filter(
    (result) => Boolean(result.error)
  ).length;

  const changesDetected = results.filter(
    (result) => result.changed
  ).length;

  return {
    ok: failures === 0,
    flightsFound: flights.length,
    flightsProcessed: results.length,
    changesDetected,
    failures,
    results
  };
}

export async function runScheduledBookingMonitor() {
  const lock = await acquireMonitorLock();

  if (!lock.ok) {
    return {
      ok: false as const,
      skipped: false,
      error: lock.error
    };
  }

  if (!lock.acquired) {
    return {
      ok: true as const,
      skipped: true,
      reason: "Booking monitor is already running."
    };
  }

  const admin = lock.admin;
  const startedAt = new Date().toISOString();

  const runInsert = await admin
    .from("roamly_booking_monitor_runs")
    .insert({
      status: "running",
      started_at: startedAt
    })
    .select("id")
    .single();

  const runId =
    runInsert.data?.id as string | undefined;

  try {
    const dueBefore = new Date(
      Date.now() -
        SYNC_INTERVAL_MINUTES * 60_000
    ).toISOString();

    const connectionsResult = await admin
      .from("email_connections")
      .select(
        "id,user_id,provider,last_synced_at"
      )
      .eq("connection_status", "connected")
      .in("provider", ["gmail", "outlook"])
      .or(
        `last_synced_at.is.null,last_synced_at.lte.${dueBefore}`
      )
      .order("last_synced_at", {
        ascending: true,
        nullsFirst: true
      })
      .limit(MAX_CONNECTIONS_PER_RUN);

    if (connectionsResult.error) {
      throw new Error(
        connectionsResult.error.message
      );
    }

    const connections =
      (connectionsResult.data || []) as ConnectionRow[];

    const emailResults: Array<{
      connectionId: string;
      userId: string;
      provider: string;
      ok: boolean;
      processed: number;
      error: string | null;
    }> = [];

    for (const connection of connections) {
      try {
        const syncResult =
          connection.provider === "gmail"
            ? await syncGmailConnection({
                supabase: admin,
                userId: connection.user_id
              })
            : await syncOutlookConnection({
                supabase: admin,
                userId: connection.user_id
              });

        emailResults.push({
          connectionId: connection.id,
          userId: connection.user_id,
          provider: connection.provider,
          ok: syncResult.ok === true,
          processed:
            syncResult.processed || 0,
          error:
            syncResult.error || null
        });
      } catch (error) {
        emailResults.push({
          connectionId: connection.id,
          userId: connection.user_id,
          provider: connection.provider,
          ok: false,
          processed: 0,
          error:
            error instanceof Error
              ? error.message
              : "Booking sync failed."
        });
      }
    }

    const flightMonitor =
      await monitorUpcomingFlights(admin);

    const emailFailures =
      emailResults.filter(
        (result) => !result.ok
      ).length;

    const messagesProcessed =
      emailResults.reduce(
        (total, result) =>
          total + result.processed,
        0
      );

    const totalFailures =
      emailFailures +
      flightMonitor.failures;

    const status =
      totalFailures === 0
        ? "completed"
        : "partial";

    if (runId) {
      await admin
        .from("roamly_booking_monitor_runs")
        .update({
          status,
          completed_at:
            new Date().toISOString(),
          connections_found:
            connections.length,
          connections_processed:
            emailResults.length,
          messages_processed:
            messagesProcessed,
          failures: totalFailures,
          result_json: {
            emailResults,
            flightMonitor
          }
        })
        .eq("id", runId);
    }

    return {
      ok: totalFailures === 0,
      skipped: false,
      status,

      connectionsFound:
        connections.length,
      connectionsProcessed:
        emailResults.length,
      messagesProcessed,
      emailFailures,
      emailResults,

      flightsFound:
        flightMonitor.flightsFound,
      flightsProcessed:
        flightMonitor.flightsProcessed,
      flightChangesDetected:
        flightMonitor.changesDetected,
      flightFailures:
        flightMonitor.failures,
      flightResults:
        flightMonitor.results,

      failures: totalFailures
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Booking monitor failed.";

    if (runId) {
      await admin
        .from("roamly_booking_monitor_runs")
        .update({
          status: "failed",
          completed_at:
            new Date().toISOString(),
          failures: 1,
          result_json: {
            error: message
          }
        })
        .eq("id", runId);
    }

    return {
      ok: false as const,
      skipped: false,
      error: message
    };
  } finally {
    await releaseMonitorLock(
      lock.lockOwner
    );
  }
}
