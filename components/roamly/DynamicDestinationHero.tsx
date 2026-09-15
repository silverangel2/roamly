"use client";

import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

import amalfi from "../../content/social/roamly-25-day-reel-campaign/sources/amalfi-couple-01.png";
import bali from "../../content/social/roamly-25-day-reel-campaign/sources/bali-memories-01.png";
import barcelona from "../../content/social/roamly-25-day-reel-campaign/sources/barcelona-flights-01.png";
import berlin from "../../content/social/roamly-25-day-reel-campaign/sources/berlin-nightlife-01.png";
import copenhagen from "../../content/social/roamly-25-day-reel-campaign/sources/copenhagen-design-reset-01.png";
import costaRica from "../../content/social/roamly-25-day-reel-campaign/sources/costa-rica-family-01.png";
import iceland from "../../content/social/roamly-25-day-reel-campaign/sources/iceland-packing-01.png";
import kyoto from "../../content/social/roamly-25-day-reel-campaign/sources/kyoto-itinerary-01.png";
import london from "../../content/social/roamly-25-day-reel-campaign/sources/london-live-companion-01.png";
import newYork from "../../content/social/roamly-25-day-reel-campaign/sources/nyc-hotels-01.png";
import paris from "../../content/social/roamly-25-day-reel-campaign/sources/paris-luxury-01.png";
import patagonia from "../../content/social/roamly-25-day-reel-campaign/sources/patagonia-adventure-01.png";
import rome from "../../content/social/roamly-25-day-reel-campaign/sources/rome-mistakes-01.png";
import santorini from "../../content/social/roamly-25-day-reel-campaign/sources/santorini-dream-01.png";
import turksCaicos from "../../content/social/roamly-25-day-reel-campaign/sources/turks-caicos-beach-01.png";

type Destination = {
  name: string;
  country: string;
  image: StaticImageData;
  alt: string;
  desktopPosition: string;
  mobilePosition: string;
};

const destinations: Destination[] = [
  { name: "Santorini", country: "Greece", image: santorini, alt: "Whitewashed Santorini buildings above the Aegean", desktopPosition: "58% center", mobilePosition: "62% center" },
  { name: "Kyoto", country: "Japan", image: kyoto, alt: "A quiet Kyoto street framed by traditional wooden homes", desktopPosition: "56% center", mobilePosition: "54% center" },
  { name: "Paris", country: "France", image: paris, alt: "Paris at blue hour with warm lights along the river", desktopPosition: "52% center", mobilePosition: "48% center" },
  { name: "Amalfi Coast", country: "Italy", image: amalfi, alt: "The Amalfi Coast climbing above clear blue water", desktopPosition: "55% center", mobilePosition: "60% center" },
  { name: "Costa Rica", country: "Costa Rica", image: costaRica, alt: "A misty Costa Rican landscape viewed from a quiet lodge", desktopPosition: "50% center", mobilePosition: "52% center" },
  { name: "Berlin", country: "Germany", image: berlin, alt: "Berlin streets glowing after rain at night", desktopPosition: "48% center", mobilePosition: "46% center" },
  { name: "Turks & Caicos", country: "Turks and Caicos", image: turksCaicos, alt: "Clear turquoise water and a calm beach at sunset", desktopPosition: "48% center", mobilePosition: "48% center" },
  { name: "Patagonia", country: "Chile & Argentina", image: patagonia, alt: "Jagged Patagonia peaks above a deep blue lake", desktopPosition: "52% center", mobilePosition: "52% center" },
  { name: "Barcelona", country: "Spain", image: barcelona, alt: "Barcelona rooftops and warm evening light", desktopPosition: "58% center", mobilePosition: "58% center" },
  { name: "New York", country: "United States", image: newYork, alt: "A New York hotel entrance glowing in the evening", desktopPosition: "52% center", mobilePosition: "50% center" },
  { name: "Iceland", country: "Iceland", image: iceland, alt: "A quiet Icelandic coast beneath a moody sky", desktopPosition: "48% center", mobilePosition: "48% center" },
  { name: "London", country: "United Kingdom", image: london, alt: "London street lights reflected in the evening", desktopPosition: "50% center", mobilePosition: "48% center" },
  { name: "Rome", country: "Italy", image: rome, alt: "A traveler exploring Rome in warm afternoon light", desktopPosition: "52% center", mobilePosition: "54% center" },
  { name: "Bali", country: "Indonesia", image: bali, alt: "Lush Bali landscape beyond a quiet veranda", desktopPosition: "50% center", mobilePosition: "50% center" },
  { name: "Copenhagen", country: "Denmark", image: copenhagen, alt: "Copenhagen waterfront architecture at dusk", desktopPosition: "52% center", mobilePosition: "50% center" }
];

const ROTATION_MS = 8500;
const FADE_MS = 850;

export function DynamicDestinationHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pausedUntil, setPausedUntil] = useState(0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = destinations[activeIndex];
  const incoming = destinations[incomingIndex];
  const nextIndex = useMemo(() => (activeIndex + 1) % destinations.length, [activeIndex]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  const beginTransition = useCallback((targetIndex: number, isManual: boolean) => {
    if (transitioning || targetIndex === activeIndex) return;
    if (transitionTimer.current) clearTimeout(transitionTimer.current);

    if (reducedMotion) {
      setActiveIndex(targetIndex);
      setIncomingIndex((targetIndex + 1) % destinations.length);
      if (isManual) setPausedUntil(Date.now() + 20000);
      return;
    }

    setIncomingIndex(targetIndex);
    setTransitioning(true);
    if (isManual) setPausedUntil(Date.now() + 20000);
    transitionTimer.current = setTimeout(() => {
      setActiveIndex(targetIndex);
      setIncomingIndex((targetIndex + 1) % destinations.length);
      setTransitioning(false);
    }, FADE_MS);
  }, [activeIndex, reducedMotion, transitioning]);

  useEffect(() => {
    if (reducedMotion || transitioning) return;
    const timer = window.setInterval(() => {
      if (Date.now() < pausedUntil) return;
      beginTransition(nextIndex, false);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [beginTransition, nextIndex, pausedUntil, reducedMotion, transitioning]);

  function move(step: number) {
    const target = (activeIndex + step + destinations.length) % destinations.length;
    beginTransition(target, true);
  }

  return (
    <section data-active-destination={active.name} className="relative isolate min-h-[calc(100svh-8rem)] overflow-hidden bg-[#18313c] text-white sm:min-h-[calc(100svh-5.5rem)]">
      <Image src={active.image} alt={active.alt} fill priority sizes="100vw" className="absolute inset-0 -z-20 object-cover" style={{ objectPosition: active.desktopPosition }} />
      <Image src={incoming.image} alt="" fill sizes="100vw" aria-hidden="true" className={`absolute inset-0 -z-20 object-cover transition-opacity duration-700 ${transitioning ? "opacity-100" : "opacity-0"}`} style={{ objectPosition: incoming.desktopPosition }} />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,27,35,0.62)_0%,rgba(8,27,35,0.26)_34%,rgba(8,27,35,0.04)_70%,transparent_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(8,27,35,0.68)_0%,rgba(8,27,35,0.16)_35%,transparent_72%)]" />
      <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-7xl flex-col px-5 pb-28 pt-8 sm:min-h-[calc(100svh-5.5rem)] sm:px-8 sm:pb-10 sm:pt-12 lg:px-12">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d2f3ea]">Roamly · travel planning with intention</p>
        <div className="mt-auto max-w-[34rem] pb-8 sm:pb-10">
          <h1 className="max-w-[25rem] text-[3rem] font-semibold leading-[0.94] tracking-[-0.05em] sm:text-6xl lg:max-w-[31rem] lg:text-[4.35rem]">Go somewhere. Roamly the rest.</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-white/88 sm:text-lg sm:leading-8">A trip plan shaped around the way you actually want to travel.</p>
          <div className="mt-7">
            <Button href="/plan" className="min-h-12 bg-[#f6bd68] px-6 text-ink shadow-[0_12px_30px_rgba(246,189,104,0.24)] hover:bg-[#ffd18b]">Start planning</Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/35 pt-4" aria-label="Destination controls">
          <div key={active.name} className="min-w-0" aria-live="polite">
            <p className="truncate text-lg font-semibold tracking-tight sm:text-xl">{active.name}</p>
            <p className="mt-0.5 truncate text-sm text-white/70">{active.country}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs font-semibold tabular-nums text-white/70 sm:inline">{String(activeIndex + 1).padStart(2, "0")} / {String(destinations.length).padStart(2, "0")}</span>
            <button type="button" onClick={() => move(-1)} disabled={transitioning} aria-label="Previous destination" className="grid h-11 w-11 place-items-center rounded-full border border-white/35 text-lg transition hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-wait disabled:opacity-60">←</button>
            <button type="button" onClick={() => move(1)} disabled={transitioning} aria-label="Next destination" className="grid h-11 w-11 place-items-center rounded-full border border-white/35 text-lg transition hover:border-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-wait disabled:opacity-60">→</button>
          </div>
        </div>
      </div>
      <style jsx>{`
        @media (max-width: 639px) {
          section > img { object-position: ${active.mobilePosition} !important; }
          section > img:nth-of-type(2) { object-position: ${incoming.mobilePosition} !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          section > img { transition: none !important; }
        }
      `}</style>
  </section>
  );
}
