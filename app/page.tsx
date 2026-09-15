import Image from "next/image";
import Link from "next/link";
import { HomepageTravelShowcase } from "@/components/roamly/HomepageTravelShowcase";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const journey = [
  ["01", "Shape the trip", "Share where you want to go, when you are going, and what kind of days you enjoy."],
  ["02", "Make it make sense", "Roamly brings route, pace, budget, bookings, and real travel options into one plan."],
  ["03", "Take it with you", "Keep the plan, essentials, and confirmed details close when the trip becomes real."]
];

const destinations = [
  ["Paris", "France", "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=85"],
  ["Tokyo", "Japan", "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=85"],
  ["Montreal", "Canada", "https://images.unsplash.com/photo-1519178614-68673b201f36?auto=format&fit=crop&w=1200&q=85"]
];

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden bg-[#fbf8ef] text-ink">
      <section className="relative isolate px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-14 lg:px-8 lg:pb-28 lg:pt-20">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_16%,rgba(84,214,198,0.18),transparent_30%),radial-gradient(circle_at_88%_10%,rgba(255,184,77,0.18),transparent_28%),linear-gradient(180deg,#f4fbfa_0%,#fbf8ef_62%,#fbf8ef_100%)]" />
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:gap-16">
          <div>
            <p className="roamly-eyebrow">Travel planning, with room to breathe</p>
            <h1 className="mt-5 max-w-2xl text-[2.75rem] font-bold leading-[0.98] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[4.7rem]">Your whole trip, thoughtfully put together.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-700 sm:text-lg sm:leading-8">Roamly turns a destination and a few good instincts into a practical plan you can actually enjoy—before you go and while you are there.</p>
            <div className="mt-8 grid gap-3 sm:flex sm:items-center">
              <Button href="/plan" className="min-h-12 px-6">Start planning</Button>
              <Link href="#how-it-works" className="inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-3 text-sm font-bold text-ocean transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ocean/25">See how Roamly works</Link>
            </div>
            <p className="mt-5 text-sm font-medium text-slate-500">One full itinerary is included per account, for life.</p>
          </div>
          <HomepageTravelShowcase />
        </div>
      </section>

      <section className="border-y border-[#e7dfd2] bg-[#fffdf8] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-2 text-sm font-semibold text-slate-600">
          <span className="text-ink">A calmer way to travel</span><span>Plan around your real life</span><span>Keep costs in view</span><span>Know what is confirmed</span>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="roamly-eyebrow">From first idea to leaving day</p>
          <h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] text-ink sm:text-5xl">The plan gets clearer as your trip gets closer.</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">Start with the shape of the trip. Roamly helps connect the decisions that are easy to make separately but difficult to hold together.</p>
        </div>
        <div className="mt-10 grid gap-8 border-t border-[#e7dfd2] pt-8 md:grid-cols-3 md:gap-6">
          {journey.map(([number, title, body]) => (
            <article key={number} className="max-w-sm">
              <p className="text-sm font-bold text-ocean">{number}</p><h3 className="mt-4 text-xl font-bold tracking-tight text-ink">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-ink px-4 py-16 text-white sm:px-6 sm:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-lagoon">Built for real decisions</p><h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-5xl">Less searching. More knowing what fits.</h2></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="border-l border-white/20 pl-5"><h3 className="text-lg font-bold">A plan with context</h3><p className="mt-2 text-sm leading-6 text-white/70">Your dates, pace, interests, route, budget, and existing bookings belong in the same conversation.</p></div>
            <div className="border-l border-white/20 pl-5"><h3 className="text-lg font-bold">Honest when details are not</h3><p className="mt-2 text-sm leading-6 text-white/70">Roamly keeps unknown prices, timings, and confirmations visible instead of polishing them into false certainty.</p></div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="max-w-2xl"><p className="roamly-eyebrow">Where will it take you?</p><h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] text-ink sm:text-5xl">Begin with somewhere that feels like you.</h2></div><p className="max-w-xs text-sm leading-6 text-slate-600">A destination is only the beginning. The shape of the days is what makes a trip yours.</p></div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {destinations.map(([city, country, image]) => (
            <article key={city} className="group relative min-h-72 overflow-hidden rounded-[1.5rem] border border-[#e7dfd2] bg-[#fffdf8] shadow-[0_10px_28px_rgba(16,32,51,0.05)]"><Image src={image} alt={`${city}, ${country}`} fill sizes="(min-width: 640px) 33vw, 100vw" className="object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,51,0.02)_25%,rgba(16,32,51,0.78)_100%)]" /><div className="absolute inset-x-0 bottom-0 p-5 text-white"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">{country}</p><h3 className="mt-1 text-2xl font-bold tracking-tight">{city}</h3></div></article>
          ))}
        </div>
      </section>

      <section className="px-4 pb-16 sm:px-6 sm:pb-24"><div className="mx-auto grid w-full max-w-6xl gap-8 overflow-hidden rounded-[1.75rem] bg-[#e8f5f1] p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center"><div className="max-w-2xl"><Badge tone="sun">When the trip begins</Badge><h2 className="mt-4 text-3xl font-bold leading-tight tracking-[-0.035em] text-ink sm:text-4xl">Roamly stays useful after the plan is made.</h2><p className="mt-4 text-sm leading-7 text-slate-700 sm:text-base">Live Companion is a paid premium experience for active-trip guidance, so the right next step stays close when you are moving.</p></div><Link href="/plan" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#1c334b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/25">Build your trip</Link></div></section>

      <footer className="bg-ink px-4 py-9 text-white sm:px-6"><div className="mx-auto flex w-full max-w-6xl flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-white/75">Roamly — travel planning that stays with the trip.</p><div className="flex flex-wrap gap-4 font-semibold"><Link href="/terms" className="text-white/65 hover:text-white">Terms</Link><Link href="/privacy" className="text-white/65 hover:text-white">Privacy</Link><Link href="/contact" className="text-white/65 hover:text-white">Contact</Link></div></div></footer>
    </main>
  );
}
