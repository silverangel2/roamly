import type { Metadata } from "next";
import { FindsQuickBook } from "@/components/roamly/FindsQuickBook";
import { FindsTravelDeals } from "@/components/roamly/FindsTravelDeals";
import { FindsTabs } from "@/components/roamly/FindsTabs";
import { amazonFindCard } from "@/lib/roamly/findsMarketCore";
import { amazonAffiliateDisclosure } from "@/lib/roamly/amazonAffiliate";
import { searchAmazonFindProducts } from "@/lib/roamly/amazonCreatorsApi";
import { Stay22LetMeAllezScript } from "@/components/roamly/FindsCommercialWidgets";
import { curatedAmazonFindCards } from "@/lib/roamly/curatedAmazonFinds";
import { getActiveFindsPromo } from "@/lib/roamly/findsPromoStore";

export const metadata: Metadata = {
  title: "Roamly Deals — Travel Deals, Stays & Gear",
  description: "A visual collection of useful travel deals, beautiful stays, flight ideas, experiences, and essentials.",
  alternates: { canonical: "https://roamlyhq.com/finds" },
  openGraph: {
    title: "Roamly Deals — travel deals, stays & gear",
    description: "Useful travel deals, beautiful stays, flight ideas, experiences, and essentials — curated by Roamly.",
    url: "https://roamlyhq.com/finds",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ destination?: string; q?: string; origin?: string; startDate?: string; endDate?: string }>;

function clean(value: string | undefined, maxLength = 100) {
  return (value || "").trim().slice(0, maxLength);
}

function cleanDate(value: string | undefined) {
  const candidate = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  return Number.isNaN(new Date(`${candidate}T12:00:00Z`).getTime()) ? "" : candidate;
}

// Mirrors travelpayoutsApiConfigured() in lib/roamly/travelMarketSearch.ts
// (not exported there): affiliates gate on + Travelpayouts provider +
// marker + API token. When false, the flight tool hands off to a real
// Aviasales partner search instead of querying the live feed.
function flightLiveSearchConfigured() {
  const gate = (process.env.ROAMLY_AFFILIATES_ENABLED || "").toLowerCase();
  if (gate === "false" || gate === "0" || gate === "disabled") return false;
  if ((process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER || "travelpayouts").toLowerCase() !== "travelpayouts") return false;
  return Boolean((process.env.ROAMLY_TRAVELPAYOUTS_MARKER || "").trim()) && Boolean((process.env.TRAVELPAYOUTS_API_TOKEN || "").trim());
}

export default async function FindsPage({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const destination = clean(search.destination) || "your next somewhere";
  const origin = clean(search.origin);
  const startDate = cleanDate(search.startDate);
  const endDate = cleanDate(search.endDate);
  const productKeywords = clean(search.q) || (destination !== "your next somewhere" ? `${destination} travel essentials` : "travel essentials");
  const productResults = await searchAmazonFindProducts({ keywords: productKeywords });
  const activePromo = await getActiveFindsPromo();
  const cards = [
    ...productResults.products.map((product) => amazonFindCard(product, productResults.checkedAt)),
    ...curatedAmazonFindCards()
  ];

  return (
    <div className="min-h-[75vh] bg-cbg px-4 pb-12 pt-5 text-chead sm:px-8 sm:pb-16 sm:pt-8">
      <div className="mx-auto max-w-[1440px]">
        <Stay22LetMeAllezScript />
        <FindsTabs cards={cards} destination={destination} origin={origin} startDate={startDate} endDate={endDate} disclosures={[amazonAffiliateDisclosure]} emptyMessage="No verified live listing is available for this section right now." activePromo={activePromo} flightLiveSearchConfigured={flightLiveSearchConfigured()} />
        <FindsQuickBook />
        <FindsTravelDeals />
      </div>
    </div>
  );
}
