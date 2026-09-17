import { NextResponse } from "next/server";
import { createBookingEvidenceToken, extractBookingFromScreenshot } from "@/lib/roamly/bookings";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const form = await request.formData().catch(() => null);
  const tripId = typeof form?.get("tripId") === "string" ? String(form.get("tripId")) : "";
  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Upload a booking screenshot." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Upload an image screenshot so Roamly can read it." }, { status: 400 });
  }

  const result = await extractBookingFromScreenshot(file);
  const evidenceToken = createBookingEvidenceToken({ userId: auth.user.id, tripId, booking: result.booking });
  if (!evidenceToken) return NextResponse.json({ ok: false, error: "Booking evidence signing is unavailable." }, { status: 503 });
  return NextResponse.json({ ok: true, booking: result.booking, evidenceToken, aiUsed: result.aiUsed });
}
