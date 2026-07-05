import { getBookingLinks } from "@/lib/affiliate-links";
import type { RoamlyTripRecord } from "@/lib/trips";

export function BookingCards({ trip }: { trip: RoamlyTripRecord }) {
  const links = getBookingLinks(trip);

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {links.map((link) => (
        <a
          key={link.title}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-ocean/40"
        >
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{link.label}</p>
          <h3 className="mt-2 text-lg font-black text-ink">{link.title}</h3>
          <p className="mt-2 text-sm font-bold leading-5 text-slate-500">{link.description}</p>
        </a>
      ))}
    </section>
  );
}
