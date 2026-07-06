import Link from "next/link";
import { AdContainer } from "@/components/AdContainer";
import { HomepageTravelShowcase } from "@/components/roamly/HomepageTravelShowcase";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const features = [
  {
    title: "Budget-aware itineraries",
    body: "Roamly checks trip costs before building your plan, so your itinerary is designed around your real budget."
  },
  {
    title: "Booking screenshot import",
    body: "Upload hotel, flight, ticket, or reservation screenshots and Roamly turns them into your trip timeline."
  },
  {
    title: "Live Trip Companion",
    body: "Unlock reminders, packing lists, document checks, Day 1 activation, nearby activities, and up-next guidance."
  }
];

const pricing = [
  "$4.99 full itinerary",
  "$3.99 Live Trip Companion",
  "1 free itinerary per account"
];

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden">
      <section className="relative px-4 py-10 sm:px-6 lg:px-8">
        <div className="absolute inset-x-0 top-0 -z-10 h-[50rem] bg-[radial-gradient(circle_at_10%_15%,rgba(84,214,198,0.42),transparent_30rem),radial-gradient(circle_at_82%_18%,rgba(255,184,77,0.34),transparent_28rem),linear-gradient(135deg,#f6fdff,#fff9ec)]" />
        <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <Badge tone="sun">Premium mobile travel AI</Badge>
            <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Build trips that fit your budget, then travel with a live companion.
            </h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-slate-600 sm:text-lg">
              Roamly checks estimated flights, stays, activities, food, and local transport before creating your
              itinerary. Upload booking screenshots, unlock your trip, and let Roamly guide your travel day.
            </p>
            <div className="mt-7 grid gap-3 sm:flex">
              <Button href="/plan" className="min-h-12 px-6">
                Start planning
              </Button>
              <Button href="/pricing" tone="secondary" className="min-h-12 px-6">
                View pricing
              </Button>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              {pricing.map((item) => (
                <div key={item} className="rounded-2xl border border-cloud bg-white/85 px-4 py-3 shadow-soft">
                  <p className="text-sm font-black text-ink">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <HomepageTravelShowcase />
            <AdContainer />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <AdContainer />
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge>How Roamly helps</Badge>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              A smarter trip flow, from plan to travel day.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Plan with cost awareness, import what you book, and follow the trip from one clean mobile-friendly place.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="p-5 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{feature.title}</p>
              <p className="mt-4 text-sm font-bold leading-6 text-slate-600">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="overflow-hidden rounded-[2rem] bg-ink text-white shadow-soft">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_0.75fr] lg:items-center">
            <div>
              <Badge tone="sun">Live travel brain</Badge>
              <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl">
                From countdown to check-in, Roamly stays with the traveler.
              </h2>
              <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-white/76 sm:text-base">
                Get one-week reminders, document and packing checklists, 24-hour countdowns, booking timelines,
                nearby activity sensing, check-ins, skips, up-next guidance, and navigation links to Google Maps,
                Apple Maps, and Citymapper.
              </p>
            </div>

            <div className="rounded-[1.5rem] border border-white/12 bg-white/10 p-4">
              {[
                ["7 days", "Documents and packing"],
                ["24 hours", "Countdown and booking check"],
                ["Travel day", "Nearby, check in, up next"]
              ].map(([time, copy]) => (
                <div key={time} className="mb-3 rounded-2xl bg-white/10 px-4 py-3 last:mb-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-lagoon">{time}</p>
                  <p className="mt-1 text-sm font-black text-white">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_0.75fr] lg:items-center">
          <div>
            <Badge tone="sun">Ready when you are</Badge>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Start free. Unlock only when the trip is real.
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-bold leading-6 text-slate-600">
              One full itinerary is free per account. Paid unlocks are one-time purchases for one trip, not subscriptions.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button href="/plan">Start planning</Button>
              <Button href="/pricing" tone="secondary">See all pricing</Button>
            </div>
          </div>
          <AdContainer />
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 text-sm font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Roamly - budget-aware trips with a Live Trip Companion.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/contact" className="hover:text-ink">Contact</Link>
        </div>
      </footer>
    </main>
  );
}
