import { NextRequest, NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/roamly/cronAuth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail, sendRoamlyEmail } from "@/lib/roamly/email";
import {
  escapeEmailHtml,
  renderEmailBodyCopy,
  renderEmailCta,
  renderRoamlyEmailShell,
  toRoamlyAbsoluteUrl
} from "@/lib/roamly/emailTemplates";

/**
 * Daily post-trip ask: ~7 days after a trip completes, email the traveler BOTH
 * asks — (a) rate your booked items, (b) share your proven itinerary.
 *
 * Guards:
 * - marketing consent honored via roamly_email_preferences.library_ask_opt_out
 *   (fail-soft: missing table → the email still sends; it is about the
 *   traveler's own trip and every send carries an opt-out path)
 * - one email per trip via the roamly_email_logs idempotency key
 *   post_trip_library_ask:<trip_id>
 * - skips trips where both asks are already done
 * - fail-soft per trip: one bad trip never fails the run
 */
export const maxDuration = 300;

const IDEMPOTENCY_PREFIX = "post_trip_library_ask";
const TRIP_LIMIT = 100;

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function tripLabel(trip: Record<string, unknown>) {
  const city = typeof trip.destination_city === "string" && trip.destination_city.trim() ? trip.destination_city.trim() : "";
  const destination = typeof trip.destination === "string" && trip.destination.trim() ? trip.destination.trim() : "";
  const name = typeof trip.destination_name === "string" && trip.destination_name.trim() ? trip.destination_name.trim() : "";
  const title = typeof trip.title === "string" && trip.title.trim() ? trip.title.trim() : "";
  return city || destination || name || title || "your trip";
}

function isMissingTableError(message: string) {
  return /schema cache|could not find the table|relation .* does not exist|42P01/i.test(message || "");
}

async function alreadyEmailed(admin: ReturnType<typeof createSupabaseAdminClient>, tripId: string) {
  if (!admin) return false;
  try {
    const { data, error } = await admin
      .from("roamly_email_logs")
      .select("id")
      .eq("idempotency_key", `${IDEMPOTENCY_PREFIX}:${tripId}`)
      .in("status", ["sent", "captured", "skipped"])
      .limit(1);
    if (error) return false;
    return Boolean(data?.length);
  } catch {
    return false;
  }
}

async function optedOut(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  if (!admin) return false;
  try {
    const { data, error } = await admin
      .from("roamly_email_preferences")
      .select("library_ask_opt_out")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      // Fail-soft: no preferences table yet → not opted out.
      if (isMissingTableError(error.message)) return false;
      return false;
    }
    return (data as { library_ask_opt_out?: boolean } | null)?.library_ask_opt_out === true;
  } catch {
    return false;
  }
}

async function bothAsksDone(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, tripId: string) {
  if (!admin) return false;
  try {
    const [feedback, submission] = await Promise.all([
      admin.from("trip_feedback").select("id").eq("trip_id", tripId).eq("user_id", userId).eq("feedback_type", "post_trip").limit(1),
      admin.from("itinerary_submissions").select("id").eq("trip_id", tripId).eq("user_id", userId).limit(1)
    ]);
    if (feedback.error || submission.error) {
      if (submission.error && isMissingTableError(submission.error.message)) {
        return Boolean(feedback.data?.length);
      }
      return false;
    }
    return Boolean(feedback.data?.length) && Boolean(submission.data?.length);
  } catch {
    return false;
  }
}

function renderPostTripAskEmail(params: { destination: string; tripId: string }) {
  const feedbackUrl = toRoamlyAbsoluteUrl(`/trip/${params.tripId}/feedback`);
  const shareUrl = toRoamlyAbsoluteUrl(`/trips/share?trip=${params.tripId}`);
  const intro = `Your trip to ${params.destination} wrapped up about a week ago. Two quick asks while it is still fresh — both make Roamly smarter for you and for future travelers.`;
  const bodyHtml = `${renderEmailBodyCopy(intro)}
    <div style="Margin:20px 0 0 0;padding:18px;border:1px solid #e4e7ec;border-radius:8px;background:#f9fafb;">
      <p style="Margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;font-weight:700;color:#101828;">1 · Rate your booked items</p>
      ${renderEmailBodyCopy("Tell Roamly what worked and what did not — the hotels, flights, and activities you actually booked. It tunes your future trips.")}
      ${renderEmailCta("Leave feedback", feedbackUrl)}
    </div>
    <div style="Margin:16px 0 0 0;padding:18px;border:1px solid #e4e7ec;border-radius:8px;background:#f9fafb;">
      <p style="Margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;font-weight:700;color:#101828;">2 · Share your proven itinerary</p>
      ${renderEmailBodyCopy("Publish this trip to the Itinerary Library so future travelers learn from real bookings — never scraped reviews. You choose whether it is reused anonymously.")}
      ${renderEmailCta("Share itinerary", shareUrl)}
    </div>`;
  const bodyText = `${intro}\n\n1 · Rate your booked items\nTell Roamly what worked and what did not — the hotels, flights, and activities you actually booked. It tunes your future trips.\nLeave feedback: ${feedbackUrl}\n\n2 · Share your proven itinerary\nPublish this trip to the Itinerary Library so future travelers learn from real bookings — never scraped reviews. You choose whether it is reused anonymously.\nShare itinerary: ${shareUrl}`;
  return renderRoamlyEmailShell({
    subject: `How was ${params.destination}?`,
    preheader: "Two quick asks while your trip is still fresh.",
    eyebrow: "Trip reflection",
    title: `How was ${params.destination}?`,
    bodyHtml,
    bodyText,
    supportEmail: getRoamlySupportEmail()
  });
}

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return NextResponse.json({ ok: false, error: "Cron secret is not configured." }, { status: 503 });
  if (!isCronRequestAuthorized(request.headers, secret)) return NextResponse.json({ ok: false, error: "Unauthorized cron." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });

  // Trips that completed ~7 days ago: end_date in [8 days ago, 7 days ago).
  const windowStart = isoDateDaysAgo(8);
  const windowEnd = isoDateDaysAgo(7);
  const { data: trips, error: tripsError } = await admin
    .from("roamly_trips")
    .select("id,user_id,title,destination,destination_city,destination_country,destination_name,end_date")
    .eq("status", "completed")
    .gte("end_date", windowStart)
    .lt("end_date", windowEnd)
    .order("end_date", { ascending: true })
    .limit(TRIP_LIMIT);
  if (tripsError) return NextResponse.json({ ok: false, error: tripsError.message }, { status: 207 });

  let emailed = 0;
  let skipped = 0;
  const failures: Array<{ tripId: string; error: string }> = [];

  await Promise.allSettled(
    (trips || []).map(async (row) => {
      const trip = row as Record<string, unknown>;
      const tripId = String(trip.id || "");
      const userId = String(trip.user_id || "");
      if (!tripId || !userId) {
        skipped += 1;
        return;
      }
      try {
        if (await alreadyEmailed(admin, tripId)) {
          skipped += 1;
          return;
        }
        if (await optedOut(admin, userId)) {
          skipped += 1;
          return;
        }
        if (await bothAsksDone(admin, userId, tripId)) {
          skipped += 1;
          return;
        }
        const { data: userResult } = await admin.auth.admin.getUserById(userId);
        const to = userResult.user?.email || "";
        if (!to) {
          skipped += 1;
          return;
        }
        const destination = tripLabel(trip);
        const template = renderPostTripAskEmail({ destination, tripId });
        const result = await sendRoamlyEmail({
          to,
          subject: template.subject,
          html: template.html,
          text: template.text,
          userId,
          tripId,
          idempotencyKey: `${IDEMPOTENCY_PREFIX}:${tripId}`,
          metadata: { type: IDEMPOTENCY_PREFIX, template: IDEMPOTENCY_PREFIX, destination }
        });
        if (result.ok) {
          emailed += 1;
        } else {
          failures.push({ tripId, error: result.error });
        }
      } catch (error) {
        failures.push({ tripId, error: error instanceof Error ? error.message : "UNKNOWN" });
      }
    })
  );

  return NextResponse.json(
    {
      ok: failures.length === 0,
      window: { start: windowStart, end: windowEnd },
      tripsConsidered: (trips || []).length,
      emailed,
      skipped,
      failures
    },
    { status: failures.length === 0 ? 200 : 207 }
  );
}
