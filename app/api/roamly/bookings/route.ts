import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const tripId = request.nextUrl.searchParams.get("tripId") || "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const { data: bookings, error } = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("user_id", data.user.id)
    .eq("trip_id", tripId)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, bookings: bookings || [] });
}
