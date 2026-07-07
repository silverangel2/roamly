import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getRoamlyProfile, upsertRoamlyProfile } from "@/lib/profiles";

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const profile = await getRoamlyProfile(auth.supabase, auth.user);

  if (profile.error) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: profile.profile });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const fullName = cleanName(body.fullName);
  const profile = await upsertRoamlyProfile(auth.supabase, auth.user, {
    full_name: fullName || null
  });

  if (profile.error) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: profile.profile });
}
