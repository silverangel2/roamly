import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!body.endpoint) return NextResponse.json({ ok: false, error: "Push endpoint is required." }, { status: 400 });

  const { error } = await supabase.from("roamly_push_subscriptions").upsert(
    {
      user_id: data.user.id,
      endpoint: body.endpoint,
      p256dh: body.keys?.p256dh || null,
      auth: body.keys?.auth || null,
      user_agent: request.headers.get("user-agent") || null,
      enabled: true
    },
    { onConflict: "endpoint" }
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
