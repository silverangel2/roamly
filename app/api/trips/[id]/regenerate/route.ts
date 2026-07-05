import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "ITINERARY_LOCKED",
      message: "Roamly itineraries cannot be regenerated. Create a new itinerary for major changes."
    },
    { status: 410 }
  );
}
