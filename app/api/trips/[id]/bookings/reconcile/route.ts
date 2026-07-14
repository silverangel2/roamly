import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { reconcileTripBookings } from "@/lib/roamly/brain/bookingReconciliation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const result = await reconcileTripBookings({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "TRIP_NOT_FOUND" ? 404 : 400 });
  }
  return NextResponse.json({ ok: true, reconciliation: result.output });
}
