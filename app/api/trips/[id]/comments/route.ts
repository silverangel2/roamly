import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { addPlanComment, listPlanComments } from "@/lib/roamly/planComments";

/**
 * Owner-only plan comments for a trip.
 *
 * GET  /api/trips/:id/comments  → own comments, oldest first
 * POST /api/trips/:id/comments  → { body } adds one comment on the own trip
 *
 * Auth + ownership follow the trips/[id]/feedback route exactly: requireUser(),
 * then the lib proves roamly_trips.id + user_id. Another traveler's id yields
 * TRIP_NOT_FOUND (404). Bodies are plain text (React escapes on render);
 * the API returns a clean 503-style unavailable outcome until the
 * 20261016000200_plan_comments.sql migration is applied.
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const result = await listPlanComments({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id
  });
  if (result.error === "TRIP_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  }
  if (result.error === "TABLE_UNAVAILABLE") {
    return NextResponse.json({ ok: false, error: "COMMENTS_UNAVAILABLE" }, { status: 503 });
  }
  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, comments: result.comments });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await addPlanComment({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    body: payload.body,
    scope: payload.scope,
    ref: payload.ref
  });
  if (!result.ok) {
    if (result.error === "TRIP_NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
    }
    if (result.error === "TABLE_UNAVAILABLE") {
      return NextResponse.json({ ok: false, error: "COMMENTS_UNAVAILABLE" }, { status: 503 });
    }
    const status = result.error === "EMPTY_BODY" || result.error === "BODY_TOO_LONG" ? 400 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, comment: result.comment });
}
