import type { RoamlyTripRecord } from "@/lib/trips";

function query(destination: string, topic: string) {
  return encodeURIComponent(`${destination} ${topic}`);
}

export function getBookingLinks(trip: Pick<RoamlyTripRecord, "destination" | "budget_currency">) {
  return [
    {
      title: "Hotels near your best area",
      label: "Search hotels",
      description: "Open a hotel search near the recommended neighborhoods.",
      href: `https://www.booking.com/searchresults.html?ss=${query(trip.destination, "hotels")}`
    },
    {
      title: "Tours and activities",
      label: "Search tours",
      description: "Find bookable activities that match the itinerary theme.",
      href: `https://www.viator.com/searchResults/all?text=${query(trip.destination, "activities tours")}`
    },
    {
      title: "Transport options",
      label: "Search transport",
      description: "Check transit, rideshare, rail, and airport transfer options.",
      href: `https://www.google.com/search?q=${query(trip.destination, "transport airport transit")}`
    },
    {
      title: "Travel insurance",
      label: "Compare options",
      description: "Use this as a reminder to compare coverage before you go.",
      href: `https://www.google.com/search?q=${query(trip.destination, "travel insurance")}`
    }
  ];
}
