import Image from "next/image";
import Link from "next/link";
import { HomepageTravelShowcase } from "@/components/roamly/HomepageTravelShowcase";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const trustStrip = [
  "Built for realistic trips, not generic itineraries.",
  "Budget-aware.",
  "Multi-city ready.",
  "Booking-aware.",
  "Live companion ready."
];

const destinations = [
  {
    city: "Paris",
    country: "France",
    vibe: "Museums, cafes, romantic walks",
    tag: "Artful city route",
    image: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Tokyo",
    country: "Japan",
    vibe: "Food, neon streets, culture",
    tag: "Balanced food days",
    image: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Montreal",
    country: "Canada",
    vibe: "Old streets, festivals, cafes",
    tag: "Weekend-ready",
    image: "https://images.unsplash.com/photo-1519178614-68673b201f36?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Rome",
    country: "Italy",
    vibe: "Ancient streets, pasta, piazzas",
    tag: "History-rich route",
    image: "https://images.unsplash.com/photo-1529260830199-42c24126f198?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Bali",
    country: "Indonesia",
    vibe: "Beaches, villas, slow travel",
    tag: "Relaxed pacing",
    image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "New York",
    country: "United States",
    vibe: "Museums, skyline, neighborhoods",
    tag: "Transit-friendly",
    image: "https://images.unsplash.com/photo-1485871981521-5b1fd3805eee?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Barcelona",
    country: "Spain",
    vibe: "Architecture, beaches, tapas",
    tag: "Sunset route",
    image: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=900&q=85"
  },
  {
    city: "Dubai",
    country: "United Arab Emirates",
    vibe: "Design, desert, warm nights",
    tag: "Comfort-first",
    image: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=900&q=85"
  }
];

const trustCards = [
  {
    label: "AI",
    title: "AI budget check",
    body: "Roamly checks your route, dates, and travel style before generating the full itinerary."
  },
  {
    label: "2+",
    title: "Multi-city routes",
    body: "Plan 2, 3, 5, or more cities in one connected trip."
  },
  {
    label: "PDF",
    title: "Booking screenshot import",
    body: "Upload flight, hotel, train, or activity confirmations so Roamly plans around what you already booked."
  },
  {
    label: "Live",
    title: "Live Trip Companion",
    body: "Get reminders, check-ins, and next-step guidance while traveling."
  },
  {
    label: "Map",
    title: "Global places",
    body: "Search cities around the world, not just a fixed destination list."
  },
  {
    label: "Free",
    title: "No surprise subscriptions",
    body: "Start free, then unlock more only when you need it."
  }
];

const workflow = [
  ["Route", "Choose a single destination or connect several cities into one smooth path."],
  ["Budget", "Add dates, style, and trip priorities so Roamly can check whether the plan feels realistic."],
  ["Bookings", "Upload confirmations and keep flights, stays, trains, and activities in the planning context."],
  ["Companion", "Travel with reminders, check-ins, and next-step guidance when the itinerary begins."]
];

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden bg-[#fffaf2] text-ink">
      <section className="relative isolate px-4 pb-14 pt-8 sm:px-6 sm:pb-20 sm:pt-14 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_8%_16%,rgba(84,214,198,0.22),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(255,184,77,0.26),transparent_27%),linear-gradient(180deg,#effaff_0%,#fffaf2_54%,#ffffff_100%)]" />
        <div className="absolute left-1/2 top-24 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-coral/16 blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-44 bg-[linear-gradient(180deg,transparent,#ffffff)]" />

        <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div className="lg:pt-8">
            <Badge tone="sun">Premium AI travel planning</Badge>
            <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Plan beautiful trips that actually fit your budget.
            </h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-slate-700 sm:text-lg">
              Roamly helps you build realistic single-city or multi-city itineraries, check costs before you go,
              organize bookings, and follow your trip with a live companion.
            </p>
            <div className="mt-7 grid gap-3 sm:flex">
              <Button href="/plan" className="min-h-12 bg-ink px-6 text-white hover:bg-ocean">
                Start planning
              </Button>
              <Button
                href="#how-it-works"
                tone="secondary"
                className="min-h-12 border border-ocean/20 bg-white/85 px-6 text-ink hover:border-ocean/40 hover:bg-white"
              >
                See how it works
              </Button>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {["Realistic routes", "Booking-aware plans", "Live trip guidance"].map((item) => (
                <div key={item} className="rounded-2xl border border-white bg-white/78 px-4 py-3 shadow-[0_14px_34px_rgba(16,32,51,0.08)] backdrop-blur">
                  <p className="text-sm font-black leading-5 text-ink">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <HomepageTravelShowcase />
        </div>
      </section>

      <section className="border-y border-cloud/80 bg-white/80 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
          {trustStrip.map((item) => (
            <span
              key={item}
              className="rounded-full border border-cloud bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 shadow-[0_10px_24px_rgba(16,32,51,0.06)]"
            >
              {item}
            </span>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <Badge>How it works</Badge>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Start with the shape of your trip. Roamly handles the messy middle.
            </h2>
          </div>
          <div className="rounded-[1.5rem] border border-cloud bg-white/84 p-5 shadow-soft backdrop-blur">
            <p className="text-sm font-bold leading-6 text-slate-600">
              Route, budget, bookings, and travel style come together before Roamly builds the day-by-day itinerary.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Paris", "Rome", "Barcelona", "Bali"].map((stop, index) => (
                <span key={stop} className="inline-flex items-center gap-2 rounded-full bg-mist px-3 py-2 text-xs font-black text-ink ring-1 ring-cloud">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-lagoon text-[0.65rem] text-ink">
                    {index + 1}
                  </span>
                  {stop}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {workflow.map(([title, body], index) => (
            <Card key={title} className="bg-white/86 p-5 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
              <p className="grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(135deg,#54d6c6,#ffb84d)] text-sm font-black text-ink">
                {index + 1}
              </p>
              <h3 className="mt-4 text-xl font-black text-ink">{title}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge tone="coral">Destination inspiration</Badge>
            <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Beautiful places, practical plans, and room for the trip to breathe.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Dream in color, then let Roamly check route flow, pacing, and budget before the itinerary is generated.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {destinations.map((destination, index) => (
            <article
              key={destination.city}
              className="group relative min-h-[22rem] overflow-hidden rounded-[1.45rem] border border-white bg-cloud shadow-soft"
            >
              <Image
                src={destination.image}
                alt={`${destination.city}, ${destination.country}`}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                priority={index < 2}
                className="object-cover transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,51,0.05)_20%,rgba(16,32,51,0.84)_100%)]" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/84">{destination.country}</p>
                <h3 className="mt-1 text-3xl font-black tracking-tight">{destination.city}</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-white/88">{destination.vibe}</p>
                <span className="mt-4 inline-flex rounded-full bg-white/94 px-3 py-2 text-xs font-black text-ink shadow-soft backdrop-blur">
                  {destination.tag}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="relative px-4 py-12 sm:px-6 sm:py-16">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#ffffff_0%,#eefbff_48%,#fff7ea_100%)]" />
        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <Badge>Travel confidence</Badge>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Premium planning tools without the cold dashboard feel.
            </h2>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trustCards.map((feature) => (
              <Card key={feature.title} className="min-h-56 bg-white/88 p-6 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(84,214,198,0.24),rgba(255,184,77,0.28))] text-xs font-black text-ink ring-1 ring-white">
                  {feature.label}
                </div>
                <h3 className="mt-5 text-xl font-black text-ink">{feature.title}</h3>
                <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{feature.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="relative overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff_0%,#effaff_52%,#fff0dc_100%)] p-6 shadow-soft sm:p-8 lg:p-10">
          <div className="absolute right-0 top-0 h-48 w-48 translate-x-12 -translate-y-16 rounded-full bg-lagoon/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-14 translate-y-12 rounded-full bg-coral/16 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Badge tone="sun">Ready when your trip is real</Badge>
              <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
                Ready to build a trip that feels possible?
              </h2>
              <p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
                Start with your route, budget, dates, and travel style. Roamly checks the plan before generating your itinerary.
              </p>
            </div>
            <div className="grid gap-3 sm:min-w-72">
              <Button href="/plan" className="min-h-12">
                Start planning
              </Button>
              <p className="text-center text-sm font-black text-slate-600">Your first itinerary starts free.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-ink px-4 py-9 text-white sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 text-sm font-bold sm:flex-row sm:items-center sm:justify-between">
          <p className="text-white/82">Roamly - premium AI travel planning for budget-aware trips.</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/terms" className="text-white/78 hover:text-white">Terms</Link>
            <Link href="/privacy" className="text-white/78 hover:text-white">Privacy</Link>
            <Link href="/contact" className="text-white/78 hover:text-white">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
