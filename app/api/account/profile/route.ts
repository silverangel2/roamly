import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRoamlyProfile, upsertRoamlyProfile } from "@/lib/profiles";

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });
  }

  const profile = await getRoamlyProfile(supabase, data.user);

  if (profile.error) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: profile.profile });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const fullName = cleanName(body.fullName);
  const profile = await upsertRoamlyProfile(supabase, data.user, {
    full_name: fullName || null
  });

  if (profile.error) {
    return NextResponse.json({ ok: false, error: profile.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: profile.profile });
}
