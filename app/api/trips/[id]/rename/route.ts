import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { uuidParam } from "@/lib/roamly/tripIdParam";

type RouteContext = { params: Promise<{ id: string }> };

/*
 * Trip rename (consolidation 2026-11-06, audit D13):
 * roamly_trips.title has existed since the base schema and the
 * dashboard already displays `trip.title || destination` — but no
 * control anywhere could WRITE a title, so every trip was stuck
 * with its destination as its name. This route is the missing
 * write path: owner-scoped (RLS + explicit user filter), a plain
 * text name up to 80 characters, and an empty name clears back to
 * the destination label. Nothing else about the trip changes.
 */
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const tripId = uuidParam(id);
  if (!tripId) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.title !== "string") {
    return NextResponse.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });
  }
  const title = body.title.trim().replace(/\s+/g, " ").slice(0, 80) || null;

  const { data, error } = await auth.supabase
    .from("roamly_trips")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", tripId)
    .eq("user_id", auth.user.id)
    .select("id,title")
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: "RENAME_FAILED" }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "TRIP_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, title: data.title ?? null });
}
