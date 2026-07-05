import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const demoTrips = [
  {
    city: "Paris",
    meta: "5 days · $1,200 budget",
    focus: "Cafe mornings, museum afternoons, soft evening walks"
  },
  {
    city: "Tokyo",
    meta: "7 days · food + culture",
    focus: "Neighborhood days, ramen stops, temples, late markets"
  },
  {
    city: "Montreal",
    meta: "3 days · chill trip",
    focus: "Old port, bakeries, easy transit, low-pressure pacing"
  }
];

const steps = [
  "Tell Roamly where you are going",
  "Use your free itinerary",
  "Unlock itinerary or Complete Pack",
  "Follow it with Live Trip Companion"
];

const features = [
  { label: "AI itinerary", detail: "A trip plan that fits your days, budget, pace, and interests." },
  { label: "Live Trip Companion", detail: "Reminders, booked items, nearby activities, maps, checklist, and what is next." },
  { label: "Budget tracker", detail: "A practical cost view before the trip starts getting expensive." },
  { label: "Transport guide", detail: "Walking, transit, rideshare, rental car, or mixed route notes." },
  { label: "Hotel areas", detail: "Know which neighborhoods make sense before booking." },
  { label: "Locked final plan", detail: "Once generated, the itinerary stays stable and easy to follow." }
];

const liveTimeline = [
  { time: "9:00", title: "Coffee near the old town", tag: "easy start" },
  { time: "12:30", title: "Museum walk + local lunch", tag: "book ahead" },
  { time: "18:00", title: "Sunset viewpoint", tag: "map ready" }
];

export default function Home() {
  return (
    <main className="safe-bottom">
      <section className="relative isolate min-h-[calc(100dvh-4.25rem)] overflow-hidden px-4 py-7 text-white sm:px-6 lg:px-8">
        <Image
          src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2200&q=85"
          alt="A scenic travel overlook with mountains, water, and a road ready for a trip"
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(16,32,51,0.72)_0%,rgba(16,32,51,0.52)_42%,rgba(16,32,51,0.86)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-[#f7fcff] to-transparent" />

        <div className="mx-auto flex min-h-[calc(100dvh-7.5rem)] w-full max-w-6xl flex-col justify-between gap-8">
          <div className="max-w-3xl pt-8 sm:pt-16">
            <Badge tone="sun">Plan for free</Badge>
            <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.92] tracking-tight sm:text-7xl">
              Your trip, planned and ready to follow.
            </h1>
            <p className="mt-5 max-w-xl text-base font-bold leading-7 text-white/86 sm:text-lg">
              Generate one itinerary free per account. Unlock new trips or Live Trip Companion when you are ready.
            </p>
            <div className="mt-7 grid gap-3 sm:flex">
              <Button href="/plan" className="bg-white text-ink hover:bg-lagoon">
                Plan my trip
              </Button>
              <Button href="#how-it-works" tone="secondary" className="bg-white/14 text-white ring-white/35 hover:bg-white hover:text-ink">
                See how it works
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.85fr_1fr] lg:items-end">
            <div className="rounded-[2rem] border border-white/18 bg-white/14 p-4 shadow-glow backdrop-blur-xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-lagoon">Live Trip Companion</p>
              <div className="mt-4 space-y-3">
                {liveTimeline.map((item) => (
                  <div key={item.time} className="grid grid-cols-[3.2rem_1fr] gap-3 rounded-2xl bg-white/13 p-3">
                    <p className="text-xs font-black text-lagoon">{item.time}</p>
                    <div>
                      <p className="text-sm font-black leading-5">{item.title}</p>
                      <p className="mt-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-white/58">{item.tag}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {demoTrips.map((trip) => (
                <div key={trip.city} className="rounded-[1.6rem] border border-white/18 bg-white/90 p-4 text-ink shadow-soft backdrop-blur">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{trip.city}</p>
                  <h2 className="mt-2 text-lg font-black">{trip.meta}</h2>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-600">{trip.focus}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge>How it works</Badge>
            <h2 className="mt-3 max-w-xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              From idea to live trip.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Roamly keeps planning simple, then becomes useful when the trip starts.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Card key={step} className="p-4">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-sm font-black text-white">
                {index + 1}
              </span>
              <p className="mt-4 text-lg font-black leading-6 text-ink">{step}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <Card className="overflow-hidden p-0">
            <Image
              src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85"
              alt="Clear beach water and travel shoreline used as a Roamly destination preview"
              width={1600}
              height={960}
              sizes="(min-width: 1024px) 45vw, 100vw"
              className="h-64 w-full object-cover sm:h-80"
            />
            <div className="p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Preview first</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-ink">Preview before lock.</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
                See the destination shape and day outline before generating a locked itinerary.
              </p>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            {features.map((feature) => (
              <Card key={feature.label} className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{feature.label}</p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{feature.detail}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="overflow-hidden rounded-[2rem] bg-ink text-white shadow-soft">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_0.85fr] lg:items-center">
            <div>
              <Badge tone="sun">No subscription</Badge>
              <h2 className="mt-4 max-w-xl text-3xl font-black tracking-tight sm:text-5xl">
                Unlock only the trip you need.
              </h2>
              <p className="mt-4 max-w-xl text-sm font-bold leading-6 text-white/72">
                One free itinerary per account. Full Itinerary Unlock is $4.99 CAD, or Complete Trip Pack with Live Trip Companion is $7.99 CAD.
              </p>
            </div>

            <div className="rounded-[1.6rem] border border-white/12 bg-white/10 p-4">
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-white p-4 text-ink">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Full trip</p>
                  <p className="mt-1 text-3xl font-black">$7.99</p>
                  <p className="mt-1 text-xs font-black text-slate-500">Complete Pack</p>
                </div>
                <Button href="/plan">Start free</Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black text-white/78">
                <p className="rounded-2xl bg-white/10 p-3">Save trip</p>
                <p className="rounded-2xl bg-white/10 p-3">Companion</p>
                <p className="rounded-2xl bg-white/10 p-3">Budget</p>
                <p className="rounded-2xl bg-white/10 p-3">Locked plan</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 text-sm font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Roamly · Plan for free. Unlock when ready.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/contact" className="hover:text-ink">Contact</Link>
        </div>
      </footer>
    </main>
  );
}
