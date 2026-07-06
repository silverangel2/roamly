"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const heroDestinations = [
  {
    name: "Paris",
    image: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1600&q=85",
    detail: "Museum mornings, cafe afternoons, golden-hour walks."
  },
  {
    name: "Tokyo",
    image: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=85",
    detail: "Neon nights, calm shrines, food stops that fit the day."
  },
  {
    name: "Banff",
    image: "https://images.unsplash.com/photo-1500048993953-d23a436266cf?auto=format&fit=crop&w=1600&q=85",
    detail: "Lake views, mountain routes, weather-aware timing."
  },
  {
    name: "Bali",
    image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1600&q=85",
    detail: "Beach time, temples, cafes, and easy day pacing."
  }
];

const sideDestinations = [
  {
    name: "Singapore",
    image: "https://images.unsplash.com/photo-1525625293386-3f8f99389edd?auto=format&fit=crop&w=1200&q=85"
  },
  {
    name: "Rome",
    image: "https://images.unsplash.com/photo-1529260830199-42c24126f198?auto=format&fit=crop&w=1200&q=85"
  }
];

export function HomepageTravelShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = heroDestinations[activeIndex];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % heroDestinations.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="group relative min-h-[24rem] overflow-hidden rounded-[2rem] border border-white/70 shadow-soft">
        {heroDestinations.map((destination, index) => (
          <Image
            key={destination.name}
            src={destination.image}
            alt={`${destination.name} Roamly travel destination`}
            fill
            priority={index === 0}
            sizes="(min-width: 1024px) 48vw, 100vw"
            className={`object-cover transition duration-1000 ease-out group-hover:scale-105 ${
              index === activeIndex ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/82 via-ink/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-5 text-white sm:p-6">
          <p className="inline-flex rounded-full bg-white/18 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] backdrop-blur">
            Featured destination
          </p>
          <h2 className="mt-3 text-4xl font-black leading-none tracking-tight sm:text-5xl">{active.name}</h2>
          <p className="mt-2 max-w-md text-sm font-bold leading-6 text-white/82">{active.detail}</p>
          <div className="mt-4 flex gap-2">
            {heroDestinations.map((destination, index) => (
              <button
                key={destination.name}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Show ${destination.name}`}
                className={`h-2.5 rounded-full transition-all ${
                  index === activeIndex ? "w-9 bg-lagoon" : "w-2.5 bg-white/60"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        {sideDestinations.map((destination, index) => (
          <article
            key={destination.name}
            className={`group relative min-h-[11rem] overflow-hidden rounded-[1.75rem] border border-white/70 shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-glow ${
              index === 1 ? "mt-8" : ""
            }`}
          >
            <Image
              src={destination.image}
              alt={`${destination.name} tourist spot preview`}
              fill
              sizes="(min-width: 1024px) 20vw, 50vw"
              className="object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/10 to-transparent" />
            <p className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-2 text-xs font-black text-ink backdrop-blur">
              {destination.name}
            </p>
          </article>
        ))}
        <div className="col-span-2 rounded-[1.75rem] border border-white/70 bg-white/88 p-5 shadow-soft backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">More places to explore</p>
          <p className="mt-2 text-2xl font-black text-ink">Pick a place, then Roamly fits the trip to the budget.</p>
        </div>
      </section>
    </div>
  );
}
