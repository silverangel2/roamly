import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import {
  deleteTravelerMemory,
  deleteTravelerPreference,
  getTravelerMemory,
  updatePreferenceEventStatus,
  upsertTravelerProfile
} from "@/lib/roamly/travelerMemory";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const memory = await getTravelerMemory(auth.supabase, auth.user.id);
  if (memory.error) return NextResponse.json({ ok: false, error: memory.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    profile: memory.profile,
    events: memory.events
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = record(await request.json().catch(() => ({})));
  const action = typeof body.action === "string" ? body.action : "update_profile";

  if (action === "delete_preference") {
    const key = typeof body.key === "string" ? body.key : "";
    const result = await deleteTravelerPreference({ supabase: auth.supabase, userId: auth.user.id, key });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "event_status") {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const status =
      body.status === "accepted" || body.status === "rejected" || body.status === "reverted" ? body.status : null;
    if (!eventId || !status) return NextResponse.json({ ok: false, error: "Valid eventId and status are required." }, { status: 400 });
    const result = await updatePreferenceEventStatus({
      supabase: auth.supabase,
      userId: auth.user.id,
      eventId,
      status,
      editedValue: body.editedValue
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const updates = {
    ...record(body.preferences),
    ...(Object.prototype.hasOwnProperty.call(body, "personalizationEnabled")
      ? { personalization_enabled: body.personalizationEnabled !== false }
      : {})
  };
  const result = await upsertTravelerProfile({
    supabase: auth.supabase,
    userId: auth.user.id,
    updates
  });
  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, profile: result.profile });
}

export async function DELETE() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const result = await deleteTravelerMemory(auth.supabase, auth.user.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
