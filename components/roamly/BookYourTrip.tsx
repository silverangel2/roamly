const PARTNERS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 18v2m18-2v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3" />
      </svg>
    ),
    title: "Stays",
    copy: "Hotels, apartments, and hideaways — search and book through our partner.",
    cta: "Find stays",
    href: "https://booking.stay22.com/roamly/YhpfMFjm2n",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
      </svg>
    ),
    title: "Tours & activities",
    copy: "Day trips, tickets, and local experiences via KKday.",
    cta: "Browse tours",
    href: "https://kkday.tpo.lu/DrPvqlSH",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8V6a3 3 0 016 0v2m-9 0h12a1 1 0 011 1v9a3 3 0 01-3 3H8a3 3 0 01-3-3V9a1 1 0 011-1z" />
      </svg>
    ),
    title: "Travel gear",
    copy: "Packing essentials travelers actually use.",
    cta: "Shop gear",
    href: "https://amazon.ca/s?k=travel+gear+essentials&tag=roamly060-20",
  },
];

export function BookYourTrip() {
  return (
    <section className="roamly-enter bg-[#fffdf7] px-5 py-14 sm:px-8 sm:py-20 lg:px-12" style={{ animationDelay: "170ms" }}>
      <div className="mx-auto w-full max-w-7xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#0f6e66]">Travel partners</p>
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
              className="group flex min-h-11 flex-col rounded-[1.5rem] border border-[#e0e8dc] bg-white p-6 shadow-[0_10px_30px_rgba(39,88,80,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(39,88,80,0.12)] motion-reduce:transform-none motion-reduce:transition-none"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf5ef] text-[#0f6e66]">
                {p.icon}
              </span>
              <h3 className="mt-4 text-xl font-bold tracking-tight text-ink">{p.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{p.copy}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#0f6e66]">
                {p.cta}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
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
