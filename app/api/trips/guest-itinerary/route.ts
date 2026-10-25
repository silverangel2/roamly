import { randomUUID, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateTripForActor } from "@/lib/roamly/tripGenerationRoute";
import {
  GUEST_ITINERARY_COOKIE,
  guestItineraryCookieOptions,
  signGuestItineraryCookie,
  verifyGuestItineraryCookie
} from "@/lib/roamly/guestItineraryAccess";
import {
  GUEST_AVIASALES_SEARCH_URL,
  GUEST_ITINERARY_PATH,
  GUEST_PAID_ENTITLEMENT_MESSAGE,
  guestFreeItineraryEntitlement,
  publicGuestItineraryView
} from "@/lib/roamly/guestItineraryView";
import { buildAviasalesDeepLink } from "@/lib/roamly/bookingLinks";
import { buildGuestGenerationStatus } from "@/lib/roamly/guestGenerationStatus";
import { derivePackBuildStatus } from "@/lib/roamly/packBuildStatus";
import {
  guestRecoveryUrl,
  readGuestDeliveryEmail,
  readGuestDeliverySentAt,
  signGuestRecoveryToken,
  withGuestDeliverySent
} from "@/lib/roamly/guestDelivery";
import { sendRoamlyEmail } from "@/lib/roamly/email";
import { publicStagedGenerationProgress } from "@/lib/roamly/stagedItineraryGeneration";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 90;

const GUEST_TRIP_COLUMNS = "id,user_id,title,destination_name,status,itinerary_status,itinerary_payment_status,itinerary_unlock_source,tracking_unlocked,live_companion_unlocked,metadata,created_at";

function guestUnavailable(message = "Roamly could not start a free itinerary right now.") {
  return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE", message }, { status: 503 });
}

function guestPaymentRequired() {
  return NextResponse.json(
    { ok: false, error: "PAYMENT_REQUIRED", message: GUEST_PAID_ENTITLEMENT_MESSAGE },
    { status: 402 }
  );
}

function guestFreeQueued(tripId: string) {
  return NextResponse.json(
    { ok: true, status: "queued", tripId, previewUrl: GUEST_ITINERARY_PATH, unlockSource: "free" },
    { status: 202 }
  );
}

async function guestUserRecord(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const result = await admin.auth.admin.getUserById(userId);
  return result.data.user || null;
}

function isGuestItineraryUser(user: { user_metadata?: Record<string, unknown> | null } | null) {
  return user?.user_metadata?.roamly_guest_itinerary === true;
}

async function loadGuestTrip(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, tripId: string, userId: string) {
  return admin
    .from("roamly_trips")
    .select(GUEST_TRIP_COLUMNS)
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
}

async function guestGenerationRequest(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  delete body.tripId;
  delete body.trip_id;
  return new NextRequest(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function GET(request: NextRequest) {
  const access = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  if (!access) {
    return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_REQUIRED" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  const guestUser = await guestUserRecord(admin, access.userId);
  if (!isGuestItineraryUser(guestUser)) return guestPaymentRequired();

  const { data: trip, error } = await loadGuestTrip(admin, access.tripId, access.userId);
  if (error) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 500 });
  if (!trip) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  if (!guestFreeItineraryEntitlement(trip).allowed) return guestPaymentRequired();

  const itineraryResult = await admin
    .from("roamly_itineraries")
    .select("full_json")
    .eq("trip_id", access.tripId)
    .eq("user_id", access.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Flight search link for the honest empty-flights state: built from
  //  the trip's own generation payload (origin, destination, dates) via
  //  the standing Travelpayouts/Aviasales builder — a link to search,
  //  never a fabricated flight, price, or time. When the builder cannot
  //  resolve a routed search (e.g. an unmapped airport), the section
  //  still gets the Aviasales search home page rather than vanishing.
  const tripMetadataRecord =
    trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
      ? (trip.metadata as Record<string, unknown>)
      : null;
  const generationPayloadRecord =
    tripMetadataRecord?.generation && typeof tripMetadataRecord.generation === "object" && !Array.isArray(tripMetadataRecord.generation)
      ? ((tripMetadataRecord.generation as Record<string, unknown>).payload as Record<string, unknown> | null)
      : null;
  const payloadTravelers = generationPayloadRecord?.travelers;
  const payloadAdults =
    typeof payloadTravelers === "number"
      ? payloadTravelers
      : payloadTravelers && typeof payloadTravelers === "object" && !Array.isArray(payloadTravelers)
        ? (payloadTravelers as Record<string, unknown>).adults
        : null;
  const flightSearchUrl =
    buildAviasalesDeepLink({
      origin:
        typeof generationPayloadRecord?.origin === "string"
          ? generationPayloadRecord.origin
          : typeof generationPayloadRecord?.originCity === "string"
            ? generationPayloadRecord.originCity
            : null,
      destination:
        typeof trip.destination_name === "string" && trip.destination_name.trim()
          ? trip.destination_name
          : typeof generationPayloadRecord?.destination === "string"
            ? generationPayloadRecord.destination
            : null,
      departureDate: typeof generationPayloadRecord?.startDate === "string" ? generationPayloadRecord.startDate : null,
      returnDate: typeof generationPayloadRecord?.endDate === "string" ? generationPayloadRecord.endDate : null,
      travelers: typeof payloadAdults === "number" && Number.isFinite(payloadAdults) ? payloadAdults : 1,
      marker: process.env.ROAMLY_TRAVELPAYOUTS_MARKER
    }) || GUEST_AVIASALES_SEARCH_URL;


  const view = publicGuestItineraryView({
    tripTitle: trip.title,
    destination: trip.destination_name,
    tripStatus: trip.status,
    itineraryStatus: trip.itinerary_status,
    fullJson: itineraryResult.data?.full_json,
    metadata: trip.metadata,
    flightSearchUrl
  });

  // Real generation status for the guest page, from measured fields only.
  // Only safe, plain values cross into the response: no error text, no error
  // codes, no model names, no costs, no tokens. The progress record is mapped
  // to the three fields the estimator reads, so nothing else from it can leak.
  // One gap in the public record: it drops per-day start/finish times, so the
  // route reads those from the same v2 generation doc (only when the public
  // record parsed, which already proves the doc is v2) for the pace math.
  const progress = publicStagedGenerationProgress(trip.metadata, access.tripId);
  const metadataRecord =
    trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
      ? (trip.metadata as Record<string, unknown>)
      : null;
  const generationRecord =
    metadataRecord?.generation && typeof metadataRecord.generation === "object" && !Array.isArray(metadataRecord.generation)
      ? (metadataRecord.generation as Record<string, unknown>)
      : null;
  const rawDaysRecord =
    generationRecord?.days && typeof generationRecord.days === "object" && !Array.isArray(generationRecord.days)
      ? (generationRecord.days as Record<string, unknown>)
      : null;
  const rawDayTiming = progress && rawDaysRecord
    ? Object.values(rawDaysRecord)
        .filter((day): day is Record<string, unknown> => !!day && typeof day === "object" && !Array.isArray(day))
        .map((day) => ({
          status: typeof day.status === "string" ? day.status : "",
          startedAt: typeof day.startedAt === "string" ? day.startedAt : null,
          completedAt: typeof day.completedAt === "string" ? day.completedAt : null
        }))
    : [];
  const zeroEngineRecord =
    metadataRecord?.zeroEngine && typeof metadataRecord.zeroEngine === "object" && !Array.isArray(metadataRecord.zeroEngine)
      ? (metadataRecord.zeroEngine as Record<string, unknown>)
      : null;
  const packWaitCount =
    typeof zeroEngineRecord?.packWaitCount === "number" && Number.isFinite(zeroEngineRecord.packWaitCount)
      ? zeroEngineRecord.packWaitCount
      : 0;
  const waitingForPack =
    packWaitCount > 0 && progress?.currentStage === "generating_outline" && (progress?.completedDayCount ?? 0) === 0;
  const maxPackWaitMs = Math.max(
    60_000,
    Number(process.env.ROAMLY_ZERO_ENGINE_MAX_PACK_WAIT_MS || 7_200_000) || 7_200_000
  );
  // Pack-build visibility (incident 2026-10-25, stream 2): read-only
  // display from existing pack rows + the trip's own zero-engine
  // record. Deliberately NOT readServingPack: that would enqueue a
  // build as a side effect. A read failure degrades to "unknown" and
  // never fails this response.
  const packDestinationId =
    typeof zeroEngineRecord?.destinationId === "string" && zeroEngineRecord.destinationId.trim()
      ? zeroEngineRecord.destinationId.trim()
      : null;
  let packBuild = derivePackBuildStatus({ destinationId: packDestinationId });
  if (packDestinationId) {
    try {
      const [readyResult, jobsResult] = await Promise.all([
        admin
          .from("roamly_destination_packs")
          .select("pack_version_id,status,built_at,candidate_count")
          .eq("destination_id", packDestinationId)
          .eq("status", "ready")
          .order("version", { ascending: false })
          .limit(1),
        admin
          .from("roamly_destination_pack_builds")
          .select("status,requested_at,started_at,finished_at,error")
          .eq("destination_id", packDestinationId)
          .order("requested_at", { ascending: false })
          .limit(10)
      ]);
      if (readyResult.error || jobsResult.error) {
        packBuild = derivePackBuildStatus({ destinationId: packDestinationId, readFailed: true });
      } else {
        const readyRow = (readyResult.data || [])[0] as
          | { pack_version_id?: unknown; built_at?: unknown; candidate_count?: unknown }
          | undefined;
        packBuild = derivePackBuildStatus({
          destinationId: packDestinationId,
          readyVersion: readyRow
            ? {
                packVersionId: readyRow.pack_version_id,
                builtAt: readyRow.built_at,
                candidateCount: readyRow.candidate_count
              }
            : null,
          buildJobs: ((jobsResult.data || []) as Array<{
            status?: unknown;
            requested_at?: unknown;
            started_at?: unknown;
            finished_at?: unknown;
            error?: unknown;
          }>).map((row) => ({
            status: row.status,
            requestedAt: row.requested_at,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            error: row.error
          }))
        });
      }
    } catch {
      packBuild = derivePackBuildStatus({ destinationId: packDestinationId, readFailed: true });
    }
  }
  const generationStatus = buildGuestGenerationStatus({
    viewStatus: view.status,
    progress: progress
      ? {
          status: progress.status,
          currentStage: progress.currentStage,
          completedDayCount: progress.completedDayCount,
          totalDayCount: progress.totalDayCount,
          days:
            rawDayTiming.length > 0
              ? rawDayTiming
              : progress.days.map((day) => ({
                  status: day.status,
                  startedAt: null,
                  completedAt: null
                })),
          stageRuns: progress.stageRuns.map((run) => ({
            stage: run.stage,
            status: run.status,
            durationMs: run.durationMs,
            dayNumbers: run.dayNumbers
          })),
          startedAt: progress.startedAt
        }
      : null,
    waitingForPack,
    failedTimeout: progress?.lastErrorCode === "ZERO_ENGINE_PACK_WAIT_TIMEOUT",
    destination:
      typeof trip.destination_name === "string" && trip.destination_name.trim()
        ? trip.destination_name.trim().slice(0, 160)
        : null,
    tripStartedAt:
      typeof (trip as { created_at?: unknown }).created_at === "string"
        ? (trip as { created_at: string }).created_at
        : null,
    nowMs: Date.now(),
    maxPackWaitMs,
    packBuild
  });

  // Guest delivery (owner law, 2026-10-24): when the itinerary is ready
  // and the traveler left an email at day-1-ready, send them the rest —
  // day list plus the recovery link, so the trip survives a browser or
  // device switch. The sent flag makes it exactly-once even if the page
  // is reloaded; a failed send leaves the flag unset so the next load
  // retries. Sending never fails this response.
  const deliveryEmail = readGuestDeliveryEmail(trip.metadata);
  if (view.status === "ready" && deliveryEmail && !readGuestDeliverySentAt(trip.metadata)) {
    try {
      const dayLines = view.days
        .map((day) => `Day ${day.dayNumber}${day.date ? ` · ${day.date}` : ""}${day.title ? ` — ${day.title}` : ""}`)
        .join("\n");
      const recoveryToken = signGuestRecoveryToken(access.tripId, access.userId);
      const recoveryLink = recoveryToken ? guestRecoveryUrl(recoveryToken) : null;
      const text = [
        `Your free Roamly itinerary is ready — ${trip.title || "your trip"}.`,
        dayLines ? `\n${dayLines}` : "",
        recoveryLink
          ? `\nOpen it any time, on any device, with this link (works for 30 days):\n${recoveryLink}`
          : "",
        "\nNothing is booked or charged. This is the itinerary you asked Roamly to build."
      ].join("\n");
      const sent = await sendRoamlyEmail({
        to: deliveryEmail,
        subject: "Your Roamly itinerary is ready",
        text,
        html: `<p>Your free Roamly itinerary is ready — ${trip.title || "your trip"}.</p>${recoveryLink ? `<p><a href="${recoveryLink}">Open your itinerary any time, on any device</a> (link works for 30 days).</p>` : ""}<p>Nothing is booked or charged. This is the itinerary you asked Roamly to build.</p>`,
        tripId: access.tripId,
        idempotencyKey: `guest-delivery:${access.tripId}`
      }).catch(() => null);
      if (sent?.ok) {
        await admin
          .from("roamly_trips")
          .update({ metadata: withGuestDeliverySent(trip.metadata) })
          .eq("id", access.tripId)
          .eq("user_id", access.userId);
      }
    } catch {
      // Delivery is best-effort; the page itself must always load.
    }
  }

  return NextResponse.json({ ok: true, tripId: access.tripId, unlockSource: "free", ...view, generationStatus, packBuild, deliveryEmail });
}

export async function POST(request: NextRequest) {
  const existing = verifyGuestItineraryCookie(request.cookies.get(GUEST_ITINERARY_COOKIE)?.value);
  const admin = createSupabaseAdminClient();
  if (!admin) return guestUnavailable();

  if (existing) {
    const guestUser = await guestUserRecord(admin, existing.userId);
    if (!isGuestItineraryUser(guestUser)) return guestPaymentRequired();
    const { data: trip, error } = await loadGuestTrip(admin, existing.tripId, existing.userId);
    if (error) return NextResponse.json({ ok: false, error: "GUEST_ITINERARY_UNAVAILABLE" }, { status: 500 });
    if (!trip || !guestFreeItineraryEntitlement(trip).allowed) return guestPaymentRequired();
    return guestFreeQueued(existing.tripId);
  }

  const created = await admin.auth.admin.createUser({
    email: `guest.${randomUUID()}@example.com`,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { roamly_guest_itinerary: true }
  });
  if (created.error || !created.data.user) {
    console.error("[Roamly guest itinerary] Guest user create failed", created.error?.message);
    return guestUnavailable();
  }

  const generated = await generateTripForActor(await guestGenerationRequest(request), {
    supabase: admin as NonNullable<Parameters<typeof generateTripForActor>[1]["supabase"]>,
    user: { id: created.data.user.id, email: null }
  });
  const payload = (await generated.json().catch(() => null)) as { tripId?: string; unlockSource?: string; error?: string; message?: string } | null;
  if (generated.status === 202 && payload?.tripId && payload.unlockSource === "free") {
    const token = signGuestItineraryCookie(String(payload.tripId), created.data.user.id);
    const response = guestFreeQueued(String(payload.tripId));
    if (token) response.cookies.set(GUEST_ITINERARY_COOKIE, token, guestItineraryCookieOptions());
    return response;
  }

  if (generated.status === 402 || payload?.error === "PAYMENT_REQUIRED" || (payload?.unlockSource && payload.unlockSource !== "free")) {
    return guestPaymentRequired();
  }

  return NextResponse.json(
    {
      ok: false,
      error: payload?.error || "GUEST_ITINERARY_UNAVAILABLE",
      message: payload?.message || "Roamly could not start a free itinerary right now."
    },
    { status: generated.status || 500 }
  );
}
