import { ArrowUpRight, BedDouble, CarFront, Send, ShoppingBag, Smartphone, Ticket, Truck, Wifi } from "lucide-react";
const FLIGHTS_AFFILIATE_URL =
  "https://aviasales.tpo.lu/ouGJJ2lr";

const DEALS = [
  {
    title: "Hotels",
    via: "Search hotels worldwide · via Stay22",
    href: "https://booking.stay22.com/roamly/YhpfMFjm2n",
    icon: (
      <BedDouble className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  },
  {
    title: "Flights",
    via: "Find cheap flights · Aviasales via Travelpayouts",
    href: FLIGHTS_AFFILIATE_URL,
    icon: (
      <Send className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  },
  {
    title: "Tours & activities",
    via: "Book tours & experiences · KKday via Travelpayouts",
    href: "https://kkday.tpo.lu/DrPvqlSH",
    icon: (
      <Ticket className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  },
  {
    title: "Airport transfers",
    via: "Book door-to-door rides · Intui via Travelpayouts",
    href: "https://intui.tpo.lu/6GQiV5Ai",
    icon: (
      <Truck className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  },
  {
    title: "Rental cars",
    via: "Find a car for the road · GetRentacar via Travelpayouts",
    href: "https://getrentacar.tpo.lu/l16uVhOn",
    icon: (
      <CarFront className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  },
  {
    title: "eSIM",
    via: "Stay connected abroad · Airalo via Travelpayouts",
    href: "https://airalo.tpo.lu/5dcQRiO5",
    icon: (
      <span className="relative inline-flex h-7 w-7" aria-hidden="true"><Smartphone className="h-7 w-7" strokeWidth={1.8} /><Wifi size={12} strokeWidth={2} className="absolute bottom-0 right-0" /></span>
    )
  },
  {
    title: "Travel gear",
    via: "Shop travel essentials · Amazon Associates",
    href: "https://www.amazon.com/s?k=travel+gear+essentials&tag=roamly02e-20",
    icon: (
      <ShoppingBag className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
    )
  }
];

export function FindsTravelDeals() {
  return (
    <section aria-label="Travel deals" className="mx-auto w-full max-w-xl px-2 py-10 sm:py-14">
      <h2 className="text-center text-3xl font-extrabold tracking-tight text-chead sm:text-4xl">
        Travel deals
      </h2>
      <p className="mx-auto mt-3 max-w-md text-center text-[0.95rem] leading-6 text-cgray">
        <span className="font-extrabold text-chead">Roamly&apos;s</span> hand-picked partners for
        hotels, flights, tours, transfers, rental cars, eSIM &amp; travel gear.
      </p>

      <div aria-hidden="true" className="my-6 border-t-2 border-dashed border-chair" />

      <div className="grid gap-4">
        {DEALS.map((deal) => (
          <a
            key={deal.title}
            href={deal.href}
            target="_blank"
            rel="sponsored nofollow noopener"
            className="bui-press bui-tap group flex items-center gap-4 rounded-bui-card border border-chair bg-white p-4 shadow-bui-card bui-lift sm:p-5"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-csoft text-cblue">
              {deal.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-extrabold tracking-tight text-chead">
                {deal.title}
              </span>
              <span className="mt-0.5 block truncate text-sm text-cgray">{deal.via}</span>
            </span>
            <ArrowUpRight
              aria-hidden="true"
              size={20}
              strokeWidth={2.5}
              className="shrink-0 text-cgray2 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-md text-center text-xs leading-5 text-cgray">
        These are affiliate links: if you book or buy through them, Roamly may earn a commission at
        no extra cost to you. It keeps the travel content free.
      </p>
    </section>
  );
}
