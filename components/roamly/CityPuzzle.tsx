"use client";

import { useState } from "react";
import type { StaticImageData } from "next/image";
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

type PuzzleDestination = { city: string; country: string; image: StaticImageData; alt: string };

// These are the 25 destination-specific campaign images currently approved in this project.
// Keep the destination label paired with its own photo; do not fill the 100-place roadmap with mismatched imagery.
const destinations: PuzzleDestination[] = [
  { city: "Amalfi Coast", country: "Italy", image: amalfi, alt: "The Amalfi Coast above the Mediterranean" },
  { city: "Amsterdam", country: "Netherlands", image: amsterdam, alt: "Amsterdam canals and city streets" },
  { city: "Bali", country: "Indonesia", image: bali, alt: "A lush Bali landscape" },
  { city: "Barcelona", country: "Spain", image: barcelona, alt: "Barcelona rooftops in evening light" },
  { city: "Berlin", country: "Germany", image: berlin, alt: "Berlin streets at night" },
  { city: "Copenhagen", country: "Denmark", image: copenhagen, alt: "Copenhagen waterfront" },
  { city: "Costa Rica", country: "Costa Rica", image: costaRica, alt: "A misty Costa Rican landscape" },
  { city: "Iceland", country: "Iceland", image: iceland, alt: "Icelandic coast beneath a moody sky" },
  { city: "Kyoto", country: "Japan", image: kyoto, alt: "A traditional Kyoto street" },
  { city: "London", country: "United Kingdom", image: london, alt: "London lights reflected on a city street" },
  { city: "Lisbon", country: "Portugal", image: lisbon, alt: "Lisbon streets and rooftops" },
  { city: "Ljubljana", country: "Slovenia", image: ljubljana, alt: "Ljubljana old town" },
  { city: "Luang Prabang", country: "Laos", image: luangPrabang, alt: "A quiet scene in Luang Prabang" },
  { city: "Marrakech", country: "Morocco", image: marrakech, alt: "Marrakech in warm evening light" },
  { city: "New York", country: "United States", image: newYork, alt: "A New York hotel entrance at evening" },
  { city: "Oaxaca", country: "Mexico", image: oaxaca, alt: "A colorful Oaxaca street and food scene" },
  { city: "Paris", country: "France", image: paris, alt: "Paris at blue hour" },
  { city: "Patagonia", country: "Chile & Argentina", image: patagonia, alt: "Patagonia peaks above a deep blue lake" },
  { city: "Quebec City", country: "Canada", image: quebec, alt: "A historic Quebec City weekend" },
  { city: "Rome", country: "Italy", image: rome, alt: "A traveler exploring Rome" },
  { city: "Santorini", country: "Greece", image: santorini, alt: "Whitewashed Santorini above the Aegean" },
  { city: "Seoul", country: "South Korea", image: seoul, alt: "A Seoul neighborhood ready to explore" },
  { city: "Turks & Caicos", country: "Turks and Caicos", image: turksCaicos, alt: "Turquoise water at Turks and Caicos" },
  { city: "Vancouver", country: "Canada", image: vancouver, alt: "Vancouver between city and nature" },
  { city: "California Pacific Coast", country: "United States", image: california, alt: "A Pacific Coast road trip in California" }
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

  return <section id="destination-puzzle" aria-labelledby="puzzle-title" className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8 sm:py-9 lg:px-12">
    <div className="overflow-hidden rounded-[1.7rem] border border-[#dce9df] bg-white shadow-[0_18px_55px_rgba(39,88,80,0.09)]">
      <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
        <div className="flex flex-col justify-center bg-gradient-to-br from-[#e7f5ed] via-[#f7f7ee] to-[#fff2df] p-6 sm:p-8 lg:p-10">
          <p className="text-xs font-extrabold uppercase tracking-[0.17em] text-[#16877f]">A little travel break · {destinationIndex + 1} of {destinations.length}</p>
          <h2 id="puzzle-title" className="mt-3 text-2xl font-black tracking-tight text-[#203c43] sm:text-3xl">Where will the pieces take you?</h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-[#5f756c]">Swap two pieces at a time to bring the picture together. Solve it to reveal the destination and turn inspiration into a trip.</p>
          <p aria-live="polite" className="mt-4 text-xs font-bold text-[#547067]">{solved ? `Solved in ${moves} swaps` : selected === null ? `Choose a piece · ${moves} ${moves === 1 ? "swap" : "swaps"}` : "Now choose another piece to swap."}</p>
          <p className="mt-5 text-[0.68rem] leading-5 text-[#819188]">Destination photos are matched to their named places. Only real partner listings and links appear in Finds.</p>
        </div>
        <div className="p-4 sm:p-7 lg:p-9">
          <div role="group" aria-label={`Jigsaw puzzle: ${destination.alt}`} className="mx-auto grid aspect-square w-full max-w-[29rem] grid-cols-3 gap-1.5 overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_10px_34px_rgba(39,88,80,0.12)] sm:gap-2 sm:p-2">
            {order.map((piece, position) => {
              const row = Math.floor(piece / 3);
              const column = piece % 3;
              return <button key={position} type="button" onClick={() => selectPiece(position)} aria-label={`Puzzle piece ${position + 1}${selected === position ? ", selected" : ""}`} aria-pressed={selected === position} className={`relative min-h-0 overflow-hidden rounded-lg transition duration-200 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#16877f] ${selected === position ? "z-[1] scale-[0.96] ring-4 ring-[#16877f]" : "hover:brightness-105"}`} style={{ backgroundImage: `url("${destination.image.src}")`, backgroundSize: "300% 300%", backgroundPosition: `${column * 50}% ${row * 50}%` }} />;
            })}
          </div>
          {solved ? <div className="mx-auto mt-5 max-w-[29rem] rounded-2xl border border-[#dce9df] bg-[#f5faf5] p-4 sm:p-5" style={{ animation: "roamly-enter 360ms ease both" }}>
            <p role="status" aria-live="polite" className="text-lg font-black text-[#203c43]">You found {destination.city}, {destination.country}! ✨</p>
            <p className="mt-1 text-sm leading-6 text-[#60766e]">Make it a real trip. Explore planning, compare current fares, or find a stay through Booking.com (via Stay22 where configured).</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/plan?destination=${encodeURIComponent(destination.city)}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#16877f] px-5 text-xs font-extrabold text-white hover:bg-[#11756e]">Plan a trip</a>
              <a href={`/finds?destination=${encodeURIComponent(destination.city)}#finds-tab-flights`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#b8d6ca] bg-white px-5 text-xs font-extrabold text-[#28665d] hover:bg-[#f1f8f2]">Check flights</a>
              <a href={`/finds?destination=${encodeURIComponent(destination.city)}#finds-tab-stays`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#b8d6ca] bg-white px-5 text-xs font-extrabold text-[#28665d] hover:bg-[#f1f8f2]">Find hotels</a>
              <button type="button" onClick={nextPuzzle} className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-xs font-extrabold text-[#16877f] hover:bg-white">Next puzzle →</button>
            </div>
            <p className="mt-3 text-[0.68rem] leading-5 text-[#819188]">Affiliate availability depends on partner approval and production configuration. Prices and booking are confirmed with each provider.</p>
          </div> : <p className="mx-auto mt-3 max-w-[29rem] text-center text-xs text-[#819188]">Tap a tile, then another tile to swap them.</p>}
        </div>
      </div>
    </div>
  </section>;
}
