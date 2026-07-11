import { getBookingLinks } from "@/lib/affiliate-links";
import { affiliateDisclosure } from "@/lib/roamly/affiliateLinks";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { RoamlyTripRecord } from "@/lib/trips";

function formatEstimate(min: number | null, max: number | null, currency: string) {
  if (min == null && max == null) return "Search current prices before booking.";
  if (min != null && max != null) return `Estimated ${currency} ${min}-${max}. Verify live prices.`;
  return `Estimated ${currency} ${min ?? max}. Verify live prices.`;
}

export function BookingCards({ trip, itinerary }: { trip: RoamlyTripRecord; itinerary?: RoamlyItinerary | null }) {
  const suggestionLinks =
    itinerary?.booking_suggestions?.map((suggestion) => ({
      title: suggestion.booking_label,
      label: suggestion.booking_category.replace("_", " "),
      description: formatEstimate(suggestion.estimated_cost_min, suggestion.estimated_cost_max, suggestion.currency),
      href: suggestion.affiliate_url || suggestion.normal_search_url,
      affiliate_enabled: Boolean(suggestion.affiliate_url),
      affiliate_provider: suggestion.affiliate_provider || "direct",
      affiliate_disclosure: suggestion.affiliate_disclosure || affiliateDisclosure
    })) || [];
  const links = suggestionLinks.length ? suggestionLinks : getBookingLinks(trip);

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <a
          key={link.title}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-ocean/40"
        >
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{link.label}</p>
          <h3 className="mt-2 text-lg font-black text-ink">{link.title}</h3>
          <p className="mt-2 text-sm font-bold leading-5 text-slate-500">{link.description}</p>
          <p className="mt-3 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
            {link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Direct search link"}
          </p>
        </a>
      ))}
      {links.some((link) => link.affiliate_enabled) || suggestionLinks.length ? (
        <p className="sm:col-span-2 lg:col-span-3 rounded-2xl bg-mist px-4 py-3 text-xs font-bold leading-5 text-slate-500">
          {links[0]?.affiliate_disclosure}
        </p>
      ) : null}
    </section>
  );
}
