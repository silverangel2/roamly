import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "ITINERARY_LOCKED",
      message: "Live Trip Companion can record progress, but it cannot rebuild a locked itinerary."
    },
    { status: 410 }
  );
}
