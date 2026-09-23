import type { Metadata } from "next";
import { CityPuzzle } from "@/components/roamly/CityPuzzle";

export const metadata: Metadata = {
  title: "The Roamly City Puzzle",
  description: "Three clues, one city. Take a little trip with the Roamly city puzzle."
};

export default function PlayPage() {
  return <div className="min-h-[80vh] bg-[#fbf8ef] px-4 py-10 text-[#203c43] sm:px-8 sm:py-16"><div className="mx-auto max-w-5xl"><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#0f6e66]">Roamly little adventures</p><h1 className="mt-3 max-w-3xl text-4xl font-black tracking-[-0.05em] sm:text-6xl">A city is hiding in these clues.</h1><p className="mt-4 max-w-2xl text-base leading-7 text-[#5c716c]">Take a moment, follow the hints, and see where your mind travels. Pick a daily puzzle or play a new one for fun.</p><div className="mt-8"><CityPuzzle /></div></div></div>;
}
