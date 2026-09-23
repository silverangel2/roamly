import type { Metadata } from "next";
import { FindsTabs, type FindsCard } from "@/components/roamly/FindsTabs";
import { getAmazonAffiliateConfig, amazonAffiliateDisclosure } from "@/lib/roamly/amazonAffiliate";
import { searchAmazonFindProducts } from "@/lib/roamly/amazonCreatorsApi";

export const metadata: Metadata = {
  title: "Roamly Finds",
  description: "A visual collection of useful travel finds, beautiful stays, flight ideas, experiences, and essentials."
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ destination?: string; origin?: string; startDate?: string; endDate?: string; q?: string }>;

function clean(value: string | undefined, maxLength = 100) {
  return (value || "").trim().slice(0, maxLength);
}

function cleanDate(value: string | undefined) {
  const candidate = (value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? "" : candidate;
}

export default async function FindsPage({ searchParams }: { searchParams: SearchParams }) {
  const search = await searchParams;
  const destination = clean(search.destination) || "your next somewhere";
  const origin = clean(search.origin, 80);
  const startDate = cleanDate(search.startDate);
  const endDate = cleanDate(search.endDate);
  const amazonReady = getAmazonAffiliateConfig().enabled;
  const productKeywords = clean(search.q) || (destination !== "your next somewhere" ? `${destination} travel essentials` : "travel essentials");
  const productResults = await searchAmazonFindProducts({ keywords: productKeywords });
  const cards: FindsCard[] = productResults.products.map((product) => ({
    id: `amazon-${product.id}`,
    title: product.title,
    eyebrow: "Worth packing",
    description: "In stock when checked. Price, delivery, and seller details can change—confirm the latest offer before buying.",
    href: product.href,
    provider: "Amazon Associates",
    affiliate: true,
    category: "product",
    icon: "✦",
    action: product.deal ? "Check current offer" : "See the product",
    image: product.imageUrl,
    imageAlt: product.title,
    price: product.price,
    saving: product.saving,
    savingPercent: product.savingPercent,
    checkedAt: productResults.checkedAt
  }));
  const emptyMessage = productResults.status === "not_configured"
    ? "The live travel essentials catalog is not available right now. Genuine items, photos, current offers, and direct seller links will appear when they are available. No guessed listings are used."
    : productResults.status === "unavailable"
      ? "We couldn’t verify live travel essentials just now, so we’re not showing stale or guessed listings. Please try again later."
      : "No in-stock travel essentials with a verified product photo and buy link came back for this search. Try another search.";

  return (
    <div className="min-h-[75vh] bg-[#f7f8f4] px-4 py-6 text-[#203c43] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <section className="relative overflow-hidden rounded-[2rem] bg-[#eaf4ed] px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
          <div aria-hidden="true" className="absolute -right-16 -top-24 h-80 w-80 rounded-full bg-[#f4c85b]/35 blur-2xl" />
          <div className="relative max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">A travel magazine by Roamly</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">Go somewhere<br /><span className="text-[#0f6e66]">interesting.</span></h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#536e65]">Destination stories, useful things to pack, and real opportunities worth a closer look—quietly shaped around the trip you’re considering.</p>
            <a href="/plan" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 text-sm font-black text-white transition hover:bg-[#0e605a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">Plan a trip <span aria-hidden="true" className="ml-2">→</span></a>
          </div>
        </section>

        <FindsTabs cards={cards} destination={destination} origin={origin} startDate={startDate} endDate={endDate} emptyMessage={emptyMessage} disclosures={cards.length && amazonReady ? [amazonAffiliateDisclosure] : []} />
        <section className="mt-8 flex flex-col justify-between gap-4 rounded-[1.6rem] bg-[#e8f4ec] p-6 sm:flex-row sm:items-center sm:p-8">
          <div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[#0f6e66]">A little travel daydream</p><h2 className="mt-2 text-2xl font-black tracking-tight">Can you guess the city from three clues?</h2><p className="mt-2 text-sm text-[#5c716c]">A tiny daily puzzle. No account or booking required.</p></div>
          <a href="/play" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#b8d6ca] bg-white px-6 text-sm font-extrabold text-[#28665d] transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none">Play the city puzzle <span aria-hidden="true" className="ml-2">→</span></a>
        </section>
      </div>
    </div>
  );
}
