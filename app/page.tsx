import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

const journey = [
  ["01", "Dream", "Start with the feeling you want from the trip."],
  ["02", "Shape", "Roamly turns dates, pace, interests, and budget into a route."],
  ["03", "Go", "Keep the decisions, essentials, and next step close."]
];

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden bg-[#f4efe5] text-ink">
      <section className="relative isolate min-h-[calc(100svh-8rem)] overflow-hidden bg-[#18313c] text-white sm:min-h-[calc(100svh-5.5rem)]">
        <Image src="https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=2200&q=88" alt="Barcelona rooftops and warm evening light" fill priority sizes="100vw" className="absolute inset-0 -z-20 object-cover object-[58%_center]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,28,39,0.9)_0%,rgba(10,28,39,0.62)_44%,rgba(10,28,39,0.14)_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(10,28,39,0.78)_0%,transparent_42%,rgba(10,28,39,0.28)_100%)]" />
        <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-7xl flex-col justify-between px-5 pb-44 pt-12 sm:min-h-[calc(100svh-5.5rem)] sm:px-8 sm:pb-12 sm:pt-16 lg:px-12">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#9fe6d7]">Roamly · travel planning with intention</p>
            <h1 className="mt-5 max-w-3xl text-[3.35rem] font-bold leading-[0.91] tracking-[-0.055em] sm:text-6xl lg:text-[5.8rem]">Go somewhere. Roamly the rest.</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/82 sm:text-lg sm:leading-8">A trip plan shaped around the way you actually want to travel.</p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <Button href="/plan" className="min-h-12 bg-[#f6bd68] px-6 text-ink shadow-[0_12px_30px_rgba(246,189,104,0.24)] hover:bg-[#ffd18b]">Start planning</Button>
              <Link href="#the-journey" className="inline-flex min-h-11 items-center px-2 py-3 text-sm font-bold text-white/85 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30">See how it comes together <span aria-hidden="true" className="ml-2">↓</span></Link>
            </div>
          </div>
          <div className="mt-14 max-w-2xl border-t border-white/30 pt-4 sm:mt-16 sm:flex sm:items-end sm:justify-between sm:gap-8">
            <div><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#9fe6d7]">A sample Roamly trip</p><p className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Barcelona <span className="mx-2 text-white/45">→</span> four days with room to wander</p></div>
            <p className="mt-3 hidden text-sm font-medium text-white/65 sm:mt-0 sm:block sm:max-w-[12rem]">Illustrative product experience, not live availability.</p>
          </div>
        </div>
      </section>

      <section id="the-journey" className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-20">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#167b86]">The planning moment</p><h2 className="mt-4 max-w-md text-4xl font-bold leading-[0.98] tracking-[-0.045em] text-ink sm:text-5xl">From a feeling to a day you can follow.</h2><p className="mt-5 max-w-sm text-base leading-7 text-slate-600">Roamly keeps the big picture and the small decisions in the same place.</p></div>
          <div className="relative overflow-hidden rounded-[2rem] bg-[#fffaf1] p-5 shadow-[0_22px_70px_rgba(16,32,51,0.12)] sm:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#167b86]">Sample plan · day 02</p><h3 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">A city day with a little give.</h3></div><span className="shrink-0 rounded-full bg-[#e1f3ed] px-3 py-2 text-xs font-bold text-[#167b86]">Barcelona</span></div>
            <div className="relative mt-8 grid gap-0 sm:grid-cols-[7rem_1fr]">
              <div className="absolute bottom-5 left-[0.55rem] top-5 w-px bg-[#b8ded4] sm:left-[6.45rem]" />
              <div className="relative z-10 flex items-center gap-3 py-3 sm:contents"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#4fd1bd] ring-4 ring-[#e1f3ed]" /><span className="text-sm font-bold text-slate-500 sm:py-4">Morning</span><div className="border-b border-[#eadfce] py-3 pl-8 sm:py-4 sm:pl-5"><p className="font-bold text-ink">Market wander</p><p className="mt-1 text-sm text-slate-500">Start gently, close to the day’s center.</p></div></div>
              <div className="relative z-10 flex items-center gap-3 py-3 sm:contents"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#f6bd68] ring-4 ring-[#fff1d9]" /><span className="text-sm font-bold text-slate-500 sm:py-4">Afternoon</span><div className="border-b border-[#eadfce] py-3 pl-8 sm:py-4 sm:pl-5"><p className="font-bold text-ink">One good plan</p><p className="mt-1 text-sm text-slate-500">A considered stop, with space around it.</p></div></div>
              <div className="relative z-10 flex items-center gap-3 py-3 sm:contents"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#ef866f] ring-4 ring-[#fce5df]" /><span className="text-sm font-bold text-slate-500 sm:py-4">Evening</span><div className="py-3 pl-8 sm:py-4 sm:pl-5"><p className="font-bold text-ink">Choose your pace</p><p className="mt-1 text-sm text-slate-500">A flexible close, not another obligation.</p></div></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[#eadfce] pt-4 text-xs font-bold text-slate-500"><span>route-aware</span><span>budget-aware</span><span>honest about unknowns</span></div>
          </div>
        </div>
      </section>

      <section className="bg-[#18313c] px-5 py-16 text-white sm:px-8 sm:py-20 lg:px-12"><div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-20"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9fe6d7]">One trip, held together</p><h2 className="mt-4 max-w-lg text-4xl font-bold leading-[0.98] tracking-[-0.045em] sm:text-5xl">The plan is more than a list of places.</h2></div><div className="grid gap-0 border-t border-white/20 sm:grid-cols-3 sm:border-t-0">{journey.map(([number, title, body], index) => <div key={number} className={`relative border-white/20 py-5 sm:px-5 sm:py-0 ${index > 0 ? "border-t sm:border-l sm:border-t-0" : ""}`}><p className="text-sm font-bold text-[#f6bd68]">{number}</p><h3 className="mt-4 text-xl font-bold">{title}</h3><p className="mt-2 max-w-xs text-sm leading-6 text-white/65">{body}</p></div>)}</div></div></section>

      <section className="relative isolate overflow-hidden px-5 py-16 text-white sm:px-8 sm:py-24 lg:px-12"><Image src="https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=1800&q=88" alt="Warm evening lights in a lively destination" fill sizes="100vw" className="absolute inset-0 -z-20 object-cover" /><div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,28,39,0.9),rgba(10,28,39,0.48),rgba(10,28,39,0.3))]" /><div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:gap-20"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9fe6d7]">When the trip becomes real</p><h2 className="mt-4 max-w-xl text-4xl font-bold leading-[0.98] tracking-[-0.045em] sm:text-5xl">Roamly comes with you.</h2><p className="mt-5 max-w-md text-base leading-7 text-white/75">Live Companion keeps the next useful thing close when you are already on the move.</p></div><div className="rounded-[1.7rem] border border-white/20 bg-[#102834]/82 p-5 shadow-2xl backdrop-blur-md sm:p-7"><p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[#f6bd68]">Illustrative Live view</p><div className="mt-6 border-l border-[#4fd1bd] pl-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">Now</p><p className="mt-2 text-2xl font-bold">Dinner in the old quarter</p><p className="mt-2 text-sm text-white/65">The next step, without the noise.</p></div><div className="mt-6 border-l border-white/25 pl-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">Next</p><p className="mt-2 text-lg font-bold">An evening left open</p></div><p className="mt-7 border-t border-white/15 pt-4 text-xs leading-5 text-white/55">Live Companion is a paid premium experience for active-trip guidance.</p></div></div></section>

      <section className="bg-[#f6bd68] px-5 py-14 text-ink sm:px-8 sm:py-20 lg:px-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#74521f]">Your next somewhere</p><h2 className="mt-3 max-w-2xl text-4xl font-bold leading-[0.98] tracking-[-0.045em] sm:text-5xl">Make room for a trip that feels like yours.</h2></div><div className="shrink-0"><Button href="/plan" className="min-h-12 bg-[#18313c] px-6 text-white hover:bg-[#254d5b]">Start planning</Button><p className="mt-3 text-xs font-semibold text-[#74521f]">One full itinerary included per account, for life.</p></div></div></section>
      <footer className="bg-[#102834] px-5 py-8 text-white sm:px-8 lg:px-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-white/70">Roamly — travel planning that stays with the trip.</p><div className="flex flex-wrap gap-5 font-semibold text-white/60"><Link href="/terms" className="hover:text-white">Terms</Link><Link href="/privacy" className="hover:text-white">Privacy</Link><Link href="/contact" className="hover:text-white">Contact</Link></div></div></footer>
    </main>
  );
}
