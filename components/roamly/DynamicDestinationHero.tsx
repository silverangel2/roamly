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
const FADE_MS = 700;

export function DynamicDestinationHero() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
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
    if (reducedMotion || rotationPaused || transitioning) return;
    const timer = window.setInterval(() => {
      if (Date.now() < pausedUntil) return;
      beginTransition(nextIndex, false);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [beginTransition, nextIndex, pausedUntil, reducedMotion, rotationPaused, transitioning]);

  function move(step: number) {
    const target = (activeIndex + step + destinations.length) % destinations.length;
    beginTransition(target, true);
  }

  return (
    <section data-active-destination={active.name} className="relative isolate overflow-hidden bg-[#f5f4e9] text-ink">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-8 -z-10 h-80 w-80 rounded-full bg-[#ccefe6]/70 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 bottom-0 -z-10 h-72 w-72 rounded-full bg-[#ffe4c6]/75 blur-3xl" />

      <div className="mx-auto grid min-h-[calc(100svh-8rem)] w-full max-w-7xl items-center gap-9 px-5 py-8 sm:min-h-[calc(100svh-5.5rem)] sm:px-8 sm:py-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12 lg:px-12">
        <div className="roamly-enter order-1 flex flex-col items-start lg:order-1">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#cce4db] bg-white/85 px-3.5 py-2 text-[0.7rem] font-extrabold uppercase tracking-[0.16em] text-[#0f6e66] shadow-sm">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#ef9d69]" />
            Travel, with room to be you
          </p>
          <h1 className="mt-6 max-w-[36rem] text-[3.2rem] font-semibold leading-[0.96] tracking-[-0.055em] text-[#203c43] sm:text-6xl lg:text-[4.5rem]">
            Go somewhere. <span className="text-[#0f6e66]">Feel at home there.</span>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[#526b6c] sm:text-lg sm:leading-8">
            A thoughtful itinerary shaped around your pace, your budget, and the moments you want to remember.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button href="/plan" className="min-h-12 rounded-full bg-[#0f6e66] px-6 text-white shadow-[0_10px_24px_rgba(22,135,127,0.2)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#0e605a] hover:shadow-[0_14px_28px_rgba(22,135,127,0.25)] motion-reduce:transform-none motion-reduce:transition-none">
              Start planning
            </Button>
            <span className="text-sm font-semibold text-[#617777]">One full itinerary included for life</span>
          </div>

          <div className="mt-9 flex w-full max-w-md items-center justify-between gap-4 rounded-2xl border border-[#dce6dc] bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm" aria-label="Destination controls">
            <div key={active.name} className="min-w-0" aria-live="polite">
              <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.15em] text-[#79908c]">A little inspiration</p>
              <p className="mt-1 truncate text-base font-bold text-[#203c43]">{active.name}<span className="font-medium text-[#7a8d8a]"> · {active.country}</span></p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="mr-1 hidden text-xs font-bold tabular-nums text-[#79908c] sm:inline">{String(activeIndex + 1).padStart(2, "0")} / {String(destinations.length).padStart(2, "0")}</span>
              <button
                type="button"
                onClick={() => setRotationPaused((paused) => !paused)}
                aria-label={rotationPaused ? "Resume destination previews" : "Pause destination previews"}
                aria-pressed={rotationPaused}
                className="grid h-10 min-w-10 place-items-center rounded-full border border-[#d7e3dc] bg-white px-3 text-xs font-extrabold text-[#267d78] transition duration-200 hover:border-[#82c7b6] hover:bg-[#effaf6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20 motion-reduce:transition-none"
              >
                {rotationPaused ? "Play" : "Pause"}
              </button>
              <button type="button" onClick={() => move(-1)} disabled={transitioning} aria-label="Previous destination" className="grid h-10 w-10 place-items-center rounded-full border border-[#d7e3dc] bg-white text-lg text-[#267d78] transition duration-200 hover:-translate-y-0.5 hover:border-[#82c7b6] hover:bg-[#effaf6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none">←</button>
              <button type="button" onClick={() => move(1)} disabled={transitioning} aria-label="Next destination" className="grid h-10 w-10 place-items-center rounded-full border border-[#d7e3dc] bg-white text-lg text-[#267d78] transition duration-200 hover:-translate-y-0.5 hover:border-[#82c7b6] hover:bg-[#effaf6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none">→</button>
            </div>
          </div>
        </div>

        <div className="roamly-enter order-2 lg:order-2" style={{ animationDelay: "100ms" }}>
          <div className="relative mx-auto aspect-[1.25/1] w-full max-w-[42rem] overflow-hidden rounded-[2rem] border-[6px] border-white bg-[#dcebe8] shadow-[0_28px_80px_rgba(39,88,80,0.17)] sm:aspect-[1.16/1] sm:rounded-[2.5rem] sm:border-[8px]">
            <Image src={active.image} alt={`AI-generated illustration inspired by ${active.name}, ${active.country}. ${active.alt}`} fill priority sizes="(min-width: 1024px) 54vw, 100vw" className="absolute inset-0 object-cover brightness-105 saturate-110 transition-opacity duration-700" style={{ objectPosition: active.desktopPosition }} />
            <Image src={incoming.image} alt="" fill sizes="(min-width: 1024px) 54vw, 100vw" aria-hidden="true" className={`absolute inset-0 object-cover brightness-105 saturate-110 transition-opacity duration-700 ${transitioning ? "opacity-100" : "opacity-0"}`} style={{ objectPosition: incoming.desktopPosition }} />
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 sm:bottom-6 sm:left-6 sm:right-6">
              <div key={active.name} className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md sm:px-5 sm:py-4">
                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[#0f6e66]">Your next somewhere</p>
                <p className="mt-1 text-xl font-bold tracking-tight text-[#203c43] sm:text-2xl">{active.name}</p>
                <p className="mt-0.5 text-sm font-medium text-[#667d79]">{active.country}</p>
              </div>
              <span aria-hidden="true" className="mb-1 inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[0.65rem] font-bold text-[#267d78] shadow-sm backdrop-blur sm:text-xs">
                <span className="h-2 w-2 rounded-full bg-[#ef9d69]" />AI-generated illustration
              </span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 639px) {
          section img { object-position: ${active.mobilePosition} !important; }
          section img:nth-of-type(2) { object-position: ${incoming.mobilePosition} !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          section img { transition: none !important; }
        }
      `}</style>
    </section>
  );
}
