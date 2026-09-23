"use client";

import { useState } from "react";
import type { StaticImageData } from "next/image";
import commonsPhotos from "../../content/roamly-puzzle-commons-attribution.json";
import amalfi from "../../content/social/roamly-25-day-reel-campaign/sources/amalfi-couple-01.png";
import amsterdam from "../../content/social/roamly-25-day-reel-campaign/sources/amsterdam-transport-01.png";
import bali from "../../content/social/roamly-25-day-reel-campaign/sources/bali-memories-01.png";
import barcelona from "../../content/social/roamly-25-day-reel-campaign/sources/barcelona-flights-01.png";
import berlin from "../../content/social/roamly-25-day-reel-campaign/sources/berlin-nightlife-01.png";
import copenhagen from "../../content/social/roamly-25-day-reel-campaign/sources/copenhagen-design-reset-01.png";
import costaRica from "../../content/social/roamly-25-day-reel-campaign/sources/costa-rica-family-01.png";
import iceland from "../../content/social/roamly-25-day-reel-campaign/sources/iceland-packing-01.png";
import kyoto from "../../content/social/roamly-25-day-reel-campaign/sources/kyoto-itinerary-01.png";
import london from "../../content/social/roamly-25-day-reel-campaign/sources/london-live-companion-01.png";
import lisbon from "../../content/social/roamly-25-day-reel-campaign/sources/lisbon-budget-01.png";
import ljubljana from "../../content/social/roamly-25-day-reel-campaign/sources/ljubljana-hidden-01.png";
import luangPrabang from "../../content/social/roamly-25-day-reel-campaign/sources/luang-prabang-slow-01.png";
import marrakech from "../../content/social/roamly-25-day-reel-campaign/sources/marrakech-personalized-01.png";
import newYork from "../../content/social/roamly-25-day-reel-campaign/sources/nyc-hotels-01.png";
import oaxaca from "../../content/social/roamly-25-day-reel-campaign/sources/oaxaca-food-01.png";
import paris from "../../content/social/roamly-25-day-reel-campaign/sources/paris-luxury-01.png";
import patagonia from "../../content/social/roamly-25-day-reel-campaign/sources/patagonia-adventure-01.png";
import quebec from "../../content/social/roamly-25-day-reel-campaign/sources/quebec-weekend-01.png";
import rome from "../../content/social/roamly-25-day-reel-campaign/sources/rome-mistakes-01.png";
import santorini from "../../content/social/roamly-25-day-reel-campaign/sources/santorini-dream-01.png";
import seoul from "../../content/social/roamly-25-day-reel-campaign/sources/seoul-solo-01.png";
import turksCaicos from "../../content/social/roamly-25-day-reel-campaign/sources/turks-caicos-beach-01.png";
import vancouver from "../../content/social/roamly-25-day-reel-campaign/sources/vancouver-confidence-01.png";
import california from "../../content/social/roamly-25-day-reel-campaign/sources/pch-roadtrip-01.png";

type PuzzleDestination = { city: string; country: string; image: StaticImageData | string; alt: string; kind: "illustration" | "photo"; credit?: string; sourceUrl?: string; license?: string; licenseUrl?: string };

const illustrations: PuzzleDestination[] = [
  { city: "Amalfi Coast", country: "Italy", image: amalfi, alt: "Amalfi Coast-inspired scene", kind: "illustration" },
  { city: "Amsterdam", country: "Netherlands", image: amsterdam, alt: "Amsterdam-inspired scene", kind: "illustration" },
  { city: "Bali", country: "Indonesia", image: bali, alt: "Bali-inspired scene", kind: "illustration" },
  { city: "Barcelona", country: "Spain", image: barcelona, alt: "Barcelona-inspired scene", kind: "illustration" },
  { city: "Berlin", country: "Germany", image: berlin, alt: "Berlin-inspired scene", kind: "illustration" },
  { city: "Copenhagen", country: "Denmark", image: copenhagen, alt: "Copenhagen-inspired scene", kind: "illustration" },
  { city: "Costa Rica", country: "Costa Rica", image: costaRica, alt: "Costa Rica-inspired scene", kind: "illustration" },
  { city: "Iceland", country: "Iceland", image: iceland, alt: "Iceland-inspired scene", kind: "illustration" },
  { city: "Kyoto", country: "Japan", image: kyoto, alt: "Kyoto-inspired scene", kind: "illustration" },
  { city: "London", country: "United Kingdom", image: london, alt: "London-inspired scene", kind: "illustration" },
  { city: "Lisbon", country: "Portugal", image: lisbon, alt: "Lisbon-inspired scene", kind: "illustration" },
  { city: "Ljubljana", country: "Slovenia", image: ljubljana, alt: "Ljubljana-inspired scene", kind: "illustration" },
  { city: "Luang Prabang", country: "Laos", image: luangPrabang, alt: "Luang Prabang-inspired scene", kind: "illustration" },
  { city: "Marrakech", country: "Morocco", image: marrakech, alt: "Marrakech-inspired scene", kind: "illustration" },
  { city: "New York", country: "United States", image: newYork, alt: "New York-inspired scene", kind: "illustration" },
  { city: "Oaxaca", country: "Mexico", image: oaxaca, alt: "Oaxaca-inspired scene", kind: "illustration" },
  { city: "Paris", country: "France", image: paris, alt: "Paris-inspired scene", kind: "illustration" },
  { city: "Patagonia", country: "Chile & Argentina", image: patagonia, alt: "Patagonia-inspired scene", kind: "illustration" },
  { city: "Quebec City", country: "Canada", image: quebec, alt: "Quebec City-inspired scene", kind: "illustration" },
  { city: "Rome", country: "Italy", image: rome, alt: "Rome-inspired scene", kind: "illustration" },
  { city: "Santorini", country: "Greece", image: santorini, alt: "Santorini-inspired scene", kind: "illustration" },
  { city: "Seoul", country: "South Korea", image: seoul, alt: "Seoul-inspired scene", kind: "illustration" },
  { city: "Turks & Caicos", country: "Turks and Caicos", image: turksCaicos, alt: "Turks and Caicos-inspired scene", kind: "illustration" },
  { city: "Vancouver", country: "Canada", image: vancouver, alt: "Vancouver-inspired scene", kind: "illustration" },
  { city: "California Pacific Coast", country: "United States", image: california, alt: "California Pacific Coast-inspired scene", kind: "illustration" }
];
const destinations: PuzzleDestination[] = [
  ...illustrations,
  ...commonsPhotos.map((photo) => ({
    ...photo,
    kind: "photo" as const,
    credit: photo.creator.replace(/^This photo was taken by /i, "").replace(/\s+\./g, ".").split(/Please credit| If you use/i)[0].replace(/[.:]+\s*$/, "").trim()
  }))
];

const solvedOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const dailyNumber = () => Math.floor(Date.now() / 86_400_000) % destinations.length;
const shuffledOrder = () => [8, 0, 7, 2, 6, 3, 4, 1, 5];

export function CityPuzzle() {
  const [destinationIndex, setDestinationIndex] = useState(dailyNumber);
  const [order, setOrder] = useState<number[]>(shuffledOrder);
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const destination = destinations[destinationIndex];
  const solved = order.every((piece, position) => piece === solvedOrder[position]);

  function selectPiece(position: number) {
    if (solved) return;
    if (selected === null) {
      setSelected(position);
      return;
    }
    if (selected === position) {
      setSelected(null);
      return;
    }
    setOrder((current) => {
      const next = [...current];
      [next[selected], next[position]] = [next[position], next[selected]];
      return next;
    });
    setMoves((count) => count + 1);
    setSelected(null);
  }

  function nextPuzzle() {
    setDestinationIndex((current) => (current + 1) % destinations.length);
    setOrder(shuffledOrder());
    setSelected(null);
    setMoves(0);
  }

  return <section id="destination-puzzle" aria-labelledby="puzzle-title" className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
    <div className="overflow-hidden rounded-[1.35rem] border border-[#dce9df] bg-white shadow-[0_12px_38px_rgba(39,88,80,0.07)]">
      <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
        <div className="flex flex-col justify-center bg-[#f5faf5] p-6 sm:p-8 lg:p-9">
          <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[#0f6e66]">A small travel break · {destinationIndex + 1} of {destinations.length}</p>
          <h2 id="puzzle-title" className="mt-3 text-2xl font-bold tracking-tight text-[#203c43] sm:text-3xl">Where will the pieces take you?</h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#5f756c]">Swap two pieces at a time to discover somewhere new. Solve the picture when you feel like playing, then decide whether it belongs on your trip.</p>
          <p aria-live="polite" className="mt-4 text-xs font-bold text-[#547067]">{solved ? `Solved in ${moves} swaps` : selected === null ? `Choose a piece · ${moves} ${moves === 1 ? "swap" : "swaps"}` : "Now choose another piece to swap."}</p>
          <p className="mt-5 text-[0.68rem] leading-5 text-[#526b62]">Explore 100 destinations through real travel photos and clearly labeled AI illustrations. Planning remains one tap away above.</p>
        </div>
        <div className="p-4 sm:p-7 lg:p-9">
          <div role="group" aria-label={`Jigsaw puzzle ${destination.kind === "photo" ? "photo of" : "illustration inspired by"} ${destination.city}, ${destination.country}`} className="mx-auto grid aspect-square w-full max-w-[29rem] grid-cols-3 gap-1.5 overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_10px_34px_rgba(39,88,80,0.12)] sm:gap-2 sm:p-2">
            {order.map((piece, position) => {
              const row = Math.floor(piece / 3);
              const column = piece % 3;
              const imageSrc = typeof destination.image === "string" ? destination.image : destination.image.src;
              return <button key={position} type="button" onClick={() => selectPiece(position)} aria-label={`Puzzle piece ${position + 1}${selected === position ? ", selected" : ""}`} aria-pressed={selected === position} className={`relative min-h-0 overflow-hidden rounded-lg transition duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66] ${selected === position ? "z-[1] scale-[0.96] ring-4 ring-[#0f6e66]" : "hover:brightness-105"}`} style={{ backgroundImage: `url("${imageSrc}")`, backgroundSize: "300% 300%", backgroundPosition: `${column * 50}% ${row * 50}%` }} />;
            })}
          </div>
          <p className="mx-auto mt-3 max-w-[29rem] text-center text-[0.68rem] leading-5 text-[#526b62]">
            {destination.kind === "photo" ? <>Photo: <a href={destination.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline">{destination.credit || "Photographer"}</a> · <a href={destination.licenseUrl} target="_blank" rel="noreferrer" className="underline">{destination.license}</a> · <a href={destination.sourceUrl} target="_blank" rel="noreferrer" className="underline">Source</a> · reduced-size Commons thumbnail</> : "AI-generated illustrative artwork — not a documentary photograph."}
          </p>
          {solved ? <div className="mx-auto mt-5 max-w-[29rem] rounded-2xl border border-[#dce9df] bg-[#f5faf5] p-4 sm:p-5" style={{ animation: "roamly-enter 360ms ease both" }}>
            <p role="status" aria-live="polite" className="text-lg font-black text-[#203c43]">You found {destination.city}, {destination.country}! ✨</p>
            <p className="mt-1 text-sm leading-6 text-[#60766e]">Make it a real trip. Explore planning, compare current fares, or find a stay through Booking.com (via Stay22 where configured).</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a href={`/plan?destination=${encodeURIComponent(destination.city)}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#0f6e66] px-5 text-xs font-extrabold text-white hover:bg-[#0e605a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">Plan a trip</a>
              <a href={`/finds?destination=${encodeURIComponent(destination.city)}#finds-tab-flights`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#b8d6ca] bg-white px-5 text-xs font-extrabold text-[#28665d] hover:bg-[#f1f8f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">Check flights</a>
              <a href={`/finds?destination=${encodeURIComponent(destination.city)}#finds-tab-stays`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#b8d6ca] bg-white px-5 text-xs font-extrabold text-[#28665d] hover:bg-[#f1f8f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">Find hotels</a>
              <button type="button" onClick={nextPuzzle} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-xs font-extrabold text-[#0f6e66] hover:bg-white">Next puzzle →</button>
            </div>
            <p className="mt-3 text-[0.68rem] leading-5 text-[#526b62]">Affiliate availability depends on partner approval and production configuration. Prices and booking are confirmed with each provider.</p>
          </div> : <p className="mx-auto mt-3 max-w-[29rem] text-center text-xs text-[#526b62]">Tap a tile, then another tile to swap them.</p>}
        </div>
      </div>
    </div>
  </section>;
}
