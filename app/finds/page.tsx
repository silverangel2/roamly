import type { Metadata } from "next";
import { FindsTabs, type FindsCard } from "@/components/roamly/FindsTabs";
import { getAmazonAffiliateConfig, amazonAffiliateDisclosure } from "@/lib/roamly/amazonAffiliate";
import { searchAmazonFindProducts } from "@/lib/roamly/amazonCreatorsApi";

export const metadata: Metadata = {
  title: "Roamly Finds",
  description: "A visual market for real travel gear and bookable experiences, with partner listings and current offers."
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
  const productResults = await searchAmazonFindProducts({ keywords: clean(search.q) || "travel essentials" });
  const cards: FindsCard[] = productResults.products.map((product) => ({
    id: `amazon-${product.id}`,
    title: product.title,
    eyebrow: product.merchant ? `Amazon · ${product.merchant}` : "Amazon · in stock when checked",
    description: "In stock when checked. Price, delivery, and seller details can change—confirm the latest offer on Amazon.",
    href: product.href,
    provider: "Amazon Associates",
    affiliate: true,
    category: "product",
    icon: "✦",
    action: product.deal ? "Shop this deal" : "View product",
    image: product.imageUrl,
    imageAlt: product.title,
    price: product.price,
    saving: product.saving,
    savingPercent: product.savingPercent,
    checkedAt: productResults.checkedAt
  }));
  const emptyMessage = productResults.status === "not_configured"
    ? "The live Amazon product catalog is not connected in this environment yet. Once authorized partner feeds are connected, this market can show genuine items, photos, current offers, and direct buy or book links. No sample listings are used."
    : productResults.status === "unavailable"
      ? "We couldn’t verify live Amazon offers just now, so we’re not showing stale or guessed listings. Please try again later."
      : "Amazon returned no in-stock items with a verified product photo and buy link for this search. Try another search.";

  return (
    <div className="min-h-[75vh] bg-[#f7f8f4] px-4 py-6 text-[#203c43] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <section className="relative isolate overflow-hidden rounded-[2rem] bg-[#eaf4ed] px-6 py-9 sm:px-10 sm:py-12 lg:px-14">
          <div aria-hidden="true" className="absolute -right-16 -top-24 -z-10 h-80 w-80 rounded-full bg-[#f4c85b]/40 blur-2xl" />
          <div aria-hidden="true" className="absolute bottom-[-8rem] right-[16%] -z-10 h-72 w-72 rounded-full bg-[#a8d8c2]/55 blur-2xl" />
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">The Roamly travel market</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl">Find the things that make the trip <span className="text-[#0f6e66]">unforgettable.</span></h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#536e65]">Shop useful travel gear, discover places to stay, and find experiences worth going for—all with real listings, real photos, and a clear path to the provider.</p>
          </div>

          <form action="/finds" className="mt-7 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white p-2 shadow-[0_18px_55px_rgba(39,88,80,0.12)] sm:max-w-3xl sm:flex-row">
            <label className="sr-only" htmlFor="finds-query">Search real travel products</label>
            <span aria-hidden="true" className="hidden items-center pl-3 text-xl text-[#8da49a] sm:flex">⌕</span>
            <input id="finds-query" name="q" defaultValue={search.q || ""} placeholder="Search bags, adapters, travel essentials…" maxLength={100} className="min-h-12 min-w-0 flex-1 rounded-xl px-3 text-sm text-[#203c43] outline-none placeholder:text-[#92a098] focus:ring-4 focus:ring-[#0f6e66]/10" />
            <button className="min-h-12 rounded-xl bg-[#0f6e66] px-6 text-sm font-extrabold text-white transition hover:bg-[#0e605a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25" type="submit">Find your gear <span aria-hidden="true" className="ml-1">→</span></button>
          </form>

          <nav aria-label="Shop by travel category" className="mt-5 flex flex-wrap gap-2">
            {[
              ["stays", "Places to stay", "⌂"],
              ["flights", "Flight deals", "✈"],
              ["activities", "Tickets & experiences", "✦"],
              ["amazon", "Travel gear", "◇"]
            ].map(([id, label, icon]) => <a key={id} href={`#finds-tab-${id}`} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/90 bg-white/75 px-4 text-xs font-extrabold text-[#31594f] shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md motion-reduce:transform-none"><span aria-hidden="true" className="text-sm text-[#0f6e66]">{icon}</span>{label}<span aria-hidden="true" className="text-[#8ba197]">→</span></a>)}
          </nav>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-[#557369]">
            <span><span className="mr-1.5 text-[#0f6e66]">✓</span>Real listings and item photos</span>
            <span><span className="mr-1.5 text-[#0f6e66]">✓</span>Current details from the source</span>
            <span><span className="mr-1.5 text-[#0f6e66]">✓</span>Checkout stays with the provider</span>
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
