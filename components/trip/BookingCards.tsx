import { getBookingLinks } from "@/lib/affiliate-links";
import { affiliateDisclosure } from "@/lib/roamly/affiliateLinks";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { RoamlyTripRecord } from "@/lib/trips";
import { BookingCardsClient, type BookingCardLink } from "@/components/trip/BookingCardsClient";

function formatEstimate(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return "Search current prices before booking.";
  if (min != null && max != null) return `Estimated ${currency} ${min}-${max}. Verify current prices.`;
  return `Estimated ${currency} ${min ?? max}. Verify current prices.`;
}

export function BookingCards({ trip, itinerary }: { trip: RoamlyTripRecord; itinerary?: RoamlyItinerary | null }) {
  const destination = getTripDestinationLabel(trip) || "your destination";
  const suggestionLinks: BookingCardLink[] =
    itinerary?.booking_suggestions?.map((suggestion) => ({
      title: suggestion.title || suggestion.booking_label,
      label: suggestion.booking_category.replace("_", " "),
      description: suggestion.description || formatEstimate(suggestion.estimated_cost_min, suggestion.estimated_cost_max, suggestion.currency),
      href: suggestion.affiliate_url || suggestion.normal_search_url,
      booking_category: suggestion.booking_category,
      affiliate_enabled: Boolean(suggestion.affiliate_url),
      affiliate_provider: suggestion.affiliate_provider || "direct",
      affiliate_disclosure: suggestion.affiliate_disclosure || affiliateDisclosure
    })) || [];
  const links: BookingCardLink[] = suggestionLinks.length
    ? suggestionLinks
    : getBookingLinks(trip).map((link) => ({
        ...link,
        booking_category: link.booking_category
      }));

  return (
    <BookingCardsClient
      tripId={trip.id}
      destination={destination}
      links={links}
      showDisclosure={links.some((link) => link.affiliate_enabled) || suggestionLinks.length > 0}
    />
  );
}
