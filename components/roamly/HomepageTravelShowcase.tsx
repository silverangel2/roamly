import Image from "next/image";

const photos = [
  ["Barcelona", "Spain", "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=900&q=85"],
  ["Tokyo", "Japan", "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=900&q=85"],
  ["Bali", "Indonesia", "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=85"]
];

export function HomepageTravelShowcase() {
  return (
    <section aria-label="A glimpse of a Roamly trip plan" className="relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-[#fffdf8]/80 p-3 shadow-[0_24px_70px_rgba(16,32,51,0.12)] backdrop-blur-xl sm:p-4">
      <div className="relative grid gap-3">
        <div className="group relative min-h-[21rem] overflow-hidden rounded-[1.4rem] bg-[#dcebe8] sm:min-h-[27rem]">
          <Image src={photos[0][2]} alt={`${photos[0][0]}, ${photos[0][1]}`} fill priority sizes="(min-width: 1024px) 55vw, 100vw" className="object-cover transition duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,51,0.04)_20%,rgba(16,32,51,0.78)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">A plan that leaves space</p><h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{photos[0][0]}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-white/85">A city day with room to wander.</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[1.25rem] border border-[#e7dfd2] bg-[#fffdf8] p-4 text-ink"><p className="text-xs font-bold uppercase tracking-[0.12em] text-ocean">The day, at a glance</p><div className="mt-4 space-y-3">{["Morning · start gently", "Afternoon · one good plan", "Evening · choose your pace"].map((item) => <div key={item} className="flex items-center gap-3"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-lagoon ring-4 ring-lagoon/15" /><p className="text-sm font-semibold text-slate-700">{item}</p></div>)}</div></div>
          <div className="grid grid-cols-2 gap-3">{photos.slice(1).map((photo) => <div key={photo[0]} className="group relative min-h-40 overflow-hidden rounded-[1.25rem] bg-[#dcebe8]"><Image src={photo[2]} alt={`${photo[0]}, ${photo[1]}`} fill sizes="(min-width: 640px) 25vw, 45vw" className="object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(16,32,51,0.7))]" /><p className="absolute inset-x-3 bottom-3 text-lg font-bold text-white">{photo[0]}</p></div>)}</div>
        </div>
      </div>
    </section>
  );
}
