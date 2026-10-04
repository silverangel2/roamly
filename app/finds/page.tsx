import type { Metadata } from "next";
import { FindsQuickBook } from "@/components/roamly/FindsQuickBook";
import { FindsTravelDeals } from "@/components/roamly/FindsTravelDeals";
import { FindsEditorialMagazine } from "@/components/roamly/FindsEditorialMagazine";
import { amazonFindCard } from "@/lib/roamly/findsMarketCore";
import { amazonAffiliateDisclosure } from "@/lib/roamly/amazonAffiliate";
import { searchAmazonFindProducts } from "@/lib/roamly/amazonCreatorsApi";
import { Stay22LetMeAllezScript } from "@/components/roamly/FindsCommercialWidgets";
import { curatedAmazonFindCards } from "@/lib/roamly/curatedAmazonFinds";
import { getActiveFindsPromo } from "@/lib/roamly/findsPromoStore";

export const metadata: Metadata = {
  title: "Roamly Finds — Travel Deals, Stays & Gear",
  description: "A visual collection of useful travel finds, beautiful stays, flight ideas, experiences, and essentials.",
  openGraph: {
    title: "Roamly Finds — travel deals, stays & gear",
    description: "Useful travel finds, beautiful stays, flight ideas, experiences, and essentials — curated by Roamly.",
    url: "https://roamlyhq.com/finds",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ destination?: string; q?: string }>;

function clean(value: string | undefined, maxLength = 100) {
  return (value || "").trim().slice(0, maxLength);
}

export default async function FindsPage({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const destination = clean(search.destination) || "your next somewhere";
  const productKeywords = clean(search.q) || (destination !== "your next somewhere" ? `${destination} travel essentials` : "travel essentials");
  const productResults = await searchAmazonFindProducts({ keywords: productKeywords });
  const activePromo = await getActiveFindsPromo();
  const cards = [
    ...productResults.products.map((product) => amazonFindCard(product, productResults.checkedAt)),
    ...curatedAmazonFindCards()
  ];

  return (
    <div className="min-h-[75vh] bg-[#fbfaf6] px-4 pb-12 pt-5 text-[#203c43] sm:px-8 sm:pb-16 sm:pt-8">
      <div className="mx-auto max-w-[1440px]">
        <Stay22LetMeAllezScript />
        <FindsQuickBook />
        <FindsTravelDeals />
        <FindsEditorialMagazine cards={cards} destination={destination} emptyMessage="No verified live listing is available for this section right now." disclosures={[amazonAffiliateDisclosure]} activePromo={activePromo} />
      </div>
    </div>
  );
}
