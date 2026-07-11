import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { ensureRoamlyProfile } from "@/lib/roamly/profile";

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const profile = await ensureRoamlyProfile(auth.user, {}, auth.supabase);

  if (profile.error && profile.tableAvailable) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile: profile.profile,
    profileTableAvailable: profile.tableAvailable,
    error: profile.error || null
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const fullName = cleanName(body.fullName);
  const profile = await ensureRoamlyProfile(
    auth.user,
    {
      full_name: fullName || null
    },
    auth.supabase
  );

  if (profile.error) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: profile.tableAvailable ? 500 : 503 });
  }

  return NextResponse.json({ ok: true, profile: profile.profile });
}
