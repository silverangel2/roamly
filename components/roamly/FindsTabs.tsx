"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { bookingFindCard, flightFindCard, klookFindCard, klookTransportFindCard, type FindsCard } from "@/lib/roamly/findsMarketCore";

export type { FindsCard } from "@/lib/roamly/findsMarketCore";

type FindsCategory = "hotel" | "flight" | "activity" | "product" | "transport";

type FindsTab = { id: string; label: string; categories: readonly FindsCategory[] };

const tabs: readonly FindsTab[] = [
  { id: "all", label: "For your trip", categories: [] },
  { id: "stays", label: "Stays", categories: ["hotel"] },
  { id: "flights", label: "Flights", categories: ["flight"] },
  { id: "activities", label: "Things to do", categories: ["activity"] },
  { id: "amazon", label: "Travel essentials", categories: ["product"] },
  { id: "more", label: "Getting around", categories: ["transport"] }
] as const;

const INITIAL_VISIBLE_CARDS = 6;

function dedupeCards(items: FindsCard[]) {
  const seen = new Set<string>();
  return items.filter((card) => {
    const key = `${card.provider.toLowerCase()}|${card.id || card.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateLabel(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function FindsTabs({ cards, destination, origin, startDate, endDate, disclosures, emptyMessage }: { cards: FindsCard[]; destination: string; origin: string; startDate: string; endDate: string; disclosures: string[]; emptyMessage: string }) {
  const [active, setActive] = useState<string>("all");
  const [marketCards, setMarketCards] = useState(() => dedupeCards(cards));
  const [visibleCardCount, setVisibleCardCount] = useState(INITIAL_VISIBLE_CARDS);
  const [searchingHotels, setSearchingHotels] = useState(false);
  const [searchingCategory, setSearchingCategory] = useState<string | null>(null);
  const [hotelSearchMessage, setHotelSearchMessage] = useState("Add your destination and dates to see live hotel offers with property photos.");
  const [partnerSearchMessage, setPartnerSearchMessage] = useState<Record<string, string>>({});
  const tab = tabs.find((item) => item.id === active) || tabs[0];
  const matchingCards = tab.categories.length ? marketCards.filter((card) => tab.categories.includes(card.category)) : marketCards;
  const visible = matchingCards.slice(0, visibleCardCount);

  useEffect(() => {
    setVisibleCardCount(INITIAL_VISIBLE_CARDS);
  }, [active]);

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
    setHotelSearchMessage("Checking current stays and property photos…");
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
        setHotelSearchMessage("Sign in to check current hotel rates. We’ll only show real stays with property photos and a direct booking link.");
        return;
      }
      const body = await response.json().catch(() => ({})) as { results?: unknown; warning?: string };
      const results = Array.isArray(body.results) ? body.results : [];
      const stays = results.map(bookingFindCard).filter((card): card is FindsCard => Boolean(card));
      setMarketCards((current) => dedupeCards([...current.filter((card) => card.category !== "hotel"), ...stays]));
      setHotelSearchMessage(stays.length
        ? `${stays.length} current stays matched these dates and are ranked by your stated preferences, then nightly price. ${maximumNightlyPrice > 0 ? `All shown are within your CAD ${maximumNightlyPrice}/night limit. ` : ""}Check the final offer before booking.`
        : body.warning || (maximumNightlyPrice > 0
          ? `No verified live stays fit your CAD ${maximumNightlyPrice}/night limit for these dates. Try raising the limit or changing your dates.`
          : "No live hotel offers with a verified property photo and booking link came back for these dates. Nothing has been substituted or guessed."));
    } catch {
      setHotelSearchMessage("The live stay search is temporarily unavailable. No stale prices or guessed stays are being shown.");
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
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Add the required trip details to search current offers." }));
      return;
    }
    if (category === "flight" && returnDate && returnDate < departure) {
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Return date must be the same as or later than departure." }));
      return;
    }
    setSearchingCategory(category);
    setPartnerSearchMessage((current) => ({ ...current, [category]: category === "flight" ? "Checking current flight fares…" : category === "transport" ? "Looking for current transport options…" : "Looking for current experiences…" }));
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
        setPartnerSearchMessage((current) => ({ ...current, [category]: "Sign in to search current fares and experiences. Only verified results are shown." }));
        return;
      }
      const body = await response.json().catch(() => ({})) as { results?: unknown; warning?: string };
      const results = Array.isArray(body.results) ? body.results : [];
      const cardsForShelf = results.map((item) => category === "flight" ? flightFindCard(item) : category === "transport" ? klookTransportFindCard(item) : klookFindCard(item)).filter((card): card is FindsCard => Boolean(card));
      setMarketCards((current) => dedupeCards([...current.filter((card) => card.category !== cardCategory), ...cardsForShelf]));
      setPartnerSearchMessage((current) => ({
        ...current,
        [category]: cardsForShelf.length
          ? `${cardsForShelf.length} current ${cardCategory === "flight" ? "flight option" : cardCategory === "transport" ? "transport option" : "experience"}${cardsForShelf.length === 1 ? "" : "s"} found. Confirm the final price and availability before booking.`
          : body.warning || `No current ${cardCategory === "flight" ? "fare" : cardCategory === "transport" ? "transport option" : "experience"} with a verified link${cardCategory !== "flight" ? " and image" : ""} came back. No unverified offers are shown.`
      }));
    } catch {
      setPartnerSearchMessage((current) => ({ ...current, [category]: "Search is temporarily unavailable. No stale offers are being shown." }));
    } finally {
      setSearchingCategory(null);
    }
  }

  return (
    <section className="mt-10" aria-label="Travel finds">
      <div className="flex flex-col gap-4 border-b border-[#e2e9e2] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#0f6e66]">A closer look</p><h2 className="mt-1 text-2xl font-black tracking-tight">Travel finds worth saving.</h2><p className="mt-1 text-sm text-[#526b62]">{destination === "your next somewhere" ? "Browse a few ideas for your next trip." : `Ideas for ${destination}.`}</p></div>
        <div className="max-w-sm text-xs leading-5 text-[#526b62] sm:text-right"><p className="font-semibold">Details and final availability are confirmed before you book.</p>{destination !== "your next somewhere" || origin || startDate || endDate ? <p className="mt-1 text-[#7a8c84]">{[origin ? `From ${origin}` : "", startDate ? `${dateLabel(startDate)}${endDate ? `–${dateLabel(endDate)}` : ""}` : ""].filter(Boolean).join(" · ") || "Trip context saved"}</p> : <p className="mt-1 text-[#7a8c84]">Add trip details to make these ideas more relevant.</p>}</div>
      </div>
      {active === "stays" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={searchHotels} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">Destination<input name="stayDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Country<input name="stayCountry" placeholder="Portugal" required maxLength={60} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Check in<input name="stayCheckIn" type="date" defaultValue={startDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Check out<input name="stayCheckOut" type="date" defaultValue={endDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <div className="flex items-end"><button disabled={searchingHotels} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20" type="submit">{searchingHotels ? "Checking stays…" : "Find live stays"}</button></div>
          <div className="flex gap-3 sm:col-span-2 lg:col-span-2"><label className="flex-1 text-xs font-bold text-[#547067]">Travelers<input name="stayTravelers" type="number" min="1" max="20" defaultValue="2" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label><label className="flex-1 text-xs font-bold text-[#547067]">Rooms<input name="stayRooms" type="number" min="1" max="10" defaultValue="1" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label></div>
          <label className="text-xs font-bold text-[#547067]">Max per night (CAD)<input name="stayMaxNightlyPrice" type="number" min="1" max="100000" step="1" placeholder="No limit" className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067] sm:col-span-2 lg:col-span-3">What matters most?<input name="stayPreferences" maxLength={180} placeholder="Quiet, walkable, boutique, pool…" className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /><span className="mt-1 block font-medium text-[#84928c]">We prioritize terms present in the listing; confirm the final offer before booking.</span></label>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{hotelSearchMessage}</p>
      </div> : null}
      {active === "flights" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "flight", "flight")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-[#547067]">From<input name="flightOrigin" defaultValue={origin} placeholder="Halifax" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">To<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Depart<input name="flightDeparture" type="date" defaultValue={startDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Return (optional)<input name="flightReturn" type="date" defaultValue={endDate} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <div className="flex items-end"><button disabled={searchingCategory === "flight"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60" type="submit">{searchingCategory === "flight" ? "Checking fares…" : "Find flight fares"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.flight || "Live fare results require an origin, destination, and travel date. The ticket is purchased with the airline or seller."}</p>
      </div> : null}
      {active === "more" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "transport", "transport")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-[#547067]">Destination<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">What do you need?<input name="activityQuery" placeholder="Airport transfer, shuttle, city transport pass…" required maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067]">Travel date (optional)<input name="transportDate" type="date" defaultValue={startDate} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <div className="flex items-end sm:col-span-2 lg:col-span-4"><button disabled={searchingCategory === "transport"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60 sm:w-auto" type="submit">{searchingCategory === "transport" ? "Looking…" : "Find transport options"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.transport || "Explore real transfers and travel passes. Confirm route, date, and availability with the seller."}</p>
      </div> : null}
      {active === "activities" ? <div className="mt-5 rounded-2xl border border-[#e1e9e2] bg-white p-4 shadow-[0_8px_26px_rgba(39,68,58,0.04)] sm:p-5">
        <form onSubmit={(event) => searchPartner(event, "attraction", "activity")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-[#547067]">Destination<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <label className="text-xs font-bold text-[#547067] lg:col-span-2">What sounds fun?<input name="activityQuery" placeholder="Food tour, aquarium, day trip…" required maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm text-[#203c43] outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
          <div className="flex items-end"><button disabled={searchingCategory === "attraction"} className="min-h-11 w-full rounded-xl bg-[#ffd814] px-4 text-xs font-black text-[#263238] transition hover:bg-[#f7ca00] disabled:cursor-wait disabled:opacity-60" type="submit">{searchingCategory === "attraction" ? "Looking…" : "Find real activities"}</button></div>
        </form>
        <p aria-live="polite" className="mt-3 text-xs leading-5 text-[#718179]">{partnerSearchMessage.attraction || "Real experience listings only. Starting prices and date-specific availability must be confirmed with the seller."}</p>
      </div> : null}
      <div role="tablist" aria-label="Find categories" className="mt-4 flex gap-2 overflow-x-auto pb-3">
        {tabs.map((item, index) => <button key={item.id} id={`finds-tab-${item.id}`} type="button" role="tab" tabIndex={active === item.id ? 0 : -1} aria-selected={active === item.id} aria-controls="finds-panel" onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => { setActive(item.id); if (window.location.hash !== `#finds-tab-${item.id}`) window.history.replaceState(null, "", `#finds-tab-${item.id}`); }} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20 ${active === item.id ? "bg-[#203c43] text-white shadow-sm" : "border border-[#e0e8e1] bg-white text-[#547067] hover:border-[#b7d9c8] hover:bg-[#f0f8f2]"}`}>{item.label}{item.id === "amazon" && cards.some((card) => card.category === "product") ? <span className="ml-2 rounded-full bg-[#dff2e8] px-2 py-0.5 text-[10px] text-[#28665d]">{cards.filter((card) => card.category === "product").length}</span> : null}</button>)}
      </div>
      {visible.length === 0 ? <div key={`empty-${active}`} id="finds-panel" role="tabpanel" aria-labelledby={`finds-tab-${active}`} className="rounded-[1.5rem] border border-[#e1e9e2] bg-white px-6 py-12 text-center shadow-[0_12px_35px_rgba(39,68,58,0.04)]"><span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#eff7ef] text-2xl text-[#0f6e66]">✦</span><h3 className="mt-4 text-xl font-black tracking-tight text-[#203c43]">Nothing to show here yet</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#657971]">{active === "amazon" ? emptyMessage : active === "all" ? "There are no verified travel finds here yet. Choose a shelf and search for current stays, flights, experiences, or essentials." : active === "stays" ? "Use the stay search above. Only real, priced stays with a verified property image and direct booking link appear here." : "We’ll only show a real listing with its own image, current details, and a safe place to explore it."}</p></div> : <div key={`listings-${active}`} id="finds-panel" role="tabpanel" aria-labelledby={`finds-tab-${active}`} className="space-y-9 pt-1">
        <div className={`grid gap-5 ${visible.length > 1 ? "lg:grid-cols-[1.35fr_0.65fr]" : ""}`}>
          <EditorialCard card={visible[0]} variant="feature" />
          {visible.length > 1 ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">{visible.slice(1, 3).map((card) => <EditorialCard key={card.id} card={card} variant="compact" />)}</div> : null}
        </div>
        {visible.slice(3).some((card) => card.category === "product") ? <section aria-labelledby="worth-packing-title" className="border-y border-[#e2e9e2] py-7"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-[#0f6e66]">Useful on the way</p><h3 id="worth-packing-title" className="mt-1 text-2xl font-black tracking-tight">Worth packing</h3></div><span className="hidden text-xs font-semibold text-[#7b8d85] sm:block">Real products, checked when shown</span></div><div className="mt-5 flex snap-x gap-4 overflow-x-auto pb-2">{visible.slice(3).filter((card) => card.category === "product").map((card) => <div key={card.id} className="min-w-[17rem] snap-start sm:min-w-[20rem]"><EditorialCard card={card} variant="product" /></div>)}</div></section> : null}
        {visible.slice(3).some((card) => card.category !== "product") ? <section aria-labelledby="more-finds-title"><p className="text-xs font-black uppercase tracking-[0.16em] text-[#0f6e66]">Keep exploring</p><h3 id="more-finds-title" className="mt-1 text-2xl font-black tracking-tight">{editorialSectionTitle(visible.slice(3).find((card) => card.category !== "product")?.category)}</h3><div className="mt-5 grid gap-5 sm:grid-cols-2">{visible.slice(3).filter((card) => card.category !== "product").map((card) => <EditorialCard key={card.id} card={card} variant="standard" />)}</div></section> : null}
      </div>}
      {matchingCards.length > visible.length ? <div className="mt-6 flex justify-center"><button type="button" onClick={() => setVisibleCardCount((count) => Math.min(count + INITIAL_VISIBLE_CARDS, matchingCards.length))} className="min-h-11 rounded-full border border-[#b8d6ca] bg-white px-6 text-sm font-extrabold text-[#28665d] transition hover:border-[#78bba8] hover:bg-[#f7fcf8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">Show more {tab.label.toLowerCase()} <span aria-hidden="true" className="ml-1">↓</span></button></div> : null}
      {marketCards.some((card) => card.affiliate) || disclosures.length > 0 ? <p className="mt-5 max-w-4xl text-xs leading-5 text-[#7b8d85]">{marketCards.some((card) => card.affiliate) ? "Roamly may earn a commission when you buy or book through some links. The price you pay is determined by the seller." : null}{disclosures.length > 0 ? ` ${disclosures.join(" ")}` : null}</p> : null}
    </section>
  );
}

type EditorialCardVariant = "feature" | "compact" | "product" | "standard";

function editorialSectionTitle(category: FindsCategory | undefined) {
  if (category === "hotel") return "Where we’d stay";
  if (category === "flight") return "Flights worth checking";
  if (category === "activity") return "Things worth doing";
  if (category === "transport") return "Getting around";
  return "Travel finds";
}

function EditorialCard({ card, variant }: { card: FindsCard; variant: EditorialCardVariant }) {
  const feature = variant === "feature";
  const product = card.category === "product";
  const imageClass = product ? "object-contain p-8" : "object-cover";
  const frameClass = feature ? "aspect-[4/3] sm:aspect-[1.45/1]" : variant === "product" ? "aspect-[4/3]" : "aspect-[1.25/1]";
  const titleClass = feature ? "text-2xl sm:text-3xl" : "text-lg";
  return <article className={`group overflow-hidden rounded-[1.5rem] border border-[#e3e9e3] bg-white shadow-[0_8px_28px_rgba(39,68,58,0.05)] transition duration-300 hover:-translate-y-1 hover:border-[#bfd8ca] hover:shadow-[0_18px_42px_rgba(39,88,80,0.12)] motion-reduce:transform-none motion-reduce:transition-none ${feature ? "lg:min-h-full" : ""}`}>
    <div className={`relative overflow-hidden ${frameClass} ${product ? "bg-[#f8faf7]" : "bg-[#e9f1eb]"}`}>
      <Image src={card.image} alt={card.imageAlt} fill unoptimized loading={feature ? "eager" : "lazy"} sizes={feature ? "(min-width: 1024px) 58vw, 100vw" : "(min-width: 640px) 42vw, 90vw"} className={`${imageClass} transition duration-700 group-hover:scale-[1.03] motion-reduce:transform-none`} />
      <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3"><span className="rounded-full border border-[#e6ece5] bg-white/95 px-3 py-1.5 text-[0.68rem] font-extrabold text-[#31594f] shadow-sm">{card.eyebrow}</span>{card.savingPercent ? <span className="rounded-full bg-[#b83f34] px-3 py-1.5 text-[0.68rem] font-extrabold text-white">Verified saving {card.savingPercent}%</span> : null}</div>
      {card.price ? <span className="absolute bottom-4 left-4 rounded-xl border border-white/80 bg-white/95 px-3 py-2 text-sm font-black text-[#203c43] shadow-sm">{card.price}<span className="ml-1 text-[0.65rem] font-semibold text-[#718179]">{card.priceNote || "current when checked"}</span></span> : null}
    </div>
    <div className={`flex flex-col ${feature ? "p-6 sm:p-7" : "p-4 sm:p-5"}`}>
      <h3 className={`${titleClass} line-clamp-2 font-black leading-tight tracking-tight text-[#203c43]`}>{card.title}</h3>
      {card.recommendationLabel ? <p className="mt-2 w-fit rounded-full bg-[#e8f6ed] px-3 py-1 text-[0.68rem] font-extrabold text-[#28665d]">✦ {card.recommendationLabel}</p> : null}
      {card.saving ? <p className="mt-2 text-sm font-bold text-[#b33c32]">{card.saving} off the listed price</p> : null}
      <p className={`${feature ? "line-clamp-4" : "line-clamp-3"} mt-3 text-sm leading-6 text-[#687c74]`}>{card.description}</p>
      {card.checkedAt ? <p className="mt-3 text-[0.68rem] font-medium text-[#83938c]">Checked {new Date(card.checkedAt).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</p> : null}
      <div className="mt-5 flex items-center justify-between gap-3"><span className="text-xs font-bold text-[#83938c]">{card.checkedAt ? "Details checked" : "Explore the details"}</span><a href={card.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full bg-[#0f6e66] px-5 text-xs font-black text-white transition hover:bg-[#0e605a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">{card.action}<span aria-hidden="true" className="ml-2">↗</span></a></div>
    </div>
  </article>;
}
