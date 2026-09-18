import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/roamly/auth";
import { supersedeBooking } from "@/lib/roamly/bookingWallet";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id: tripId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const predecessorId = typeof body.predecessorBookingId === "string" ? body.predecessorBookingId : "";
  const successorId = typeof body.successorBookingId === "string" ? body.successorBookingId : "";
  if (!predecessorId || !successorId) return NextResponse.json({ ok: false, error: "Both booking IDs are required." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Trusted booking service is unavailable." }, { status: 503 });
  const result = await supersedeBooking({ supabase: auth.supabase, admin, userId: auth.user.id, tripId, predecessorId, successorId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "BOOKING_NOT_FOUND" ? 404 : 400 });
  return NextResponse.json({ ok: true, idempotent: result.idempotent, booking: result.booking });
}
