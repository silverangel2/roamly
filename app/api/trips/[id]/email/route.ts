import { NextRequest, NextResponse } from "next/server";
import { buildPreviewFromItinerary, formatMoney, getItineraryTotalEstimateAmount, type RoamlyItinerary } from "@/lib/itinerary";
import { translateExactText, type RoamlyLocale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n-server";
import { affiliateDisclosure } from "@/lib/roamly/affiliateLinks";
import { amazonAffiliateDisclosure, type RoamlyPreTripEssential } from "@/lib/roamly/amazonAffiliate";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";
import { describeBudgetBalanceFromAmounts, formatBudgetMoney } from "@/lib/roamly/budget";
import { getRoamlySupportEmail, isEmailConfigured, sendRoamlyEmail } from "@/lib/roamly/email";
import { ROAMLY_EMAIL_FOOTER_COPY, ROAMLY_PUBLIC_DOMAIN, toRoamlyAbsoluteUrl } from "@/lib/roamly/emailTemplates";
import { requireUser } from "@/lib/roamly/auth";
import {
  getTripBudgetAmount,
  getTripBudgetCurrency,
  getTripDestinationLabel,
  getTripOriginLabel,
  getTripPlanningMetadata
} from "@/lib/roamly/tripMetadata";
import { getLocalizedItinerary } from "@/lib/roamly/itineraryTranslations";
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

function tr(locale: RoamlyLocale, text: string) {
  return translateExactText(locale, text);
}

function plainDaySummary(
  days: Array<{ day_number: number; city?: string; title: string; morning: string; afternoon: string; evening: string }>,
  locale: RoamlyLocale
) {
  return days
    .map((day) =>
      [
        `${tr(locale, "Day")} ${day.day_number}${day.city ? ` - ${day.city}` : ""}: ${day.title}`,
        `${tr(locale, "Morning")}: ${day.morning}`,
        `${tr(locale, "Afternoon")}: ${day.afternoon}`,
        `${tr(locale, "Evening")}: ${day.evening}`
      ].join("\n")
    )
    .join("\n\n");
}

function bookingTitle(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  return suggestion.title || suggestion.booking_label || tr(locale, "Suggested option");
}

function bookingAction(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale = "en") {
  return suggestion.booking_label || tr(locale, "Find option");
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

function bookingEstimate(suggestion: RoamlyItinerary["booking_suggestions"][number], locale: RoamlyLocale) {
  const currency = suggestion.currency || "CAD";
  const min = suggestion.estimated_total_cost_min ?? suggestion.estimated_cost_min;
  const max = suggestion.estimated_total_cost_max ?? suggestion.estimated_cost_max;
  if (min == null && max == null) return tr(locale, "Estimated/search-ready option; verify current prices.");
  if (min != null && max != null) return `${tr(locale, "Estimated")} ${formatMoney(min, currency)}-${formatMoney(max, currency)}.`;
  return `${tr(locale, "Estimated")} ${formatMoney(min ?? max, currency)}.`;
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

function essentialActionLabel(item: RoamlyPreTripEssential, locale: RoamlyLocale) {
  const text = `${item.title} ${item.search_query}`.toLowerCase();
  if (/\bcarry[- ]?on\b|luggage/.test(text)) return tr(locale, "Find carry-on luggage");
  if (/packing cube/.test(text)) return tr(locale, "Find packing cubes");
  if (/adapter/.test(text)) return tr(locale, "Find travel adapter");
  return tr(locale, "Shop on Amazon");
}

function topPreTripEssentials(essentials?: RoamlyPreTripEssential[]) {
  return (essentials || []).slice(0, 8);
}

function renderItineraryEmail({
  title,
  destination,
  dates,
  summary,
  days,
  recommendations,
  essentials,
  budgetSummary,
  tripUrl,
  trip,
  locale
}: {
  title: string;
  destination: string;
  dates: string;
  summary: string;
  days: Array<{ day_number: number; city?: string; title: string; morning: string; afternoon: string; evening: string }>;
  recommendations: RoamlyItinerary["booking_suggestions"];
  essentials: RoamlyPreTripEssential[];
  budgetSummary: string;
  tripUrl: string;
  trip: RoamlyTripRecord;
  locale: RoamlyLocale;
}) {
  const supportEmail = getRoamlySupportEmail();
  const dayHtml = days
    .slice(0, 10)
    .map(
      (day) => `<section style="border-top:1px solid #e5edf3;padding:16px 0;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#0f8f9c;">${tr(locale, "Day")} ${day.day_number}${day.city ? ` - ${escapeHtml(day.city)}` : ""}</p>
        <h2 style="margin:0 0 10px;font-size:18px;line-height:1.25;color:#132033;">${escapeHtml(day.title)}</h2>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;"><strong>${tr(locale, "Morning")}:</strong> ${escapeHtml(day.morning)}</p>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;"><strong>${tr(locale, "Afternoon")}:</strong> ${escapeHtml(day.afternoon)}</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#526176;"><strong>${tr(locale, "Evening")}:</strong> ${escapeHtml(day.evening)}</p>
      </section>`
    )
    .join("");
  const essentialsHtml = essentials
    .map((item) => {
      const href = safeExternalUrl(item.amazon_url);
      const action = essentialActionLabel(item, locale);
      return `<section style="border-top:1px solid #e5edf3;padding:14px 0;">
        <p style="margin:0 0 5px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#0f8f9c;">[ ] ${escapeHtml(tr(locale, item.category))} - ${escapeHtml(tr(locale, item.priority))} ${escapeHtml(tr(locale, "priority"))}</p>
        <h2 style="margin:0 0 8px;font-size:17px;line-height:1.25;color:#132033;">${escapeHtml(item.title)}</h2>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#526176;">${escapeHtml(item.reason)}</p>
        ${href ? `<a href="${escapeHtml(href)}" style="font-size:13px;font-weight:900;color:#0f8f9c;text-decoration:none;">${escapeHtml(action)}</a>` : `<p style="margin:0;font-size:13px;font-weight:900;color:#7a8798;">${escapeHtml(tr(locale, "Amazon search link unavailable"))}</p>`}
      </section>`;
    })
    .join("");
  const bookingHtml = recommendations
    .map((suggestion) => {
      const href = bookingHref(suggestion, trip);
      const action = `${tr(locale, "Search")}: ${bookingAction(suggestion, locale)}`;
      return `<section style="border-top:1px solid #e5edf3;padding:14px 0;">
        <p style="margin:0 0 5px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#0f8f9c;">${escapeHtml(tr(locale, suggestion.category || suggestion.booking_category))}</p>
        <h2 style="margin:0 0 8px;font-size:17px;line-height:1.25;color:#132033;">${escapeHtml(bookingTitle(suggestion, locale))}</h2>
        <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#526176;">${escapeHtml(suggestion.description || suggestion.why_recommended || tr(locale, "Search current availability before booking."))}</p>
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#526176;">${escapeHtml(bookingEstimate(suggestion, locale))}</p>
        ${href ? `<a href="${escapeHtml(href)}" style="font-size:13px;font-weight:900;color:#0f8f9c;text-decoration:none;">${escapeHtml(action)}</a>` : `<p style="margin:0;font-size:13px;font-weight:900;color:#7a8798;">${escapeHtml(tr(locale, "Search link unavailable"))}</p>`}
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f7fcff;font-family:Arial,sans-serif;color:#132033;">
    <main style="max-width:680px;margin:0 auto;padding:24px;">
      <header style="padding:8px 8px 18px;">
        <a href="${escapeHtml(ROAMLY_PUBLIC_DOMAIN)}" style="display:inline-flex;align-items:center;gap:10px;color:#102033;text-decoration:none;">
          <span style="display:inline-grid;width:40px;height:40px;place-items:center;border-radius:14px;background:#54d6c6;color:#102033;font-size:21px;font-weight:900;">R</span>
          <span style="font-size:24px;font-weight:900;letter-spacing:0;color:#102033;">Roamly</span>
        </a>
      </header>
      <section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:28px;box-shadow:0 18px 45px rgba(31,45,61,0.10);">
        <p style="margin:0 0 14px;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#0aa6a6;">${escapeHtml(tr(locale, "Roamly itinerary"))}</p>
        <h1 style="margin:0;font-size:30px;line-height:1.08;color:#132033;">${escapeHtml(title)}</h1>
        <p style="margin:12px 0 0;font-size:15px;font-weight:700;color:#526176;">${escapeHtml(destination)}${dates ? ` · ${escapeHtml(dates)}` : ""}</p>
        <p style="margin:18px 0 0;font-size:15px;line-height:1.65;color:#526176;">${escapeHtml(summary)}</p>
        ${budgetSummary ? `<p style="margin:14px 0 0;font-size:14px;font-weight:900;color:#132033;">${escapeHtml(budgetSummary)}</p>` : ""}
        <a href="${escapeHtml(tripUrl)}" style="display:inline-block;margin-top:20px;background:#0f8f9c;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 18px;font-weight:900;">${escapeHtml(tr(locale, "Open trip in Roamly"))}</a>
      </section>
      <section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:24px;margin-top:18px;">
        ${dayHtml}
      </section>
      ${
        essentialsHtml
          ? `<section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:24px;margin-top:18px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#0aa6a6;">${escapeHtml(tr(locale, "Pre-trip essentials checklist"))}</p>
        ${essentialsHtml}
        <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#7a8798;">${escapeHtml(tr(locale, "Amazon prices are not shown in Roamly. Verify price and availability on Amazon."))} ${escapeHtml(tr(locale, amazonAffiliateDisclosure))}</p>
      </section>`
          : ""
      }
      ${
        bookingHtml
          ? `<section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:24px;margin-top:18px;">
        <p style="margin:0 0 12px;font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#0aa6a6;">${escapeHtml(tr(locale, "Top booking recommendations"))}</p>
        ${bookingHtml}
        <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#7a8798;">${escapeHtml(tr(locale, "Suggested options are search-ready planning recommendations, not completed bookings. Estimated prices may change before booking."))} ${escapeHtml(tr(locale, affiliateDisclosure))}</p>
      </section>`
          : ""
      }
      <footer style="padding:18px 8px 0;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#7a8798;">${escapeHtml(tr(locale, "PDF export is available from the trip page."))} ${escapeHtml(tr(locale, "Generated by Roamly."))}</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#7a8798;">${escapeHtml(ROAMLY_EMAIL_FOOTER_COPY)}</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#7a8798;">Need help? Reply to this email or contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#0f8f9c;font-weight:900;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#7a8798;"><a href="${escapeHtml(ROAMLY_PUBLIC_DOMAIN)}" style="color:#0f8f9c;font-weight:900;text-decoration:none;">roamlyhq.com</a></p>
      </footer>
    </main>
  </body>
</html>`;

  const bookingText = recommendations.length
    ? `\n\n${tr(locale, "Top booking recommendations")} (${tr(locale, "verify price and availability before booking")}):\n${recommendations
        .map((suggestion) =>
          [
            `${tr(locale, suggestion.category || suggestion.booking_category)}: ${bookingTitle(suggestion, locale)}`,
            bookingEstimate(suggestion, locale),
            `${tr(locale, "Search")}: ${bookingAction(suggestion, locale)}`
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n")}\n\n${tr(locale, "Suggested options are search-ready planning recommendations, not completed bookings. Estimated prices may change before booking.")} ${tr(locale, "Open the trip page for search links.")} ${tr(locale, affiliateDisclosure)}`
    : "";
  const essentialsText = essentials.length
    ? `\n\n${tr(locale, "Pre-trip essentials checklist")}:\n${essentials
        .map((item) =>
          [
            `[ ] ${tr(locale, item.priority)} - ${tr(locale, item.category)}: ${item.title}`,
            item.reason,
            `${essentialActionLabel(item, locale)}: ${item.amazon_url}`
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n")}\n\n${tr(locale, "Amazon prices are not shown in Roamly. Verify price and availability on Amazon.")} ${tr(locale, amazonAffiliateDisclosure)}`
    : "";
  const text = `${title}\n${destination}${dates ? ` - ${dates}` : ""}${budgetSummary ? `\n${budgetSummary}` : ""}\n\n${summary}\n\n${plainDaySummary(days, locale)}${essentialsText}${bookingText}\n\n${tr(locale, "Open trip")}: ${tripUrl}\n${tr(locale, "PDF export is available from the trip page.")}\n\n${tr(locale, "Generated by Roamly.")}\n\n${ROAMLY_EMAIL_FOOTER_COPY}\nNeed help? Reply to this email or contact ${supportEmail}.\n${ROAMLY_PUBLIC_DOMAIN}`;
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
  const locale = getRequestLocale(request, getString(body.language));
  const to = getString(body.to);
  if (!to) {
    return NextResponse.json({ ok: false, error: tr(locale, "Recipient email is required.") }, { status: 400 });
  }

  const bundleResult = await getTripBundle(auth.supabase, auth.user.id, id);
  if (!bundleResult.data) {
    if (isMissingTableError(bundleResult.error)) {
      return NextResponse.json({ ok: false, error: tr(locale, "Trip tables are not ready.") }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: tr(locale, "Trip not found.") }, { status: 404 });
  }

  const config = isEmailConfigured();
  if (!config.configured) {
    return NextResponse.json(
      {
        ok: false,
        result: { status: "skipped" },
        message: tr(locale, "Email sending is not configured yet. You can export the PDF or copy the trip link.")
      },
      { status: 202 }
    );
  }

  const { trip, itinerary } = bundleResult.data;
  const baseFull = itinerary?.full_json;
  const full = baseFull ? getLocalizedItinerary({ metadata: trip.metadata, baseItinerary: baseFull, locale }).itinerary : null;
  if (!full) {
    return NextResponse.json({ ok: false, error: tr(locale, "Generate and lock this itinerary before emailing it.") }, { status: 400 });
  }

  const preview = buildPreviewFromItinerary(full);
  const title = full.trip_title || preview.trip_title || trip.title || getTripDestinationLabel(trip) || "Roamly trip";
  const destination = getTripDestinationLabel(trip) || full.destination_summary || "Your trip";
  const dates = formatDateRange(trip.start_date, trip.end_date);
  const tripUrl = toRoamlyAbsoluteUrl(`/trip/${id}`);
  const currency = getTripBudgetCurrency(trip);
  const tripBudgetAmount = getTripBudgetAmount(trip);
  const totalEstimateAmount = getItineraryTotalEstimateAmount(full);
  const balance = describeBudgetBalanceFromAmounts(tripBudgetAmount, totalEstimateAmount, currency);
  const budgetSummary = [
    tripBudgetAmount ? `${tr(locale, "Budget")} ${formatBudgetMoney(tripBudgetAmount, currency)}` : "",
    totalEstimateAmount == null ? "" : `${tr(locale, "Estimate")} ${formatBudgetMoney(totalEstimateAmount, currency)}`,
    balance ? `${tr(locale, balance.label)}: ${balance.value}` : ""
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
    essentials: topPreTripEssentials(full.pre_trip_essentials),
    budgetSummary,
    tripUrl,
    trip,
    locale
  });

  const result = await sendRoamlyEmail({
    to,
    subject: `${tr(locale, "Roamly itinerary")}: ${title}`,
    html: rendered.html,
    text: rendered.text,
    userId: auth.user.id,
    tripId: id,
    metadata: { type: "itinerary_email", template: "itinerary_email", source: "trip_page" }
  });

  const message =
    result.status === "skipped"
      ? tr(locale, "Email sending is not configured yet. You can export the PDF or copy the trip link.")
      : result.ok
        ? tr(locale, "Itinerary email sent.")
        : result.error || tr(locale, "Could not send itinerary email.");

  return NextResponse.json({ ok: result.ok, result, message }, { status: result.ok ? 200 : result.status === "skipped" ? 202 : 400 });
}
