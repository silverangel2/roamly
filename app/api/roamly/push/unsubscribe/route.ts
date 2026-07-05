import { NextRequest, NextResponse } from "next/server";
import { disablePushSubscription } from "@/lib/roamly/pushServer";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : undefined;

  const result = await disablePushSubscription(supabase, data.user.id, endpoint);
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
