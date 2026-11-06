import { ArrowRight, BedDouble, ShoppingBag, Ticket } from "lucide-react";
const PARTNERS = [
  {
    icon: (
      <BedDouble className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    ),
    title: "Stays",
    copy: "Hotels, apartments, and hideaways — search and book on Stay22.",
    cta: "Search stays on Stay22",
    href: "https://booking.stay22.com/roamly/YhpfMFjm2n",
  },
  {
    icon: (
      <Ticket className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    ),
    title: "Tours & activities",
    copy: "Day trips, tickets, and local experiences — book on KKday.",
    cta: "Book tours on KKday",
    href: "https://kkday.tpo.lu/DrPvqlSH",
  },
  {
    icon: (
      <ShoppingBag className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    ),
    title: "Travel gear",
    copy: "Packing essentials travelers actually use — shop on Amazon.",
    cta: "Shop gear on Amazon",
    href: "https://amazon.ca/s?k=travel+gear+essentials&tag=roamly060-20",
  },
];

export function BookYourTrip() {
  return (
    <section className="roamly-enter bg-[#F2F6FC] px-5 py-14 sm:px-8 sm:py-20 lg:px-12" style={{ animationDelay: "170ms" }}>
      <div className="mx-auto w-full max-w-7xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#087BFF]">Travel partners</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-xl text-3xl font-bold leading-[1] tracking-[-0.04em] text-ink sm:text-4xl">
            Book the trip you just planned.
          </h2>
          <p className="max-w-sm text-sm leading-6 text-slate-600">
            Stays, experiences, and gear from partners we use ourselves.
          </p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {PARTNERS.map((p) => (
            <a
              key={p.title}
              href={p.href}
              target="_blank"
              rel="sponsored nofollow noopener"
              className="group flex min-h-11 flex-col rounded-[1.5rem] border border-[#DCE5F0] bg-white p-6 shadow-bui-card bui-lift"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#E6EFFA] text-[#087BFF]">
                {p.icon}
              </span>
              <h3 className="mt-4 text-xl font-bold tracking-tight text-ink">{p.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{p.copy}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#087BFF]">
                {p.cta}
                <ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-slate-400">
                Partner link
              </span>
            </a>
          ))}
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Partner links — Roamly may earn a commission at no extra cost to you. It keeps the planning free.
        </p>
      </div>
    </section>
  );
}
