"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { bookingFindCard, flightFindCard, klookFindCard, klookTransportFindCard, type FindsCard } from "@/lib/roamly/findsMarketCore";

export type { FindsCard } from "@/lib/roamly/findsMarketCore";

type FindsCategory = "hotel" | "flight" | "activity" | "product" | "transport";

type FindsTab = { id: string; label: string; categories: readonly FindsCategory[] };

const tabs: readonly FindsTab[] = [
  { id: "all", label: "All finds", categories: [] },
  { id: "stays", label: "Hotels", categories: ["hotel"] },
  { id: "flights", label: "Flights", categories: ["flight"] },
  { id: "activities", label: "Klook & experiences", categories: ["activity"] },
  { id: "amazon", label: "Amazon finds", categories: ["product"] },
  { id: "more", label: "Getting around", categories: ["transport"] }
] as const;

export function FindsTabs({ cards, destination, origin, startDate, endDate, disclosures, emptyMessage }: { cards: FindsCard[]; destination: string; origin: string; startDate: string; endDate: string; disclosures: string[]; emptyMessage: string }) {
  const [active, setActive] = useState<string>("all");
  const [marketCards, setMarketCards] = useState(cards);
  const [searchingHotels, setSearchingHotels] = useState(false);
  const [searchingCategory, setSearchingCategory] = useState<string | null>(null);
  const [hotelSearchMessage, setHotelSearchMessage] = useState("Add your destination and dates to see live hotel offers with property photos.");
  const [partnerSearchMessage, setPartnerSearchMessage] = useState<Record<string, string>>({});
  const tab = tabs.find((item) => item.id === active) || tabs[0];
  const visible = tab.categories.length ? marketCards.filter((card) => tab.categories.includes(card.category)) : marketCards;

  useEffect(() => {
    function syncTabFromHash() {
      const requestedTab = window.location.hash.match(/^#finds-tab-(.+)$/)?.[1];
      if (requestedTab && tabs.some((item) => item.id === requestedTab)) setActive(requestedTab);
    }
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, []);

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    setActive(next.id);
    document.getElementById(`finds-tab-${next.id}`)?.focus();
  }

  async function searchHotels(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const destinationValue = String(values.get("stayDestination") || "").trim();
    const countryValue = String(values.get("stayCountry") || "").trim();
    const checkIn = String(values.get("stayCheckIn") || "");
    const checkOut = String(values.get("stayCheckOut") || "");
    const travelers = Number(values.get("stayTravelers") || 1);
    const rooms = Number(values.get("stayRooms") || 1);
    const maximumNightlyPrice = Number(values.get("stayMaxNightlyPrice") || 0);
    const hotelPreferences = String(values.get("stayPreferences") || "").trim();
    if (!destinationValue || !countryValue || !checkIn || !checkOut || checkOut <= checkIn) {
      setHotelSearchMessage("Add a destination, country, check-in date, and later check-out date to check real availability.");
      return;
    }
    setSearchingHotels(true);
    setHotelSearchMessage("Checking live stays and property photos with Booking.com…");
    try {
      const response = await fetch("/api/roamly/market-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          category: "hotel",
          destination: destinationValue,
          country: countryValue,
          start_date: checkIn,
          end_date: checkOut,
          travelers,
          rooms,
          ...(maximumNightlyPrice > 0 ? { maximum_nightly_price: maximumNightlyPrice } : {}),
          ...(hotelPreferences ? { hotel_preferences: hotelPreferences } : {}),
          currency: "CAD",
          force_refresh: true,
          store: false
        })
      });
      if (response.status === 401 || response.status === 403) {
        setHotelSearchMessage("Sign in to check live hotel rates. We’ll only show real stays with provider photos and a direct booking link.");
        return;
      }
      const body = await response.json().catch(() => ({})) as { results?: unknown; warning?: string };
      const results = Array.isArray(body.results) ? body.results : [];
      const stays = results.map(bookingFindCard).filter((card): card is FindsCard => Boolean(card));
      setMarketCards((current) => [...current.filter((card) => card.category !== "hotel"), ...stays]);
      setHotelSearchMessage(stays.length
        ? `${stays.length} live stays matched these dates and are ranked by your stated preferences, then nightly price. ${maximumNightlyPrice > 0 ? `All shown are within your CAD ${maximumNightlyPrice}/night limit. ` : ""}Stay22 will take you to Booking.com; confirm the final offer there.`
        : body.warning || (maximumNightlyPrice > 0
          ? `No verified live stays fit your CAD ${maximumNightlyPrice}/night limit for these dates. Try raising the limit or changing your dates.`
          : "No live hotel offers with a verified property photo and booking link came back for these dates. Nothing has been substituted or guessed."));
    } catch {
      setHotelSearchMessage("The live stay search is temporarily unavailable. No stale prices or sample hotels are being shown.");
    } finally {
      setSearchingHotels(false);
    }
  }

  async function searchPartner(event: React.FormEvent<HTMLFormElement>, category: "flight" | "attraction" | "transport", cardCategory: "flight" | "activity" | "transport") {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const destinationValue = String(values.get("partnerDestination") || "").trim();
    const originValue = String(values.get("flightOrigin") || "").trim();
    const titleValue = String(values.get("activityQuery") || "").trim();
    const departure = String(values.get("flightDeparture") || values.get("activityDate") || values.get("transportDate") || startDate || "");
    const returnDate = String(values.get("flightReturn") || "");
    if (!destinationValue || (category === "flight" && (!originValue || !departure)) || ((category === "attraction" || category === "transport") && !titleValue)) {
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Add the required trip details to search current partner offers." }));
      return;
    }
    if (category === "flight" && returnDate && returnDate < departure) {
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Return date must be the same as or later than departure." }));
      return;
    }
    setSearchingCategory(category);
    setPartnerSearchMessage((current) => ({ ...current, [category]: category === "flight" ? "Checking current flight fares…" : category === "transport" ? "Looking for real Klook transport options…" : "Looking for real Klook activities…" }));
    try {
      const response = await fetch("/api/roamly/market-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          category,
          origin: originValue,
          destination: destinationValue,
          city: destinationValue,
          title: titleValue,
          start_date: departure,
          end_date: returnDate,
          currency: "CAD",
          force_refresh: true,
          store: false
        })
      });
      if (response.status === 401 || response.status === 403) {
        setPartnerSearchMessage((current) => ({ ...current, [category]: "Sign in to search current partner fares and activities. Only verified provider results are shown." }));
        return;
      }
      const body = await response.json().catch(() => ({})) as { results?: unknown; warning?: string };
      const results = Array.isArray(body.results) ? body.results : [];
      const cardsForShelf = results.map((item) => category === "flight" ? flightFindCard(item) : category === "transport" ? klookTransportFindCard(item) : klookFindCard(item)).filter((card): card is FindsCard => Boolean(card));
      setMarketCards((current) => [...current.filter((card) => card.category !== cardCategory), ...cardsForShelf]);
      setPartnerSearchMessage((current) => ({
        ...current,
        [category]: cardsForShelf.length
          ? `${cardsForShelf.length} real partner ${cardCategory === "flight" ? "fare" : cardCategory === "transport" ? "transport option" : "activity"}${cardsForShelf.length === 1 ? "" : "s"} found. Confirm the final price and availability with the provider.`
          : body.warning || `No live ${cardCategory === "flight" ? "fare" : cardCategory === "transport" ? "transport option" : "Klook activity"} with a verified partner link${cardCategory !== "flight" ? " and provider photo" : ""} came back. No sample offers are shown.`
      }));
    } catch {
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Partner search is temporarily unavailable. No stale offers are being shown." }));
    } finally {
      setSearchingCategory(null);
    }
  }

  return (
    <section className="mt-10" aria-label="Travel finds">
      <div className="flex flex-col gap-3 border-b border-[#e2e9e2] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#16877f]">Shop the trip</p><h2 className="mt-1 text-2xl font-black tracking-tight">A good trip starts with a good find.</h2><p className="mt-1 text-sm text-[#698078]">Browse real offers for {destination} and beyond.</p></div>
        <p className="text-xs font-semibold text-[#698078]">Offers and availability are confirmed by each provider.</p>
      </div>
      {active === "stays" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={searchHotels} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">Destination<input name="stayDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Country<input name="stayCountry" placeholder="Portugal" required maxLength={60} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Check in<input name="stayCheckIn" type="date" defaultValue={startDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Check out<input name="stayCheckOut" type="date" defaultValue={endDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <div className="flex items-end"><button disabled={searchingHotels} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#16877f]/20" type="submit">{searchingHotels ? "Checking stays…" : "Find live stays"}</button></div>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-2"><label className="flex-1 text-xs font-bold text-[#547067]">Travelers<input name="stayTravelers" type="number" min="1" max="20" defaultValue="2" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label><label className="flex-1 text-xs font-bold text-[#547067]">Rooms<input name="stayRooms" type="number" min="1" max="10" defaultValue="1" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label></div>
          <label className="text-xs font-bold text-[#547067]">Max per night (CAD)<input name="stayMaxNightlyPrice" type="number" min="1" max="100000" step="1" placeholder="No limit" className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067] sm:col-span-2 lg:col-span-3">What matters most?<input name="stayPreferences" maxLength={180} placeholder="Quiet, walkable, boutique, pool…" className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /><span className="mt-1 block font-medium text-[#84928c]">We prioritize terms present in the listing; confirm details with Booking.com.</span></label>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{hotelSearchMessage}</p>
      </div> : null}
      {active === "flights" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "flight", "flight")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-[#547067]">From<input name="flightOrigin" defaultValue={origin} placeholder="Halifax" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">To<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Depart<input name="flightDeparture" type="date" defaultValue={startDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Return (optional)<input name="flightReturn" type="date" defaultValue={endDate} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <div className="flex items-end"><button disabled={searchingCategory === "flight"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60" type="submit">{searchingCategory === "flight" ? "Checking fares…" : "Find flight fares"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.flight || "Live fare results require an origin, destination, and travel date. The ticket is purchased with the airline or seller."}</p>
      </div> : null}
      {active === "more" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "transport", "transport")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-[#547067]">Destination<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">What do you need?<input name="activityQuery" placeholder="Airport transfer, shuttle, city transport pass…" required maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Travel date (optional)<input name="transportDate" type="date" defaultValue={startDate} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <div className="flex items-end sm:col-span-2 lg:col-span-4"><button disabled={searchingCategory === "transport"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60 sm:w-auto" type="submit">{searchingCategory === "transport" ? "Looking…" : "Find transport options"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.transport || "Search Klook for real transfers and travel passes. Confirm route, date, and availability with the provider."}</p>
      </div> : null}
      {active === "activities" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "attraction", "activity")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-[#547067]">Destination<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">What sounds fun?<input name="activityQuery" placeholder="Food tour, aquarium, day trip…" required maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#16877f] focus:ring-4 focus:ring-[#16877f]/10" /></label>
          <div className="flex items-end"><button disabled={searchingCategory === "attraction"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60" type="submit">{searchingCategory === "attraction" ? "Looking…" : "Find real activities"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.attraction || "Real Klook partner listings only. Starting prices and date-specific availability must be confirmed with Klook."}</p>
      </div> : null}
      <div role="tablist" aria-label="Find categories" className="mt-4 flex gap-2 overflow-x-auto pb-3">
        {tabs.map((item, index) => <button key={item.id} id={`finds-tab-${item.id}`} type="button" role="tab" tabIndex={active === item.id ? 0 : -1} aria-selected={active === item.id} aria-controls="finds-panel" onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => { setActive(item.id); if (window.location.hash !== `#finds-tab-${item.id}`) window.history.replaceState(null, "", `#finds-tab-${item.id}`); }} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#16877f]/20 ${active === item.id ? "bg-[#203c43] text-white shadow-sm" : "border border-[#e0e8e1] bg-white text-[#547067] hover:border-[#b7d9c8] hover:bg-[#f0f8f2]"}`}>{item.label}{item.id === "amazon" && cards.some((card) => card.category === "product") ? <span className="ml-2 rounded-full bg-[#dff2e8] px-2 py-0.5 text-[10px] text-[#28665d]">{cards.filter((card) => card.category === "product").length}</span> : null}</button>)}
      </div>
      {visible.length === 0 ? <div key={`empty-${active}`} id="finds-panel" role="tabpanel" aria-labelledby={`finds-tab-${active}`} className="rounded-[1.5rem] border border-[#e1e9e2] bg-white px-6 py-12 text-center shadow-[0_12px_35px_rgba(39,68,58,0.04)]"><span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eff7ef] text-2xl text-[#16877f]">✦</span><h3 className="mt-4 text-xl font-black tracking-tight text-[#203c43]">No verified listings in this shelf yet</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#657971]">{active === "amazon" ? emptyMessage : active === "all" ? "No verified travel finds are available yet. Choose a shelf and search for current stays, flights, experiences, or gear. Offers appear only when their details, photos, and provider links can be verified." : active === "stays" ? "Use the stay search above. Only real, priced stays with a verified property photo and a direct provider booking link appear here." : "We’ll only open this shelf when a partner can provide a real listing, its own photo, current details, and a direct place to book. No placeholders, scraped stock photos, or pretend offers."}</p></div> : <div key={`listings-${active}`} id="finds-panel" role="tabpanel" aria-labelledby={`finds-tab-${active}`} className="grid gap-5 pt-1 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((card) => <article key={card.id} className="group overflow-hidden rounded-[1.35rem] border border-[#e3e9e3] bg-white shadow-[0_5px_22px_rgba(39,68,58,0.045)] transition duration-300 hover:-translate-y-1 hover:border-[#bfd8ca] hover:shadow-[0_18px_42px_rgba(39,88,80,0.12)] motion-reduce:transform-none motion-reduce:transition-none">
          <div className={`relative h-64 overflow-hidden sm:h-72 ${card.category === "hotel" || card.category === "activity" ? "bg-[#e9f1eb]" : "bg-[#f8faf7] p-4"}`}>
            <Image src={card.image} alt={card.imageAlt} fill unoptimized sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw" className={`${card.category === "hotel" || card.category === "activity" ? "object-cover" : "object-contain p-7"} transition duration-500 group-hover:scale-[1.04] motion-reduce:transform-none`} />
            <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3"><span className="rounded-full border border-[#e6ece5] bg-white/95 px-3 py-1.5 text-[0.68rem] font-extrabold text-[#31594f] shadow-sm">{card.eyebrow}</span>{card.savingPercent ? <span className="rounded-full bg-[#b83f34] px-3 py-1.5 text-[0.68rem] font-extrabold text-white">Save {card.savingPercent}%</span> : null}</div>
            {card.price ? <span className="absolute bottom-4 left-4 rounded-xl border border-white/80 bg-white/95 px-3 py-2 text-sm font-black text-[#203c43] shadow-sm">{card.price}<span className="ml-1 text-[0.65rem] font-semibold text-[#718179]">{card.priceNote || "from partner"}</span></span> : null}
          </div>
          <div className="flex min-h-[216px] flex-col p-5">
            <h3 className="line-clamp-2 min-h-12 text-[15px] font-extrabold leading-6 text-[#203c43]">{card.title}</h3>
            {card.recommendationLabel ? <p className="mt-2 w-fit rounded-full bg-[#e8f6ed] px-3 py-1 text-[0.68rem] font-extrabold text-[#28665d]">✦ {card.recommendationLabel}</p> : null}
            {card.saving ? <p className="mt-1 text-sm font-bold text-[#b33c32]">{card.saving} off the listed price</p> : null}
            <p className="mt-2 text-xs leading-5 text-[#75857d]">{card.description}</p>
            {card.checkedAt ? <p className="mt-2 text-[0.68rem] font-medium text-[#83938c]">Price & stock checked {new Date(card.checkedAt).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p> : null}
            <div className="mt-auto flex items-center justify-between gap-3 pt-5"><span className="text-xs font-bold text-[#83938c]">{providerLabel(card.provider)}</span><a href={card.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#ffd814] px-5 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#16877f]/20">{card.action}<span aria-hidden="true" className="ml-2">↗</span></a></div>
          </div>
        </article>)}
      </div>}
      {marketCards.some((card) => card.affiliate) || disclosures.length > 0 ? <p className="mt-5 max-w-4xl text-xs leading-5 text-[#7b8d85]">{marketCards.some((card) => card.affiliate) ? "Roamly may earn a commission when you buy or book through some partner links. The price you pay is determined by the provider." : null}{disclosures.length > 0 ? ` ${disclosures.join(" ")}` : null}</p> : null}
    </section>
  );
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    stay22: "Stay22",
    travelpayouts: "Travelpayouts",
    klook: "Klook"
  };
  return labels[provider.toLowerCase()] || provider;
}
