"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FindsCard } from "@/lib/roamly/findsMarketCore";

type DestinationStory = {
  city: string;
  country: string;
  title: string;
  dek: string;
  images: string[];
};

const destinationStories: DestinationStory[] = [
  {
    city: "Japan",
    country: "Tokyo · Osaka · Nara",
    title: "Japan after dark",
    dek: "Small ramen counters, neon alleys and late-night neighborhoods made for wandering.",
    images: ["/roamly-puzzle-commons/tokyo-japan.jpg", "/roamly-puzzle-commons/osaka-japan.jpg", "/roamly-puzzle-commons/nara-japan.jpg"]
  },
  {
    city: "Montréal",
    country: "Canada",
    title: "A weekend in Montréal",
    dek: "Old streets, warm cafés and a mountain view that makes a short escape feel longer.",
    images: ["/roamly-puzzle-commons/montreal-canada.jpg"]
  },
  {
    city: "Kotor",
    country: "Montenegro · Croatia",
    title: "The Adriatic, slowly",
    dek: "Stone lanes, blue water and the kind of coastline that rewards an unhurried day.",
    images: ["/roamly-puzzle-commons/kotor-montenegro.jpg", "/roamly-puzzle-commons/dubrovnik-croatia.jpg", "/roamly-puzzle-commons/split-croatia.jpg"]
  },
  {
    city: "Cape Town",
    country: "South Africa",
    title: "Cape Town, slowly",
    dek: "A city of ocean air, mountain light and days that reward leaving room for detours.",
    images: ["/roamly-puzzle-commons/cape-town-south-africa.jpg"]
  },
  {
    city: "Vietnam",
    country: "Hanoi · Hoi An · Ha Long Bay",
    title: "Vietnam in layers",
    dek: "Morning coffee, busy lanes and a city that keeps revealing another layer around the corner.",
    images: ["/roamly-puzzle-commons/hanoi-vietnam.jpg", "/roamly-puzzle-commons/hoi-an-vietnam.jpg", "/roamly-puzzle-commons/ha-long-bay-vietnam.jpg"]
  }
];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function storyFor(destination: string) {
  const requested = normalize(destination);
  return destinationStories.find((story) => requested && requested !== "your next somewhere" && (requested.includes(normalize(story.city)) || normalize(story.city).includes(requested) || normalize(story.country).includes(requested))) || destinationStories[0];
}

function PhotoStory({ story, feature = false }: { story: DestinationStory; feature?: boolean }) {
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!autoPlay || reducedMotion || story.images.length < 2) return;
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % story.images.length), 6500);
    return () => window.clearInterval(timer);
  }, [autoPlay, reducedMotion, story.images.length]);

  const move = (direction: number) => {
    setAutoPlay(false);
    setSlide((current) => (current + direction + story.images.length) % story.images.length);
  };

  return <article className={`group relative overflow-hidden rounded-[2rem] bg-[#203c43] text-white ${feature ? "min-h-[30rem] sm:min-h-[38rem]" : "min-h-[21rem] sm:min-h-[26rem]"}`}>
    {story.images.map((image, index) => <Image key={image} src={image} alt={`${story.city}, ${story.country}`} aria-hidden={index !== slide} fill sizes={feature ? "(min-width: 1024px) 75vw, 100vw" : "(min-width: 768px) 50vw, 100vw"} priority={feature && index === 0} loading={feature && index === 0 ? "eager" : "lazy"} className={`object-cover transition-opacity duration-1000 motion-reduce:transition-none ${index === slide ? "opacity-100" : "opacity-0"}`} />)}
    <div className="absolute inset-0 bg-gradient-to-t from-[#102d30]/90 via-[#102d30]/20 to-transparent" aria-hidden="true" />
    <div className="absolute inset-x-0 bottom-0 z-10 p-6 sm:p-9">
      <p className="text-xs font-black uppercase tracking-[0.22em] text-[#d8f1dd]">{story.city}, {story.country}</p>
      <h2 className={`${feature ? "text-4xl sm:text-6xl" : "text-3xl sm:text-4xl"} mt-3 max-w-2xl font-black leading-[0.98] tracking-[-0.05em]`}>{story.title}</h2>
      <p className="mt-4 max-w-xl text-sm leading-6 text-white/85 sm:text-base">{story.dek}</p>
      <a href={`/plan?destination=${encodeURIComponent(story.city)}`} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-black text-[#173d40] transition hover:bg-[#e5f6e7] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50">Plan around {story.city}<span aria-hidden="true" className="ml-2">→</span></a>
    </div>
    {story.images.length > 1 ? <div className="absolute right-5 top-5 z-10 flex items-center gap-2 rounded-full border border-white/25 bg-black/20 p-1 backdrop-blur-sm">
      <button type="button" aria-label="Previous image" onClick={() => move(-1)} className="grid h-9 w-9 place-items-center rounded-full text-lg text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">‹</button>
      <span className="px-1 text-xs font-bold text-white" aria-live="polite">{slide + 1} / {story.images.length}</span>
      <button type="button" aria-label="Next image" onClick={() => move(1)} className="grid h-9 w-9 place-items-center rounded-full text-lg text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">›</button>
    </div> : null}
  </article>;
}

function LiveCard({ card, kind }: { card: FindsCard; kind: "product" | "activity" | "hotel" }) {
  const product = kind === "product";
  return <article className={`min-w-[14rem] snap-start overflow-hidden rounded-[1.5rem] bg-white ${product ? "sm:min-w-[17rem]" : "sm:min-w-[20rem]"}`}>
    <div className={`relative ${product ? "aspect-square bg-[#f7f8f3]" : "aspect-[1.35/1] bg-[#e9f1eb]"}`}>
      {card.image ? <Image src={card.image} alt={card.imageAlt} fill loading="lazy" sizes="(min-width: 768px) 20rem, 82vw" className={product ? "object-contain p-5" : "object-cover"} /> : null}
    </div>
    <div className="p-4">
      <h3 className="line-clamp-2 text-base font-black leading-tight text-[#203c43]">{card.title}</h3>
      {card.price ? <p className="mt-2 text-sm font-bold text-[#0f6e66]">{card.price}</p> : null}
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#687c74]">{card.description}</p>
      <a href={card.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center text-xs font-black text-[#0f6e66] underline decoration-[#9ac7ad] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6e66]">{card.action}<span aria-hidden="true" className="ml-1">↗</span></a>
    </div>
  </article>;
}

function EditorialFlight({ card }: { card: FindsCard }) {
  return <article className="flex flex-col justify-between gap-5 rounded-[1.75rem] bg-[#e8f3ed] p-6 sm:flex-row sm:items-center sm:p-8">
    <div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">Flights worth checking</p><h2 className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">{card.title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#60766d]">{card.description}</p></div>
    <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end"><p className="text-lg font-black text-[#203c43]">{card.price || "Current option found"}</p><a href={card.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">Check flights<span aria-hidden="true" className="ml-2">↗</span></a></div>
  </article>;
}

export function FindsEditorialMagazine({ cards, destination, emptyMessage, disclosures, liveTools }: { cards: FindsCard[]; destination: string; emptyMessage: string; disclosures: string[]; liveTools: ReactNode }) {
  const story = useMemo(() => storyFor(destination), [destination]);
  const products = cards.filter((card) => card.category === "product" && Boolean(card.image));
  const activities = cards.filter((card) => card.category === "activity" && Boolean(card.image));
  const hotels = cards.filter((card) => card.category === "hotel" && Boolean(card.image));
  const flights = cards.filter((card) => card.category === "flight");
  const secondaryStory = destinationStories[(destinationStories.indexOf(story) + 2) % destinationStories.length];

  return <section className="mt-10" aria-label="Editorial travel magazine">
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">Roamly Finds</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-[#203c43] sm:text-4xl">Stories for wherever you’re going.</h1></div><p className="max-w-sm text-sm leading-6 text-[#61766d] sm:text-right">Photography, useful ideas and real options to explore when they’re available.</p></div>
    <PhotoStory story={story} feature />

    <section className="mt-12" aria-labelledby="worth-packing-heading">
      <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">For the journey</p><h2 id="worth-packing-heading" className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">Worth packing</h2></div><p className="hidden text-xs text-[#7b8d85] sm:block">Real products only, when verified</p></div>
      {products.length ? <div className="mt-5 flex snap-x gap-4 overflow-x-auto pb-3">{products.slice(0, 6).map((card) => <LiveCard key={card.id} card={card} kind="product" />)}</div> : <div className="mt-5 rounded-[1.5rem] border border-dashed border-[#b9d7c5] bg-[#f5faf5] px-5 py-7 text-sm leading-6 text-[#60766d]">{emptyMessage}</div>}
    </section>

    {hotels.length ? <section className="mt-12" aria-labelledby="stay-heading"><div className="mb-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">A place to begin</p><h2 id="stay-heading" className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">Where we’d stay</h2></div><LiveCard card={hotels[0]} kind="hotel" /></section> : null}

    {activities.length ? <section className="mt-12" aria-labelledby="activities-heading"><div className="mb-5"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#0f6e66]">Make a day of it</p><h2 id="activities-heading" className="mt-2 text-2xl font-black tracking-tight text-[#203c43]">Things worth doing</h2></div><div className="flex snap-x gap-4 overflow-x-auto pb-3">{activities.slice(0, 6).map((card) => <LiveCard key={card.id} card={card} kind="activity" />)}</div></section> : null}

    {flights[0] ? <section className="mt-12"><EditorialFlight card={flights[0]} /></section> : null}

    <section className="mt-12"><PhotoStory story={secondaryStory} /></section>

    <details className="mt-12 rounded-[1.5rem] border border-[#e0e9e1] bg-white"><summary className="cursor-pointer list-none px-5 py-5 text-sm font-black text-[#203c43] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/15">Explore live options for this trip <span className="ml-2 text-[#0f6e66]">＋</span></summary><div className="border-t border-[#e5ece5] px-5 pb-6">{liveTools}</div></details>
    <p className="mt-6 max-w-3xl text-xs leading-5 text-[#7b8d85]">{cards.some((card) => card.affiliate) ? "Some links may earn Roamly a commission. The seller sets final prices, availability, and booking terms." : null}{disclosures.length ? ` ${disclosures.join(" ")}` : null}</p>
  </section>;
}
