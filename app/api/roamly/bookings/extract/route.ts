import { NextResponse } from "next/server";
import { extractBookingFromScreenshot } from "@/lib/roamly/bookings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

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
