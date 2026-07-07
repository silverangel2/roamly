import { NextResponse } from "next/server";
import { extractBookingFromScreenshot } from "@/lib/roamly/bookings";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Upload a booking screenshot." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Upload an image screenshot so Roamly can read it." }, { status: 400 });
  }

  const result = await extractBookingFromScreenshot(file);
  return NextResponse.json({ ok: true, booking: result.booking, aiUsed: result.aiUsed });
}
