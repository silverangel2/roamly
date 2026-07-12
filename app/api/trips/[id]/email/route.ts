import { NextRequest, NextResponse } from "next/server";
import { buildPreviewFromItinerary, formatMoney, getItineraryTotalEstimateAmount, type RoamlyItinerary } from "@/lib/itinerary";
import { affiliateDisclosure } from "@/lib/roamly/affiliateLinks";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import { isEmailConfigured, sendRoamlyEmail } from "@/lib/roamly/email";
import { requireUser } from "@/lib/roamly/auth";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { getTripBundle, isMissingTableError, type RoamlyTripRecord } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value?: string | null) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainDaySummary(days: Array<{ day_number: number; city?: string; title: string; morning: string; afternoon: string; evening: string }>) {
  return days
    .map((day) =>
      [
        `Day ${day.day_number}${day.city ? ` - ${day.city}` : ""}: ${day.title}`,
        `Morning: ${day.morning}`,
        `Afternoon: ${day.afternoon}`,
        `Evening: ${day.evening}`
      ].join("\n")
    )
    .join("\n\n");
}

function bookingTitle(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.title || suggestion.booking_label || "Suggested option";
}

function bookingAction(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return suggestion.booking_label || "Find option";
}

function getPositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function tripTravelerDetails(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  const travelers = getRecord(planning.travelers);
  return {
    adults:
      getPositiveNumber(travelers.adults) ||
      getPositiveNumber(planning.travelersCount) ||
      getPositiveNumber(trip.travelers_count) ||
      1,
    children: getPositiveNumber(travelers.children) || 0,
    infants: getPositiveNumber(travelers.infants) || 0
  };
}

function tripRooms(trip: RoamlyTripRecord) {
  const planning = getTripPlanningMetadata(trip.metadata);
  return getPositiveNumber(planning.rooms) || 1;
}

function bookingHref(suggestion: RoamlyItinerary["booking_suggestions"][number], trip: RoamlyTripRecord) {
  const affiliate = safeExternalUrl(suggestion.affiliate_url);
  if (affiliate) return affiliate;
  const normal = safeExternalUrl(suggestion.normal_search_url);
  if (normal) return normal;

  const category = suggestion.category || suggestion.booking_category;
  const travelers = tripTravelerDetails(trip);
  const destination = suggestion.destination || suggestion.city || getTripDestinationLabel(trip) || "";
  const startDate = suggestion.departure_date || suggestion.date || trip.start_date || "";
  const endDate = suggestion.return_date || trip.end_date || "";
  const origin = suggestion.origin || getTripOriginLabel(trip) || "";

  if (category === "flight") {
    return safeExternalUrl(
      buildFlightSearchUrl({
        origin,
        destination,
        departureDate: startDate,
        returnDate: endDate,
        travelers
      })
    );
  }
  if (category === "hotel") {
    return safeExternalUrl(
      buildHotelSearchUrl({
        destination,
        checkInDate: trip.start_date,
        checkOutDate: trip.end_date,
        adults: travelers.adults,
        children: travelers.children,
        rooms: tripRooms(trip),
        neighborhood: suggestion.neighborhood || suggestion.location,
        roomType: suggestion.room_type
      })
    );
  }
  if (category === "attraction") {
    return safeExternalUrl(buildAttractionTicketSearchUrl({ attractionName: bookingTitle(suggestion), destination, date: suggestion.date || startDate }));
  }
  if (category === "tour") {
    return safeExternalUrl(buildTourSearchUrl({ tourName: bookingTitle(suggestion), destination, date: suggestion.date || startDate }));
  }
  if (category === "transport" || category === "car_rental") {
    return safeExternalUrl(
      buildTransportSearchUrl({
        origin,
        destination: suggestion.destination || suggestion.location || destination || bookingTitle(suggestion),
        date: startDate
      })
    );
  }
  return "";
}

function bookingEstimate(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const currency = suggestion.currency || "CAD";
  const min = suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min;
  const max = suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max;
  if (min == null && max == null) return "Estimated/search-ready option; verify current prices.";
  if (min != null && max != null) return `Estimated ${formatMoney(min, currency)}-${formatMoney(max, currency)}.`;
  return `Estimated ${formatMoney(min ?? max, currency)}.`;
}

function topBookingRecommendations(suggestions: RoamlyItinerary["booking_suggestions"]) {
  const priority = ["flight", "hotel", "attraction", "tour", "transport"];
  const picked: RoamlyItinerary["booking_suggestions"] = [];
  for (const category of priority) {
    const match = suggestions.find((item) => (item.category || item.booking_category) === category);
    if (match) picked.push(match);
  }
  return picked.slice(0, 6);
}

function renderItineraryEmail({
  title,
  destination,
  dates,
  summary,
  days,
  recommendations,
  budgetSummary,
  tripUrl,
  trip
}: {
  title: string;
  destination: string;
  dates: string;
  summary: string;
  days: Array<{ day_number: number; city?: string; title: string; morning: string; afternoon: string; evening: string }>;
  recommendations: RoamlyItinerary["booking_suggestions"];
  budgetSummary: string;
  tripUrl: string;
  trip: RoamlyTripRecord;
}) {
  const dayHtml = days
    .slice(0, 10)
    .map(
      (day) => `<section style="border-top:1px solid #e5edf3;padding:16px 0;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#0f8f9c;">Day ${day.day_number}${day.city ? ` - ${escapeHtml(day.city)}` : ""}</p>
        <h2 style="margin:0 0 10px;font-size:18px;line-height:1.25;color:#132033;">${escapeHtml(day.title)}</h2>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;"><strong>Morning:</strong> ${escapeHtml(day.morning)}</p>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;"><strong>Afternoon:</strong> ${escapeHtml(day.afternoon)}</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#526176;"><strong>Evening:</strong> ${escapeHtml(day.evening)}</p>
      </section>`
    )
    .join("");
  const bookingHtml = recommendations
    .map((suggestion) => {
      const href = bookingHref(suggestion, trip);
      const action = `Search: ${bookingAction(suggestion)}`;
      return `<section style="border-top:1px solid #e5edf3;padding:14px 0;">
        <p style="margin:0 0 5px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#0f8f9c;">${escapeHtml(suggestion.category || suggestion.booking_category)}</p>
        <h2 style="margin:0 0 8px;font-size:17px;line-height:1.25;color:#132033;">${escapeHtml(bookingTitle(suggestion))}</h2>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;">${escapeHtml(suggestion.description || suggestion.why_recommended || "Search current availability before booking.")}</p>
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#526176;">${escapeHtml(bookingEstimate(suggestion))}</p>
        ${href ? `<a href="${escapeHtml(href)}" style="font-size:13px;font-weight:900;color:#0f8f9c;text-decoration:none;">${escapeHtml(action)}</a>` : `<p style="margin:0;font-size:13px;font-weight:900;color:#7a8798;">Search link unavailable</p>`}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f7fcff;font-family:Arial,sans-serif;color:#132033;">
    <main style="max-width:680px;margin:0 auto;padding:24px;">
      <section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:28px;box-shadow:0 18px 45px rgba(31,45,61,0.10);">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#0aa6a6;">Roamly itinerary</p>
        <h1 style="margin:0;font-size:30px;line-height:1.08;color:#132033;">${escapeHtml(title)}</h1>
        <p style="margin:12px 0 0;font-size:15px;font-weight:700;color:#526176;">${escapeHtml(destination)}${dates ? ` · ${escapeHtml(dates)}` : ""}</p>
        <p style="margin:18px 0 0;font-size:15px;line-height:1.65;color:#526176;">${escapeHtml(summary)}</p>
        ${budgetSummary ? `<p style="margin:14px 0 0;font-size:14px;font-weight:900;color:#132033;">${escapeHtml(budgetSummary)}</p>` : ""}
        <a href="${escapeHtml(tripUrl)}" style="display:inline-block;margin-top:20px;background:#0f8f9c;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 18px;font-weight:900;">Open trip in Roamly</a>
      </section>
      <section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:24px;margin-top:18px;">
        ${dayHtml}
      </section>
      ${
        bookingHtml
          ? `<section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:24px;margin-top:18px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#0aa6a6;">Top booking recommendations</p>
        ${bookingHtml}
        <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#7a8798;">Suggested options are search-ready planning recommendations, not completed bookings. Estimated prices may change before booking. ${escapeHtml(affiliateDisclosure)}</p>
      </section>`
          : ""
      }
      <p style="margin:18px 8px 0;font-size:12px;line-height:1.6;color:#7a8798;">PDF export is available from the trip page. Generated by Roamly.</p>
    </main>
  </body>
</html>`;

  const bookingText = recommendations.length
    ? `\n\nTop booking recommendations (verify price and availability before booking):\n${recommendations
        .map((suggestion) =>
          [
            `${suggestion.category || suggestion.booking_category}: ${bookingTitle(suggestion)}`,
            bookingEstimate(suggestion),
            `Search: ${bookingAction(suggestion)}`
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n")}\n\nSuggested options are search-ready planning recommendations, not completed bookings. Estimated prices may change before booking. Open the trip page for search links. ${affiliateDisclosure}`
    : "";
  const text = `${title}\n${destination}${dates ? ` - ${dates}` : ""}${budgetSummary ? `\n${budgetSummary}` : ""}\n\n${summary}\n\n${plainDaySummary(days)}${bookingText}\n\nOpen trip: ${tripUrl}\nPDF export is available from the trip page.\n\nGenerated by Roamly.`;
  return { html, text };
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "";
  return [start, end].filter(Boolean).join(" to ");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = getString(body.to);
  if (!to) {
    return NextResponse.json({ ok: false, error: "Recipient email is required." }, { status: 400 });
  }

  const bundleResult = await getTripBundle(auth.supabase, auth.user.id, id);
  if (!bundleResult.data) {
    if (isMissingTableError(bundleResult.error)) {
      return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const config = isEmailConfigured();
  if (!config.configured) {
    return NextResponse.json(
      {
        ok: false,
        result: { status: "skipped" },
        message: "Email sending is not configured yet. You can export the PDF or copy the trip link."
      },
      { status: 202 }
    );
  }

  const { trip, itinerary } = bundleResult.data;
  const full = itinerary?.full_json;
  if (!full) {
    return NextResponse.json({ ok: false, error: "Generate and lock this itinerary before emailing it." }, { status: 400 });
  }

  const preview = buildPreviewFromItinerary(full);
  const title = trip.title || preview.trip_title || full.trip_title;
  const destination = getTripDestinationLabel(trip) || full.destination_summary || "Your trip";
  const dates = formatDateRange(trip.start_date, trip.end_date);
  const tripUrl = `${request.nextUrl.origin}/trip/${id}`;
  const currency = getTripBudgetCurrency(trip);
  const tripBudgetAmount = getTripBudgetAmount(trip);
  const totalEstimateAmount = getItineraryTotalEstimateAmount(full);
  const balance = describeBudgetBalanceFromAmounts(tripBudgetAmount, totalEstimateAmount, currency);
  const budgetSummary = [
    tripBudgetAmount ? `Budget ${formatBudgetMoney(tripBudgetAmount, currency)}` : "",
    totalEstimateAmount == null ? "" : `Estimate ${formatBudgetMoney(totalEstimateAmount, currency)}`,
    balance?.text || ""
  ]
    .filter(Boolean)
    .join(" · ");
  const rendered = renderItineraryEmail({
    title,
    destination,
    dates,
    summary: full.destination_summary,
    days: full.daily_itinerary,
    recommendations: topBookingRecommendations(full.booking_suggestions || []),
    budgetSummary,
    tripUrl,
    trip
  });

  const result = await sendRoamlyEmail({
    to,
    subject: `Roamly itinerary: ${title}`,
    html: rendered.html,
    text: rendered.text,
    userId: auth.user.id,
    tripId: id,
    metadata: { type: "trip_itinerary_share", source: "trip_page" }
  });

  const message =
    result.status === "skipped"
      ? "Email sending is not configured yet. You can export the PDF or copy the trip link."
      : result.ok
        ? "Itinerary email sent."
        : result.error || "Could not send itinerary email.";

  return NextResponse.json({ ok: result.ok, result, message }, { status: result.ok ? 200 : result.status === "skipped" ? 202 : 400 });
}
