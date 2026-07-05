import { NextRequest, NextResponse } from "next/server";
import {
  buildBudgetConstraintForItinerary,
  discoverTripPrices,
  savePriceDiscovery
} from "@/lib/roamly/priceDiscovery";
import { getConfirmedBookingCostCents } from "@/lib/roamly/bookings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const destination = getString(body.destination);
  if (!destination) return NextResponse.json({ ok: false, error: "Destination is required." }, { status: 400 });

  const tripId = getString(body.tripId) || null;
  let committedBudgetCents = 0;
  if (tripId) {
    const cost = await getConfirmedBookingCostCents(supabase, data.user.id, tripId);
    committedBudgetCents = cost.amountCents;
  }

  const input = {
    userId: data.user.id,
    tripId,
    origin: getString(body.origin),
    destination,
    startDate: getString(body.startDate),
    endDate: getString(body.endDate),
    daysCount: getNumber(body.daysCount),
    travelersCount: getNumber(body.travelersCount),
    budgetAmount: getNumber(body.budgetAmount),
    budgetCurrency: getString(body.budgetCurrency) || "CAD",
    budgetIncludesFlights: body.budgetIncludesFlights !== false,
    budgetIncludesHotel: body.budgetIncludesHotel !== false,
    committedBudgetCents,
    accommodationPreference: getString(body.accommodationPreference),
    travelStyle: getString(body.travelStyle),
    interests: Array.isArray(body.interests) ? body.interests.filter((item): item is string => typeof item === "string") : []
  };

  const discovery = await discoverTripPrices(input);
  const saved = await savePriceDiscovery(supabase, input, discovery);

  if (saved.error) {
    return NextResponse.json(
      { ok: false, error: saved.error, setupHint: "Run the Roamly budget/booking/companion migration." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    discoveryId: saved.id,
    discovery,
    budgetConstraint: buildBudgetConstraintForItinerary(discovery)
  });
}
