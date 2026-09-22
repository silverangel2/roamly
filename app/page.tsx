import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { DynamicDestinationHero } from "@/components/roamly/DynamicDestinationHero";

export default function Home() {
  return (
    <main className="safe-bottom overflow-hidden bg-[#f4efe5] text-ink">
      <DynamicDestinationHero />

      <section id="the-journey" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-16">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#167b86]">The planning moment</p><h2 className="mt-3 max-w-md text-3xl font-bold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl">From a feeling to a day you can follow.</h2><p className="mt-4 max-w-sm text-sm leading-6 text-slate-600">Roamly keeps the big picture and the next decision together.</p></div>
          <div className="relative py-1 sm:pl-4"><div className="flex items-start justify-between gap-4 border-b border-[#d8e5dd] pb-4"><div><p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#167b86]">A considered day · 02</p><h3 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">Room to wander</h3></div><span className="shrink-0 text-sm font-bold text-[#167b86]">Barcelona</span></div>
            <div className="relative mt-4 border-l-2 border-[#b8ded4] pl-5 sm:pl-6">
              {[['Morning','Gothic Quarter','walk + coffee','4fd1bd'],['Afternoon','One good plan','nearby, with room','f6bd68'],['Evening','Choose your pace','free to choose','ef866f']].map(([time,title,detail,color], index) => <div key={time}><div className="relative grid grid-cols-[4.5rem_1fr] items-center gap-3 py-2"><span aria-hidden="true" className="absolute -left-[1.85rem] grid h-4 w-4 place-items-center rounded-full ring-4 ring-[#f4efe5]" style={{ backgroundColor: `#${color}` }} /><span className="text-xs font-bold text-slate-500">{time}</span><div className={index < 2 ? "border-b border-[#d8e5dd] pb-2" : "pb-2"}><p className="text-sm font-bold text-ink">{title}</p><p className="mt-0.5 text-xs text-slate-500">{detail}</p></div></div>{index < 2 && <p className="py-1 text-[0.68rem] font-bold text-[#167b86]">↓ {index === 0 ? "nearby" : "room left intentionally"}</p>}</div>)}
            </div>
            <p className="mt-4 border-t border-[#d8e5dd] pt-3 text-[0.68rem] font-bold text-slate-500">Budget still in view</p>
          </div>
        </div>
      </section>

      <section className="relative isolate overflow-hidden px-5 py-14 text-white sm:px-8 sm:py-20 lg:px-12"><Image src="https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=1800&q=88" alt="Warm evening lights in a lively destination" fill sizes="100vw" className="absolute inset-0 -z-20 object-cover" /><div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(10,28,39,0.82),rgba(10,28,39,0.38),rgba(10,28,39,0.22))]" /><div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:gap-16"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9fe6d7]">When the trip becomes real</p><h2 className="mt-3 max-w-xl text-3xl font-bold leading-[1] tracking-[-0.04em] sm:text-4xl">Roamly comes with you.</h2><p className="mt-4 max-w-md text-sm leading-6 text-white/78">Keep the next useful thing close while you are already on the move.</p></div><div className="rounded-[1.4rem] border border-white/25 bg-[#102834]/72 p-4 shadow-2xl backdrop-blur-md sm:p-6"><p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#f6bd68]">Live Companion · premium</p><div className="mt-4 border-l border-[#4fd1bd] pl-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-white/55">Now</p><p className="mt-1 text-xl font-bold">Dinner in the old quarter</p></div><div className="mt-4 border-l border-white/25 pl-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-white/55">Next</p><p className="mt-1 text-base font-bold">An evening left open</p></div></div></div></section>

      <section className="bg-[#e4f1ec] px-5 py-12 text-ink sm:px-8 sm:py-16 lg:px-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#167b86]">Your next somewhere</p><h2 className="mt-2 max-w-xl text-3xl font-bold leading-[1] tracking-[-0.04em] sm:text-4xl">Make room for a trip that feels like yours.</h2></div><div className="shrink-0"><div className="flex flex-wrap items-center gap-3"><Button href="/plan" className="min-h-12 bg-[#18313c] px-6 text-white hover:bg-[#254d5b]">Start planning</Button><Link href="/pricing" className="rounded-xl border border-[#18313c]/20 bg-white/80 px-5 py-3 text-sm font-bold text-[#18313c] transition hover:bg-white">See pricing</Link></div><p className="mt-2 text-xs font-semibold text-[#42655d]">One full itinerary included per account, for life.</p></div></div></section>
      <footer className="bg-[#102834] px-5 py-8 text-white sm:px-8 lg:px-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-white/70">Roamly — travel planning that stays with the trip.</p><div className="flex flex-wrap gap-5 font-semibold text-white/60"><Link href="/pricing" className="hover:text-white">Pricing</Link><Link href="/terms" className="hover:text-white">Terms</Link><Link href="/privacy" className="hover:text-white">Privacy</Link><Link href="/contact" className="hover:text-white">Contact</Link></div></div></footer>
    </main>
  );
}
