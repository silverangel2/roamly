import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { extractBookingFromScreenshot } from "@/lib/roamly/bookings";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function mapBookingType(value: string) {
  if (value === "flight" || value === "hotel" || value === "restaurant") return value;
  if (value === "attraction" || value === "event") return "activity";
  return "other";
}

function firstMatch(text: string, pattern: RegExp) {
  return clean(text.match(pattern)?.[1] || "");
}

function isoDateHint(text: string) {
  return firstMatch(text, /\b(\d{4}-\d{2}-\d{2})\b/);
}

function airportHints(text: string) {
  const matches = [...text.matchAll(/\b([A-Z]{3})\b/g)].map((match) => match[1]);
  return {
    origin: matches[0] || "",
    destination: matches[1] || ""
  };
}

function pdfText(buffer: Buffer) {
  return buffer
    .toString("latin1")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 12000);
}

async function extractPdfBooking(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const text = pdfText(buffer);
  const flightNumber = firstMatch(text, /\b([A-Z]{2}\s?\d{1,4})\b/);
  const confirmationCode = firstMatch(text, /\b(?:confirmation|booking|reservation)\s*(?:code|number|#)?\s*[:#-]?\s*([A-Z0-9-]{5,12})\b/i);
  const hotelName = firstMatch(text, /\b(?:hotel|property)\s*[:#-]?\s*([A-Za-z0-9 .'-]{4,80})/i);
  const airports = airportHints(text);
  const bookingType = flightNumber ? "flight" : hotelName ? "hotel" : "other";

  return {
    bookingType,
    provider: hotelName || "",
    title: hotelName || (flightNumber ? `Flight ${flightNumber}` : file.name.replace(/\.pdf$/i, "")),
    confirmationCode,
    startDate: isoDateHint(text),
    endDate: "",
    origin: airports.origin,
    destination: airports.destination,
    address: "",
    flightNumber,
    confidence: "low" as const
  };
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const ownership = await auth.supabase.from("roamly_trips").select("id").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (ownership.error) return NextResponse.json({ ok: false, error: ownership.error.message }, { status: 500 });
  if (!ownership.data) return NextResponse.json({ ok: false, error: "Trip access denied." }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Choose a booking file." }, { status: 400 });
  }

  if (file.type.startsWith("image/")) {
    const result = await extractBookingFromScreenshot(file);
    const booking = result.booking;
    return NextResponse.json({
      ok: true,
      aiUsed: result.aiUsed,
      booking: {
        bookingType: mapBookingType(booking.booking_type),
        provider: booking.provider_name,
        title: booking.title,
        confirmationCode: booking.confirmation_number,
        startDate: booking.start_date,
        endDate: booking.end_date,
        origin: "",
        destination: "",
        address: booking.address,
        confidence: booking.extraction_confidence
      }
    });
  }

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({
      ok: true,
      aiUsed: false,
      booking: await extractPdfBooking(file),
      message: "Review the fields before saving."
    });
  }

  return NextResponse.json({ ok: false, message: "Upload a screenshot or PDF confirmation." }, { status: 400 });
}
