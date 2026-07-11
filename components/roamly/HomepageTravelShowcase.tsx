import Image from "next/image";

const destinationTiles = [
  {
    name: "Paris",
    image: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=900&q=85"
  },
  {
    name: "Rome",
    image: "https://images.unsplash.com/photo-1529260830199-42c24126f198?auto=format&fit=crop&w=900&q=85"
  },
  {
    name: "Toronto",
    image: "https://images.unsplash.com/photo-1517935706615-2717063c2225?auto=format&fit=crop&w=900&q=85"
  }
];

const routeStops = ["Saint John", "Toronto", "Paris", "Rome"];

export function HomepageTravelShowcase() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/18 bg-white/[0.08] p-4 shadow-[0_28px_90px_rgba(2,6,23,0.32)] backdrop-blur-xl sm:p-5">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(84,214,198,0.16),transparent_36%),linear-gradient(315deg,rgba(129,140,248,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04))]" />
      <div className="relative grid gap-4">
        <div className="grid grid-cols-3 gap-3">
          {destinationTiles.map((tile, index) => (
            <article
              key={tile.name}
              className={`group relative h-32 overflow-hidden rounded-[1.35rem] border border-white/20 bg-white/10 shadow-soft sm:h-40 ${
                index === 1 ? "translate-y-5" : ""
              }`}
            >
              <Image
                src={tile.image}
                alt={`${tile.name} destination preview`}
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 14vw, 33vw"
                className="object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/15 to-transparent" />
              <p className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-black text-ink backdrop-blur">
                {tile.name}
              </p>
            </article>
          ))}
        </div>

        <div className="rounded-[1.5rem] border border-white/20 bg-white/[0.88] p-4 text-ink shadow-soft backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Route intelligence</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Saint John to Rome</h2>
            </div>
            <span className="rounded-full bg-ink px-3 py-2 text-xs font-black text-white">Multi-city</span>
          </div>
          <div className="mt-4 grid gap-3">
            {routeStops.map((stop, index) => (
              <div key={stop} className="grid grid-cols-[1.25rem_1fr] gap-3">
                <div className="relative flex justify-center">
                  <span className="mt-1 h-4 w-4 rounded-full border-2 border-white bg-lagoon shadow-[0_0_0_4px_rgba(84,214,198,0.22)]" />
                  {index < routeStops.length - 1 ? <span className="absolute top-5 h-8 w-px bg-ocean/28" /> : null}
                </div>
                <p className="text-sm font-black text-slate-700">{stop}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.35rem] border border-white/20 bg-ink/86 p-4 text-white shadow-soft backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-lagoon">Budget check</p>
            <p className="mt-2 text-xl font-black">Looks realistic</p>
            <p className="mt-2 text-xs font-bold leading-5 text-white/70">
              Flights, hotels, food, activities, transport, and buffer are reviewed before the itinerary is locked.
            </p>
          </div>
          <div className="rounded-[1.35rem] border border-white/20 bg-white/[0.88] p-4 text-ink shadow-soft backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-sun">Live Companion</p>
            <p className="mt-2 text-xl font-black">Tomorrow: train transfer</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-600">
              Roamly keeps reminders, bookings, and next steps close when the trip starts.
            </p>
          </div>
        </div>

        <div className="rounded-[1.35rem] border border-white/20 bg-white/[0.14] p-4 text-white backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/56">Booking awareness</p>
          <p className="mt-2 text-sm font-bold leading-6 text-white/82">
            Uploaded flight, stay, rail, and activity confirmations become planning context for the route.
          </p>
        </div>
      </div>
    </section>
  );
}
