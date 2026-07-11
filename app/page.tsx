import Link from "next/link";
import { HomepageTravelShowcase } from "@/components/roamly/HomepageTravelShowcase";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const trustCards = [
  {
    title: "AI budget check",
    body: "See whether your route fits your budget before generating the full itinerary."
  },
  {
    title: "Multi-city planning",
    body: "Plan 2, 3, 5, or more cities in one connected route."
  },
  {
    title: "Booking screenshot import",
    body: "Upload flight, hotel, train, or activity screenshots so Roamly can plan around what you already booked."
  },
  {
    title: "Live Trip Companion",
    body: "Turn your itinerary into reminders, check-ins, and next-step guidance while traveling."
  },
  {
    title: "Private by design",
    body: "Your trip details stay connected to your account and are used to build your itinerary."
  },
  {
    title: "No surprise subscriptions",
    body: "Start free, then unlock extra planning or companion features only when you need them."
  }
];

const upgradeCards = [
  {
    title: "Free start",
    body: "Create your first AI itinerary free."
  },
  {
    title: "More itinerary planning",
    body: "If you need another full itinerary, Roamly will offer an unlock when you reach that step."
  },
  {
    title: "Live Companion",
    body: "Add live reminders and trip guidance when you want Roamly with you during the trip."
  },
  {
    title: "Complete Trip Pack",
    body: "Unlock itinerary planning and companion features together when it makes sense."
  }
];

const workflow = [
  ["Route", "Choose an origin, one destination, or a connected multi-city path."],
  ["Budget", "Roamly checks broad travel costs before the full itinerary is generated."],
  ["Bookings", "Add screenshots or confirmations so the AI respects fixed plans."],
  ["Companion", "Turn the locked itinerary into reminders and travel-day guidance."]
];

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden bg-[linear-gradient(180deg,#08111f_0%,#102033_42%,#f7fbff_42%,#ffffff_100%)]">
      <section className="relative px-4 pb-14 pt-10 text-white sm:px-6 sm:pb-20 sm:pt-16 lg:px-8">
        <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(84,214,198,0.20),transparent_34%),linear-gradient(245deg,rgba(129,140,248,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_58%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <Badge tone="sun">Premium AI travel planning</Badge>
            <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.94] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Plan smarter trips with AI that understands your budget.
            </h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-white/76 sm:text-lg">
              Roamly helps you build realistic single-city or multi-city itineraries, check your budget before you go,
              organize bookings, and turn your trip into a live companion.
            </p>
            <div className="mt-7 grid gap-3 sm:flex">
              <Button href="/plan" className="min-h-12 bg-white px-6 text-ink hover:bg-lagoon">
                Start planning
              </Button>
              <Button
                href="#how-it-works"
                tone="ghost"
                className="min-h-12 border border-white/18 bg-white/[0.08] px-6 text-white hover:bg-white/[0.14]"
              >
                See how it works
              </Button>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                "Start with a free AI itinerary.",
                "No subscription required.",
                "Pay only when you unlock more planning or companion features."
              ].map((item) => (
                <div key={item} className="rounded-[1.25rem] border border-white/14 bg-white/[0.08] px-4 py-3 backdrop-blur">
                  <p className="text-sm font-black leading-5 text-white/86">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <HomepageTravelShowcase />
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge>How it works</Badge>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              A cleaner planning flow before anything is locked.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Start with route, dates, budget, and travel style. Roamly checks the plan before building the full itinerary.
          </p>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-4">
          {workflow.map(([title, body], index) => (
            <Card key={title} className="p-5 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
              <p className="grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-black text-white">
                {index + 1}
              </p>
              <h3 className="mt-4 text-xl font-black text-ink">{title}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-[2rem] bg-[linear-gradient(135deg,#0b1220,#102033_48%,#16324f)] p-5 text-white shadow-[0_28px_90px_rgba(2,6,23,0.22)] sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
            <div>
              <Badge tone="sun">Trust built in</Badge>
              <h2 className="mt-4 max-w-xl text-3xl font-black tracking-tight sm:text-5xl">
                Designed for trips with real constraints.
              </h2>
              <p className="mt-4 text-sm font-bold leading-7 text-white/72">
                Budgets, bookings, pacing, walking tolerance, and city order all become planning context instead of
                afterthoughts.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {trustCards.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-[1.35rem] border border-white/14 bg-white/[0.08] p-4 backdrop-blur transition hover:-translate-y-1 hover:bg-white/[0.12]"
                >
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-lagoon">{feature.title}</p>
                  <p className="mt-3 text-sm font-bold leading-6 text-white/78">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge tone="sun">How upgrades work</Badge>
            <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Start free, then unlock only when the trip needs more.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Upgrade prompts appear at the moment you need another itinerary or want live trip support. No subscription required.
          </p>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {upgradeCards.map((item) => (
            <Card key={item.title} className="p-5 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{item.title}</p>
              <p className="mt-4 text-sm font-bold leading-6 text-slate-600">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="relative overflow-hidden rounded-[2rem] border border-ink/10 bg-white p-6 shadow-soft sm:p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#54d6c6,#818cf8,#ffb84d)]" />
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Badge>Plan with confidence</Badge>
              <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-ink sm:text-5xl">
                Build the trip before you book the stress.
              </h2>
              <p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
                Start with your route, dates, budget, and travel style. Roamly checks the plan, then helps you generate a
                cleaner itinerary.
              </p>
            </div>
            <div className="grid gap-3 sm:min-w-72">
              <Button href="/plan" className="min-h-12">
                Start planning
              </Button>
              <Button href="/signup?next=/plan" tone="secondary" className="min-h-12">
                Create your free itinerary first
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10 pt-4 text-sm font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Roamly — premium AI travel planning for budget-aware trips.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/contact" className="hover:text-ink">Contact</Link>
        </div>
      </footer>
    </main>
  );
}
