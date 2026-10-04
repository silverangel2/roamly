const FLIGHTS_AFFILIATE_URL =
  "https://tpwdgt.com/content?currency=usd&trs=549715&shmarker=750294&target_host=www.aviasales.com%2Fsearch&locale=en&limit=6&powered_by=true&primary=%230085FF&promo_id=4044&campaign_id=100";

const DEALS = [
  {
    title: "Hotels",
    via: "Search hotels worldwide · via Stay22",
    href: "https://booking.stay22.com/roamly/YhpfMFjm2n",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 18v2m18-2v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3" />
      </svg>
    )
  },
  {
    title: "Flights",
    via: "Find cheap flights · Aviasales via Travelpayouts",
    href: FLIGHTS_AFFILIATE_URL,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    )
  },
  {
    title: "Tours & activities",
    via: "Book tours & experiences · KKday via Travelpayouts",
    href: "https://kkday.tpo.lu/DrPvqlSH",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
      </svg>
    )
  },
  {
    title: "Airport transfers",
    via: "Book door-to-door rides · Intui via Travelpayouts",
    href: "https://intui.tpo.lu/6GQiV5Ai",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16V8a1 1 0 011-1h9a1 1 0 011 1v8M14 9h3.5L21 12.5V16M3 16h18" />
        <circle cx="7.5" cy="18" r="1.8" />
        <circle cx="17" cy="18" r="1.8" />
      </svg>
    )
  },
  {
    title: "Travel gear",
    via: "Shop travel essentials · Amazon Associates",
    href: "https://amazon.ca/s?k=travel+gear+essentials&tag=roamly060-20",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 8V6a3 3 0 016 0v2m-9 0h12a1 1 0 011 1v9a3 3 0 01-3 3H8a3 3 0 01-3-3V9a1 1 0 011-1z" />
      </svg>
    )
  }
];

export function FindsTravelDeals() {
  return (
    <section aria-label="Travel deals" className="mx-auto w-full max-w-xl px-2 py-10 sm:py-14">
      <h2 className="text-center text-3xl font-extrabold tracking-tight text-[#203c43] sm:text-4xl">
        Travel deals
      </h2>
      <p className="mx-auto mt-3 max-w-md text-center text-[0.95rem] leading-6 text-slate-600">
        <span className="font-extrabold text-[#203c43]">Roamly&apos;s</span> hand-picked partners for
        hotels, flights, tours, transfers &amp; travel gear.
      </p>

      <div aria-hidden="true" className="my-6 border-t-2 border-dashed border-[#d8e2da]" />

      <div className="grid gap-4">
        {DEALS.map((deal) => (
          <a
            key={deal.title}
            href={deal.href}
            target="_blank"
            rel="sponsored nofollow noopener"
            className="group flex items-center gap-4 rounded-[1.4rem] bg-white p-4 shadow-[0_10px_30px_rgba(39,88,80,0.07)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(39,88,80,0.13)] motion-reduce:transform-none motion-reduce:transition-none sm:p-5"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#e9f2ec] text-[#0f6e66]">
              {deal.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-extrabold tracking-tight text-[#203c43]">
                {deal.title}
              </span>
              <span className="mt-0.5 block truncate text-sm text-slate-500">{deal.via}</span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-xl font-bold text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            >
              ↗
            </span>
          </a>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-md text-center text-xs leading-5 text-slate-500">
        These are affiliate links: if you book or buy through them, Roamly may earn a commission at
        no extra cost to you. It keeps the travel content free.
      </p>
    </section>
  );
}
