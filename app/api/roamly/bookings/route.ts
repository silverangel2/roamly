import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const tripId = request.nextUrl.searchParams.get("tripId") || "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  const { data: bookings, error } = await auth.supabase
    .from("roamly_bookings")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("trip_id", tripId)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, bookings: bookings || [] });
}
