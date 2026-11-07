import type { Metadata } from "next";
import { CityPuzzle } from "@/components/roamly/CityPuzzle";

export const metadata: Metadata = {
  title: "The Roamly City Puzzle",
  description: "Three clues, one city. Take a little trip with the Roamly city puzzle.",
  // SEO (consolidation 2026-11-06, Block I / SEO-FIX-6): the page
  // had its own title but inherited the HOMEPAGE Open Graph block
  // (og:url at the root). It now carries its own OG + canonical.
  alternates: { canonical: "https://roamlyhq.com/play" },
  openGraph: {
    title: "The Roamly City Puzzle",
    description: "Three clues, one city. Take a little trip with the Roamly city puzzle.",
    url: "https://roamlyhq.com/play",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default function PlayPage() {
  return <div className="min-h-[80vh] bg-[#F2F6FC] px-4 py-10 text-[#203c43] sm:px-8 sm:py-16"><div className="mx-auto max-w-5xl"><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#087BFF]">Roamly little adventures</p><h1 className="mt-3 max-w-3xl text-4xl font-black tracking-[-0.05em] sm:text-6xl">A city is hiding in these clues.</h1><p className="mt-4 max-w-2xl text-base leading-7 text-[#5c716c]">Take a moment, follow the hints, and see where your mind travels. Pick a daily puzzle or play a new one for fun.</p><div className="mt-8"><CityPuzzle /></div></div></div>;
}
