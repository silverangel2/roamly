"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FindsCard } from "@/lib/roamly/findsMarketCore";
import { findsTravelServices, findsWidgets, type FindsPromoConfig } from "@/lib/roamly/findsCommercialConfig";
import { FindsPromo, FindsTrackedLink, FindsWidgetSection } from "@/components/roamly/FindsCommercialWidgets";
import { curatedAmazonFindPresentation } from "@/lib/roamly/curatedAmazonFinds";

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
  return destinationStories.find((story) => requested && requested !== "your next somewhere" && [story.city, story.country, ...story.country.split("·"), ...story.title.split(" ")].some((part) => {
    const candidate = normalize(part);
    return candidate.length > 2 && (requested.includes(candidate) || candidate.includes(requested));
  })) || destinationStories[0];
}

function PhotoStory({ story, feature = false }: { story: DestinationStory; feature?: boolean }) {
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

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

  return <article onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start === null || end === undefined || Math.abs(end - start) < 48 || story.images.length < 2) return;
    move(end < start ? 1 : -1);
  }} className={`group relative isolate overflow-hidden rounded-[1.5rem] bg-[#203c43] text-white shadow-[0_24px_70px_rgba(34,60,58,0.13)] sm:rounded-[2rem] ${feature ? "min-h-[27rem] sm:min-h-[34rem] lg:min-h-[39rem]" : "min-h-[20rem] sm:min-h-[25rem]"}`}>
    {story.images.map((image, index) => <Image key={image} src={image} alt={`${story.city}, ${story.country}`} aria-hidden={index !== slide} fill sizes={feature ? "(min-width: 1024px) 75vw, 100vw" : "(min-width: 768px) 50vw, 100vw"} priority={feature && index === 0} loading={feature && index === 0 ? "eager" : "lazy"} className={`object-cover transition-opacity duration-1000 motion-reduce:transition-none ${index === slide ? "opacity-100" : "opacity-0"}`} />)}
    <div className="absolute inset-0 bg-gradient-to-t from-[#102d30]/90 via-[#102d30]/15 to-transparent" aria-hidden="true" />
    <div className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-9 lg:p-11">
      {feature ? <p className="mb-3 inline-flex rounded-full border border-white/35 bg-[#102d30]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-sm">A Roamly travel story</p> : null}
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

function LiveCard({ card, kind, featured = false }: { card: FindsCard; kind: "product" | "activity" | "hotel"; featured?: boolean }) {
  const product = kind === "product";
  return <article className={`snap-start overflow-hidden rounded-[1.25rem] bg-white shadow-[0_12px_36px_rgba(32,60,67,0.07)] ${featured ? "grid md:grid-cols-[1.15fr_0.85fr]" : `min-w-[14rem] ${product ? "sm:min-w-[17rem]" : "sm:min-w-[20rem]"}`}`}>
    <div className={`relative ${featured ? "min-h-64 aspect-[1.35/1] md:aspect-auto" : product ? "aspect-square bg-[#f7f8f3]" : "aspect-[1.35/1] bg-[#e9f1eb]"}`}>
      {card.image ? <Image src={card.image} alt={card.imageAlt} fill loading="lazy" sizes={featured ? "(min-width: 768px) 55vw, 100vw" : "(min-width: 768px) 20rem, 82vw"} className={product ? "object-contain p-5" : "object-cover"} /> : null}
      {!card.image ? <div className="absolute inset-0 grid place-items-center bg-[#e9f1eb] p-6 text-center text-sm text-[#60766d]">No verified photo was supplied for this listing.</div> : null}
    </div>
    <div className={featured ? "flex flex-col justify-center p-6 sm:p-9" : "p-4"}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#0f6e66]">{card.eyebrow}</p>
      <h3 className="line-clamp-2 text-base font-black leading-tight text-[#203c43]">{card.title}</h3>
      {card.price ? <p className="mt-2 text-sm font-bold text-[#0f6e66]">{card.price}</p> : null}
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#687c74]">{card.description}</p>
      <a href={card.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center text-xs font-black text-[#0f6e66] underline decoration-[#9ac7ad] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6e66]">{card.action}<span aria-hidden="true" className="ml-1">↗</span></a>
    </div>
  </article>;
}

function CuratedProductCard({ card }: { card: FindsCard }) {
  const presentation = curatedAmazonFindPresentation(card.id);
  return <article className="snap-start w-[calc(100%_-_3rem)] shrink-0 overflow-hidden rounded-[1.5rem] bg-white shadow-[0_14px_35px_rgba(32,60,67,0.07)] md:w-auto md:min-w-0 md:shrink md:basis-auto">
    <a href={card.href} target="_blank" rel="noopener noreferrer" aria-label={`${card.action}: ${card.title} (illustrative category image)`} className="group relative block aspect-[1.2/1] overflow-hidden bg-[#e9efe5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#0f6e66]/50">
      <Image src={presentation.illustration} alt={presentation.illustrationAlt} fill sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 82vw" loading="lazy" className="object-cover transition-transform duration-700 group-hover:scale-[1.035] motion-reduce:transform-none motion-reduce:transition-none" />
      <span className="absolute left-3 top-3 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[10px] font-bold text-[#365f56] shadow-sm backdrop-blur-sm sm:left-4 sm:top-4">Illustrative image</span>
    </a>
    <div className="p-4 sm:p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#0f6e66]">Amazon category</p><h3 className="mt-2 text-lg font-black leading-tight text-[#203c43]">{card.title}</h3><p className="mt-2 line-clamp-2 text-sm leading-5 text-[#687c74]">{card.description}</p><a href={card.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-10 items-center text-sm font-black text-[#0f6e66] underline decoration-[#9ac7ad] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6e66]">{card.action}<span aria-hidden="true" className="ml-1">↗</span></a></div>
  </article>;
}

function RentalWidgetDisclosure() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setOpen(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="mx-auto max-w-3xl rounded-[1.5rem] border border-[#dce9df] bg-white/70 p-4 lg:border-0 lg:bg-transparent lg:p-0">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-2 text-sm font-black text-[#203c43] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/15 lg:hidden">
      <span><span className="block text-xs font-black uppercase tracking-[0.18em] text-[#0f6e66]">Need a car?</span><span className="mt-1 block">Keep the journey moving</span></span>
      <span aria-hidden="true" className="text-xl text-[#0f6e66]">{open ? "−" : "+"}</span>
    </summary>
    <div className="pt-4 lg:pt-0"><FindsWidgetSection config={findsWidgets.cars} heading={false} className="mx-auto" /></div>
  </details>;
}

function EditorialFlight({ card }: { card: FindsCard }) {
  return <article className="flex flex-col justify-between gap-5 rounded-[1.75rem] bg-[#e8f3ed] p-6 sm:flex-row sm:items-center sm:p-8">
    <div><h3 className="text-2xl font-black tracking-tight text-[#203c43]">{card.title}</h3><p className="mt-2 max-w-xl text-sm leading-6 text-[#60766d]">{card.description}</p></div>
    <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end"><p className="text-lg font-black text-[#203c43]">{card.price || "Current option found"}</p><a href={card.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 text-sm font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">Check flights<span aria-hidden="true" className="ml-2">↗</span></a></div>
  </article>;
}

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description?: string; id?: string }) {
  return <header className="mb-5 max-w-2xl">
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#0f6e66]">{eyebrow}</p>
    <h2 id={id} className="mt-2 text-[1.7rem] font-black leading-tight tracking-[-0.04em] text-[#203c43] sm:text-3xl">{title}</h2>
    {description ? <p className="mt-2 max-w-xl text-sm leading-6 text-[#60766d]">{description}</p> : null}
  </header>;
}

export function FindsEditorialMagazine({ cards, destination, disclosures, activePromo, liveTools, searchOpen, onSearchOpenChange }: { cards: FindsCard[]; destination: string; emptyMessage: string; disclosures: string[]; activePromo: FindsPromoConfig | null; liveTools: ReactNode; searchOpen: boolean; onSearchOpenChange: (open: boolean) => void; onOpenSearch: (tab: "stays" | "flights" | "activities") => void }) {
  const story = useMemo(() => storyFor(destination), [destination]);
  const products = cards.filter((card) => card.category === "product" && Boolean(card.image));
  const curatedProducts = cards.filter((card) => card.category === "product" && card.recommendationLabel === "curated-category");
  const activities = cards.filter((card) => card.category === "activity");
  const hotels = cards.filter((card) => card.category === "hotel" && Boolean(card.image));
  const flights = cards.filter((card) => card.category === "flight");
  const secondaryStory = destinationStories[(destinationStories.indexOf(story) + 2) % destinationStories.length];
  const flightStory = destinationStories[(destinationStories.indexOf(story) + 1) % destinationStories.length];
  const experienceStory = destinationStories[(destinationStories.indexOf(story) + 3) % destinationStories.length];
  const utilityStory = destinationStories[(destinationStories.indexOf(story) + 4) % destinationStories.length];

  const destinationLabel = destination === "your next somewhere" ? "your next trip" : destination;

  return <section className="mt-7 sm:mt-10" aria-label="Editorial travel magazine">
    <header className="mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#0f6e66]">Roamly Finds <span className="px-1 text-[#b3c8bc]">/</span> The travel edit</p><h1 className="mt-3 max-w-3xl text-[2.15rem] font-black leading-[1.02] tracking-[-0.055em] text-[#203c43] sm:text-5xl lg:text-[3.6rem]">Good things for <span className="text-[#0f6e66]">{destinationLabel}.</span></h1></div>
      <p className="max-w-sm text-sm leading-6 text-[#61766d] sm:pb-1 sm:text-right">Stories for wherever you’re going—thoughtful trip essentials and real options to explore.</p>
    </header>
    <nav aria-label="Explore this page" className="-mx-4 mb-6 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mb-8 sm:px-0">
      {[["worth-packing-heading", "Worth packing"], ["stay-heading", "Stays"], ["flights-heading", "Flights"], ["activities-heading", "Things to do"], ["travel-tools-heading", "More to explore"]].map(([href, label]) => <a key={href} href={`#${href}`} className="min-h-10 shrink-0 snap-start rounded-full border border-[#dce7dc] bg-white/80 px-4 py-2 text-xs font-bold text-[#365f56] transition hover:border-[#91bba7] hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">{label}</a>)}
    </nav>
    <PhotoStory story={story} feature />

    <section id="worth-packing" className="mt-14 scroll-mt-8 sm:mt-20" aria-labelledby="worth-packing-heading">
      <SectionHeading eyebrow="For the journey" title="Worth packing" description="A curated travel essentials edit—browse categories for little things that make the way there feel easier." id="worth-packing-heading" />
      {products.length ? <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">{products.slice(0, 6).map((card) => <LiveCard key={card.id} card={card} kind="product" />)}</div> : <><div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:gap-4 sm:px-0 md:grid md:grid-cols-3 md:overflow-visible lg:grid-cols-4">{curatedProducts.map((card) => <CuratedProductCard key={card.id} card={card} />)}</div><p className="mt-1 text-xs leading-5 text-[#718179]">These are ideas, not live product listings or price claims. Browse categories on Amazon; product selection, price and availability are set by the seller.</p></>}
    </section>

    <section className="mt-14 scroll-mt-8 sm:mt-20" aria-labelledby="stay-heading"><SectionHeading eyebrow="A place to begin" title="Where to stay" description="Find a place that fits the way you want to travel." id="stay-heading" />{hotels[0] ? <LiveCard card={hotels[0]} kind="hotel" featured /> : <article className="rounded-[1.5rem] bg-[#eaf3eb] p-6 sm:rounded-[2rem] sm:p-10"><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#497466]">Stay somewhere that feels right</p><h3 className="mt-3 max-w-xl text-2xl font-black tracking-tight text-[#203c43] sm:text-3xl">Make the destination feel like yours.</h3><p className="mt-3 max-w-2xl text-sm leading-6 text-[#60766d]">Browse stays for {destinationLabel} and confirm the latest price and availability with the booking partner.</p><a href={findsTravelServices.stays.href} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[#0f6e66] px-6 text-sm font-black text-white transition hover:bg-[#0b5c55] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/25">Explore stays<span aria-hidden="true" className="ml-2">↗</span></a></article>}</section>

    <section className="mt-14 scroll-mt-8 sm:mt-20" aria-labelledby="flights-heading"><SectionHeading eyebrow="The journey there" title="Flights worth checking" description="Explore current fare ideas for your next trip." id="flights-heading" />{flights.length ? <div className="mb-6 space-y-4">{flights.slice(0, 3).map((card) => <EditorialFlight key={card.id} card={card} />)}</div> : null}<div className="grid items-stretch gap-5 lg:grid-cols-2"><div className="flex min-w-0 items-center overflow-hidden rounded-[1.5rem] border border-[#e5ebe1] bg-white p-4 sm:rounded-[2rem] sm:p-7 lg:p-8"><FindsWidgetSection config={findsWidgets.flights} heading={false} className="w-full" /></div><PhotoStory story={flightStory} /></div></section>

    <section className="mt-14 scroll-mt-8 sm:mt-20" aria-labelledby="activities-heading"><SectionHeading eyebrow="Make a day of it" title="Things worth doing" description="Real experiences, local events and ideas for the days between." id="activities-heading" />{activities.length ? <><LiveCard card={activities[0]} kind="activity" featured />{activities.length > 1 ? <div className="-mx-4 mt-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">{activities.slice(1, 6).map((card) => <LiveCard key={card.id} card={card} kind="activity" />)}</div> : null}</> : null}<div className="mt-7 overflow-hidden rounded-[1.5rem] border border-[#e5ebe1] bg-white p-4 sm:mt-9 sm:rounded-[2rem] sm:p-7 lg:p-9"><FindsWidgetSection config={findsWidgets.experiences107} heading={false} className="mx-auto max-w-5xl" /></div><div className="mt-7 grid gap-5 sm:mt-8 lg:grid-cols-2"><PhotoStory story={experienceStory} /><div className="flex min-h-full flex-col justify-center rounded-[1.5rem] bg-[#f1f3e9] p-6 sm:rounded-[2rem] sm:p-9"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#497466]">Leave room for a detour</p><h3 className="mt-3 text-2xl font-black tracking-tight text-[#203c43]">The best day might be the one you didn’t plan.</h3><p className="mt-3 text-sm leading-6 text-[#60766d]">Keep browsing real things to do, and choose what fits once you know the dates.</p><div className="mt-7 border-t border-[#dce4d8] pt-5"><FindsWidgetSection config={findsWidgets.experiences121} heading={false} /></div></div></div></section>

    <section className="mt-12"><PhotoStory story={secondaryStory} /></section>

    <section className="mt-14 scroll-mt-8 sm:mt-20" aria-labelledby="travel-tools-heading"><SectionHeading eyebrow="The little things that help" title="More ways to explore" description="A few useful extras, ready when you need them." id="travel-tools-heading" /><div className="grid gap-4 lg:grid-cols-2">{activePromo ? <FindsPromo promo={activePromo} /> : null}<FindsTrackedLink href={findsTravelServices.airportTransfer.href} eyebrow={findsTravelServices.airportTransfer.eyebrow} headline={findsTravelServices.airportTransfer.headline} description={findsTravelServices.airportTransfer.description} action="Find an airport transfer" /></div><div className="mt-6 grid items-start gap-5 lg:grid-cols-2"><div className="rounded-[1.5rem] bg-white p-5 sm:rounded-[2rem] sm:p-7"><FindsWidgetSection config={findsWidgets.esim} /></div><div className="rounded-[1.5rem] bg-white p-5 sm:rounded-[2rem] sm:p-7"><FindsWidgetSection config={findsWidgets.travel} /></div></div><div className="mt-6"><PhotoStory story={utilityStory} /></div><div className="mt-6"><RentalWidgetDisclosure /></div></section>

    <details id="finds-live-options" open={searchOpen} onToggle={(event) => onSearchOpenChange(event.currentTarget.open)} className="mt-14 scroll-mt-8 overflow-hidden rounded-[1.5rem] border border-[#dce7dc] bg-white shadow-[0_16px_48px_rgba(32,60,67,0.06)] sm:mt-20 sm:rounded-[2rem]"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 text-sm font-black text-[#203c43] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/15 sm:px-8"><span><span className="block text-[10px] uppercase tracking-[0.18em] text-[#0f6e66]">Build your next trip</span><span className="mt-1 block text-base sm:text-lg">Search stays, flights and experiences</span></span><span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#edf5ee] text-xl text-[#0f6e66]">＋</span></summary><div className="border-t border-[#e5ece5] px-4 pb-5 sm:px-8 sm:pb-8">{liveTools}</div></details>
    <p className="mt-6 max-w-3xl text-xs leading-5 text-[#7b8d85]">Some links may earn Roamly a commission. The seller sets final prices, availability, and booking terms.{disclosures.length ? ` ${disclosures.join(" ")}` : null}</p>
  </section>;
}
