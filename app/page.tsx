import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { BuiButtonLink } from "@/components/boardui/Button";
import { PLAN_START_NOTE } from "@/lib/roamly/planTripUx";
import { DynamicDestinationHero } from "@/components/roamly/DynamicDestinationHero";
import { CityPuzzle } from "@/components/roamly/CityPuzzle";
import { BookYourTrip } from "@/components/roamly/BookYourTrip";
import { HouseAdSlot } from "@/components/roamly/HouseAdCard";

export default function Home() {
  return (
    <div className="safe-bottom overflow-hidden bg-[#F2F6FC] text-ink">
      <DynamicDestinationHero />
      <CityPuzzle />

      <section id="the-journey" className="roamly-enter mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14 lg:px-12" style={{ animationDelay: "80ms" }}>
        <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-16">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#087BFF]">The planning moment</p><h2 className="mt-3 max-w-md text-3xl font-bold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl">From a feeling to a day you can follow.</h2><p className="mt-4 max-w-sm text-sm leading-6 text-slate-600">Roamly keeps the big picture and the next decision together.</p><div className="mt-6 flex flex-wrap items-center gap-3"><BuiButtonLink href="/plan" className="rounded-full">Plan a trip</BuiButtonLink><BuiButtonLink href="/finds" variant="secondary" className="rounded-full">Explore Finds</BuiButtonLink></div></div>
          <div className="relative py-1 sm:pl-4"><div className="flex items-start justify-between gap-4 border-b border-[#DCE5F0] pb-4"><div><p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#087BFF]">A considered day · 02</p><h3 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">Room to wander</h3></div><span className="shrink-0 text-sm font-bold text-[#087BFF]">Barcelona</span></div>
            <div className="relative mt-4 border-l-2 border-[#b8ded4] pl-5 sm:pl-6">
              {[['Morning','Gothic Quarter','walk + coffee','087BFF'],['Afternoon','One good plan','nearby, with room','FF793D'],['Evening','Choose your pace','free to choose','8957E5']].map(([time,title,detail,color], index) => <div key={time}><div className="relative grid grid-cols-[4.5rem_1fr] items-center gap-3 py-2"><span aria-hidden="true" className="absolute -left-[1.85rem] grid h-4 w-4 place-items-center rounded-full ring-4 ring-[#f4efe5]" style={{ backgroundColor: `#${color}` }} /><span className="text-xs font-bold text-slate-600">{time}</span><div className={index < 2 ? "border-b border-[#DCE5F0] pb-2" : "pb-2"}><p className="text-sm font-bold text-ink">{title}</p><p className="mt-0.5 text-xs text-slate-600">{detail}</p></div></div>{index < 2 && <p className="py-1 text-[0.68rem] font-bold text-[#087BFF]"><ArrowDown aria-hidden="true" size={11} strokeWidth={2.5} className="inline-block align-[-1px]" /> {index === 0 ? "nearby" : "room left intentionally"}</p>}</div>)}
            </div>
            <p className="mt-4 border-t border-[#DCE5F0] pt-3 text-[0.68rem] font-bold text-slate-600">Budget still in view</p>
          </div>
        </div>
      </section>

      <section className="roamly-enter bg-[#E6EFFA] px-5 py-14 text-[#223354] sm:px-8 sm:py-20 lg:px-12" style={{ animationDelay: "140ms" }}><div className="mx-auto grid w-full max-w-7xl gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:gap-16"><div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#087BFF]">When the trip becomes real</p><h2 className="mt-3 max-w-xl text-3xl font-bold leading-[1] tracking-[-0.04em] sm:text-4xl">Roamly comes with you.</h2><p className="mt-4 max-w-md text-sm leading-6 text-[#657795]">Keep the next useful thing close while you are already on the move.</p></div><div className="rounded-[1.5rem] border border-[#cfe5d8] bg-white/90 p-5 shadow-bui-card bui-lift sm:p-7"><div className="flex items-center justify-between gap-3"><p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-[#087BFF]">Live Companion · premium</p><span className="rounded-full bg-[#E5F6EE] px-3 py-1 text-xs font-bold text-[#657795]">Your trip, in the moment</span></div><div className="mt-5 rounded-2xl bg-[#f4f8ef] p-4"><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#657795]">Now</p><p className="mt-1 text-xl font-bold text-[#223354]">Dinner in the old quarter</p></div><div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#e4eee5] bg-white p-4"><span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#FFF0E6] text-[#B4501B]"><ArrowRight size={16} strokeWidth={2.5} /></span><div><p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#657795]">Whenever you’re ready</p><p className="mt-1 text-base font-bold text-[#657795]">An evening left open</p></div></div></div></div></section>

      <BookYourTrip />

      <section className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 lg:px-12">
        <HouseAdSlot context="home" placement="home" />
      </section>

      <section className="roamly-enter bg-[#E6EFFA] px-5 py-12 text-[#223354] sm:px-8 sm:py-16 lg:px-12" style={{ animationDelay: "200ms" }}><div className="mx-auto flex w-full max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#087BFF]">Your next somewhere</p><h2 className="mt-2 max-w-xl text-3xl font-bold leading-[1] tracking-[-0.04em] sm:text-4xl">Make room for a trip that feels like yours.</h2></div><div className="shrink-0"><div className="flex flex-wrap items-center gap-3"><BuiButtonLink href="/plan" className="min-h-12 rounded-full px-6">Start planning</BuiButtonLink><BuiButtonLink href="/pricing" variant="secondary" className="rounded-full">See pricing</BuiButtonLink></div><p className="mt-2 text-xs font-semibold text-[#657795]">{PLAN_START_NOTE}</p></div></div></section>
      <footer className="border-t border-[#DCE5F0] bg-[#F2F6FC] px-5 py-8 text-[#657795] sm:px-8 lg:px-12"><div className="mx-auto flex w-full max-w-7xl flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold text-[#657795]">Roamly — travel planning that stays with the trip.</p><div className="flex flex-wrap gap-5 font-semibold text-[#657795]"><Link href="/pricing" className="transition-colors hover:text-[#087BFF]">Pricing</Link><Link href="/terms" className="transition-colors hover:text-[#087BFF]">Terms</Link><Link href="/privacy" className="transition-colors hover:text-[#087BFF]">Privacy</Link><Link href="/contact" className="transition-colors hover:text-[#087BFF]">Contact</Link></div></div><p className="mx-auto mt-4 w-full max-w-7xl text-xs font-semibold text-[#657795]">Place data © OpenStreetMap contributors · © Overture Maps Foundation</p></footer>
    </div>
  );
}
