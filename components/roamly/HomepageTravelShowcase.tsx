import Image from "next/image";

const photoTiles = [
  {
    name: "Barcelona",
    country: "Spain",
    caption: "Evening tapas route",
    image: "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=900&q=85"
  },
  {
    name: "Tokyo",
    country: "Japan",
    caption: "Food and neon streets",
    image: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=700&q=85"
  },
  {
    name: "Bali",
    country: "Indonesia",
    caption: "Slow beach days",
    image: "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=700&q=85"
  }
];

const routeStops = [
  { city: "Montreal", detail: "Arrive and settle in" },
  { city: "Paris", detail: "Museums, cafes, Seine walk" },
  { city: "Rome", detail: "Piazzas, ruins, relaxed dinner" }
];

export function HomepageTravelShowcase() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white bg-white/72 p-4 shadow-[0_28px_90px_rgba(16,32,51,0.14)] backdrop-blur-xl sm:p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_8%,rgba(84,214,198,0.26),transparent_30%),radial-gradient(circle_at_88%_22%,rgba(255,184,77,0.24),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.84),rgba(255,255,255,0.56))]" />
      <div className="relative grid gap-4">
        <div className="grid grid-cols-[1.18fr_0.82fr] gap-3">
          <article className="group relative min-h-[20rem] overflow-hidden rounded-[1.55rem] bg-cloud shadow-soft">
            <Image
              src={photoTiles[0].image}
              alt={`${photoTiles[0].name}, ${photoTiles[0].country}`}
              fill
              priority
              sizes="(min-width: 1024px) 32vw, 60vw"
              className="object-cover transition duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,51,0.04)_26%,rgba(16,32,51,0.72)_100%)]" />
            <div className="absolute bottom-4 left-4 right-4 text-white">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/82">{photoTiles[0].country}</p>
              <h2 className="mt-1 text-3xl font-black tracking-tight">{photoTiles[0].name}</h2>
              <p className="mt-1 text-sm font-bold text-white/88">{photoTiles[0].caption}</p>
            </div>
          </article>

          <div className="grid gap-3">
            {photoTiles.slice(1).map((tile) => (
              <article key={tile.name} className="group relative min-h-[9.5rem] overflow-hidden rounded-[1.25rem] bg-cloud shadow-soft">
                <Image
                  src={tile.image}
                  alt={`${tile.name}, ${tile.country}`}
                  fill
                  sizes="(min-width: 1024px) 18vw, 38vw"
                  className="object-cover transition duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,51,0.02)_18%,rgba(16,32,51,0.66)_100%)]" />
                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <p className="text-[0.65rem] font-black uppercase tracking-[0.14em] text-white/78">{tile.country}</p>
                  <h3 className="text-lg font-black">{tile.name}</h3>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white bg-white/92 p-4 text-ink shadow-soft backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Route preview</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Montreal to Rome</h2>
            </div>
            <span className="rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-2 text-xs font-black text-white shadow-lg shadow-cyan-500/20">Multi-city</span>
          </div>
          <div className="mt-4 grid gap-3">
            {routeStops.map((stop, index) => (
              <div key={stop.city} className="grid grid-cols-[1.25rem_1fr] gap-3">
                <div className="relative flex justify-center">
                  <span className="mt-1 h-4 w-4 rounded-full border-2 border-white bg-lagoon shadow-[0_0_0_4px_rgba(84,214,198,0.22)]" />
                  {index < routeStops.length - 1 ? <span className="absolute top-5 h-9 w-px bg-ocean/28" /> : null}
                </div>
                <div>
                  <p className="text-sm font-black text-ink">{stop.city}</p>
                  <p className="text-xs font-bold text-slate-500">{stop.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[1.35rem] border border-white bg-[linear-gradient(135deg,#f2fffb,#ffffff)] p-4 text-ink shadow-soft backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Budget check preview</p>
            <p className="mt-2 text-xl font-black">Looks realistic</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-600">
              Flights, stays, food, activities, transport, and buffer are reviewed before the itinerary is generated.
            </p>
          </div>
          <div className="rounded-[1.35rem] border border-white bg-[linear-gradient(135deg,#fff8ed,#ffffff)] p-4 text-ink shadow-soft backdrop-blur">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Live Companion preview</p>
            <p className="mt-2 text-xl font-black">Tomorrow: train transfer</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-600">
              Reminders, bookings, and next steps stay close when the trip begins.
            </p>
          </div>
        </div>

        <div className="rounded-[1.35rem] border border-white bg-white/88 p-4 text-ink shadow-soft backdrop-blur">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-coral">Booking-aware planning</p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Uploaded flight, stay, rail, and activity confirmations become context for the route.
          </p>
        </div>
      </div>
    </section>
  );
}
