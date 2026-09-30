"use client";

import { useEffect, useState } from "react";
import { bookingFindCard, flightFindCard, flightFindHandoff, klookFindCard, klookTransportFindCard, publicEventFindCard, type FindsCard } from "@/lib/roamly/findsMarketCore";
import { FindsEditorialMagazine } from "@/components/roamly/FindsEditorialMagazine";
import type { FindsPromoConfig } from "@/lib/roamly/findsCommercialConfig";
import { normalizeCountryCode } from "@/lib/roamly/placeResolver";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
import { normalizePlaceText, recommendedPlaces, type NormalizedPlace } from "@/lib/roamly/places";
import { buildAviasalesDeepLink } from "@/lib/roamly/bookingLinks";
import { findsFlightHandoff } from "@/lib/roamly/findsCommercialConfig";

export type { FindsCard } from "@/lib/roamly/findsMarketCore";

type FindsCategory = "hotel" | "flight" | "activity" | "product" | "transport";

type FindsTab = { id: string; label: string; categories: readonly FindsCategory[] };

const PARTNER_SEARCH_TIMEOUT_MS = 15_000;

const tabs: readonly FindsTab[] = [
  { id: "all", label: "For your trip", categories: [] },
  { id: "stays", label: "Stays", categories: ["hotel"] },
  { id: "flights", label: "Flights", categories: ["flight"] },
  { id: "activities", label: "Things to do", categories: ["activity"] },
  { id: "amazon", label: "Travel essentials", categories: ["product"] },
  { id: "more", label: "Getting around", categories: ["transport"] }
] as const;

function dedupeCards(items: FindsCard[]) {
  const seen = new Set<string>();
  return items.filter((card) => {
    const key = `${card.provider.toLowerCase()}|${card.id || card.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function initialHotelPlace(destination: string): NormalizedPlace | null {
  const normalized = normalizePlaceText(destination).toLowerCase();
  if (!normalized || normalized === "your next somewhere") return null;
  return recommendedPlaces.find((place) =>
    [place.value, place.label, place.city].some((candidate) => normalizePlaceText(candidate || "").toLowerCase() === normalized)
  ) || null;
}

export function FindsTabs({ cards, destination, origin, startDate, endDate, disclosures, emptyMessage, activePromo, flightLiveSearchConfigured }: { cards: FindsCard[]; destination: string; origin: string; startDate: string; endDate: string; disclosures: string[]; emptyMessage: string; activePromo: FindsPromoConfig | null; flightLiveSearchConfigured: boolean }) {
  const [active, setActive] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [marketCards, setMarketCards] = useState(() => dedupeCards(cards));
  const [searchingHotels, setSearchingHotels] = useState(false);
  const [searchingCategory, setSearchingCategory] = useState<string | null>(null);
  const [hotelSearchMessage, setHotelSearchMessage] = useState("Add your destination and dates to search stay options with the booking partner.");
  const [partnerSearchMessage, setPartnerSearchMessage] = useState<Record<string, string>>({});
  const [partnerSearchHandoff, setPartnerSearchHandoff] = useState<Record<string, string>>({});
  const [hotelDestination, setHotelDestination] = useState<NormalizedPlace | null>(() => initialHotelPlace(destination));

  function openSearch(tab: "stays" | "flights" | "activities") {
    setActive(tab);
    setSearchOpen(true);
    document.getElementById("finds-live-options")?.scrollIntoView({ block: "start" });
  }
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

  async function searchHotels(form: HTMLFormElement) {
    const values = new FormData(form);
    const destinationValue = hotelDestination?.city?.trim() || hotelDestination?.value?.trim() || "";
    const countryValue = hotelDestination?.country?.trim() || "";
    const checkIn = String(values.get("stayCheckIn") || "");
    const checkOut = String(values.get("stayCheckOut") || "");
    const travelers = Number(values.get("stayTravelers") || 1);
    const rooms = Number(values.get("stayRooms") || 1);
    const maximumNightlyPrice = Number(values.get("stayMaxNightlyPrice") || 0);
    const hotelPreferences = String(values.get("stayPreferences") || "").trim();
    if (hotelDestination?.source === "custom" || !destinationValue || !countryValue || !normalizeCountryCode(countryValue)) {
      setHotelSearchMessage("Choose a destination from the place suggestions so we can verify its country before searching stays.");
      return;
    }
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setHotelSearchMessage("Add a check-in date and a later check-out date to check real availability.");
      return;
    }
    setSearchingHotels(true);
    setHotelSearchMessage("Opening stay options with the booking partner…");
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
        ? `${stays.length} verified provider stays matched these dates and are ranked by your stated preferences, then nightly price. ${maximumNightlyPrice > 0 ? `All shown are within your CAD ${maximumNightlyPrice}/night limit. ` : ""}Check the final offer before booking.`
        : body.warning || (maximumNightlyPrice > 0
          ? `No verified live stays fit your CAD ${maximumNightlyPrice}/night limit for these dates. Try raising the limit or changing your dates.`
          : "No live hotel offers with a verified property photo and booking link came back for these dates. Nothing has been substituted or guessed."));
    } catch {
      setHotelSearchMessage("The live stay search is temporarily unavailable. No stale prices or guessed stays are being shown.");
    } finally {
      setSearchingHotels(false);
    }
  }

  async function searchPartner(form: HTMLFormElement, category: "flight" | "attraction" | "transport", cardCategory: "flight" | "activity" | "transport") {
    let searchStarted = false;
    let timeoutId: number | null = null;
    try {
      const values = new FormData(form);
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
      if (category === "flight" && !flightLiveSearchConfigured) {
        if (!returnDate) {
          setPartnerSearchMessage((current) => ({ ...current, flight: "Add a return date so we can open the provider search with your full trip." }));
          return;
        }
        const handoffUrl = buildAviasalesDeepLink({
          origin: originValue,
          destination: destinationValue,
          departureDate: departure,
          returnDate,
          travelers: 1,
          marker: findsFlightHandoff.marker
        });
        if (!handoffUrl) {
          setPartnerSearchMessage((current) => ({ ...current, flight: "We couldn’t match one or both locations to a flight-search airport. Try a city or airport code." }));
          return;
        }
        setSearchingCategory(category);
        setPartnerSearchMessage((current) => ({ ...current, flight: `Opening your ${originValue} to ${destinationValue} search on ${findsFlightHandoff.provider}…` }));
        window.location.assign(handoffUrl);
        return;
      }
      searchStarted = true;
      setSearchingCategory(category);
      setPartnerSearchHandoff((current) => ({ ...current, [category]: "" }));
      setPartnerSearchMessage((current) => ({ ...current, [category]: category === "flight" ? "Checking current flight fares…" : category === "transport" ? "Looking for current transport options…" : "Looking for current experiences…" }));
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), PARTNER_SEARCH_TIMEOUT_MS);
      const response = await fetch("/api/roamly/market-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
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
      const body = await response.json().catch(() => null) as { results?: unknown; warning?: unknown; error?: unknown } | null;
      if (!response.ok) {
        const warning = typeof body?.warning === "string" ? body.warning : null;
        setPartnerSearchMessage((current) => ({
          ...current,
          [category]: warning || (category === "flight" ? "Current flight search is temporarily unavailable. No stale fares are being shown." : "The current search is temporarily unavailable. No stale offers are being shown.")
        }));
        return;
      }
      if (!body || !Array.isArray(body.results)) {
        setPartnerSearchMessage((current) => ({
          ...current,
          [category]: category === "flight" ? "Current flight search returned an unreadable response. No fares are being shown." : "The current search returned an unreadable response. No offers are being shown."
        }));
        return;
      }
      const results = body.results;
      const warning = typeof body.warning === "string" ? body.warning : null;
      const handoff = category === "flight"
        ? results.map(flightFindHandoff).find((href): href is string => Boolean(href)) || ""
        : "";
      const cardsForShelf = results.map((item) => category === "flight" ? flightFindCard(item) : category === "transport" ? klookTransportFindCard(item) : publicEventFindCard(item) || klookFindCard(item)).filter((card): card is FindsCard => Boolean(card));
      setMarketCards((current) => dedupeCards([...current.filter((card) => card.category !== cardCategory), ...cardsForShelf]));
      setPartnerSearchHandoff((current) => ({ ...current, [category]: cardsForShelf.length ? "" : handoff }));
      setPartnerSearchMessage((current) => ({
        ...current,
        [category]: cardsForShelf.length
          ? `${cardsForShelf.length} current ${cardCategory === "flight" ? "flight option" : cardCategory === "transport" ? "transport option" : "experience"}${cardsForShelf.length === 1 ? "" : "s"} found. Confirm the final price and availability before booking.`
          : warning || `No current ${cardCategory === "flight" ? "fare" : cardCategory === "transport" ? "transport option" : "experience"} with a verified link${cardCategory !== "flight" ? " and image" : ""} came back. No unverified offers are shown.`
      }));
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "AbortError";
      setPartnerSearchMessage((current) => ({
        ...current,
        [category]: timedOut && category === "flight" ? "Flight search timed out. Current fares are unavailable right now. No stale fares are being shown." : "Search is temporarily unavailable. No stale offers are being shown."
      }));
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (searchStarted) setSearchingCategory(null);
    }
  }

  const liveTools = <div className="pt-5">
    <div role="tablist" aria-label="Live travel options" className="flex gap-2 overflow-x-auto pb-3">
      {tabs.map((item, index) => <button key={item.id} id={`finds-tab-${item.id}`} type="button" role="tab" tabIndex={active === item.id ? 0 : -1} aria-selected={active === item.id} aria-controls="finds-live-panel" onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => setActive(item.id)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20 ${active === item.id ? "bg-[#203c43] text-white" : "border border-[#e0e8e1] bg-white text-[#547067] hover:border-[#b7d9c8]"}`}>{item.label}</button>)}
    </div>
    {active === "stays" ? <form id="finds-live-panel" onSubmit={(event) => { event.preventDefault(); void searchHotels(event.currentTarget); }} className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="lg:col-span-2"><PlaceSelector label="Where are you staying?" value={hotelDestination} onChange={setHotelDestination} placeholder="Search a city or destination" helper="Choose a suggested place with its country. We use that match to search the right area." /></div>
      <label className="text-xs font-bold text-[#547067]">Check in<input name="stayCheckIn" type="date" defaultValue={startDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067]">Check out<input name="stayCheckOut" type="date" defaultValue={endDate} required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <div className="flex items-end"><button disabled={searchingHotels} className="min-h-11 w-full rounded-xl bg-[#0f6e66] px-4 text-xs font-black text-white disabled:opacity-60" type="submit">{searchingHotels ? "Opening…" : "Search stays"}</button></div>
      <label className="text-xs font-bold text-[#547067]">Travelers<input name="stayTravelers" type="number" min="1" max="20" defaultValue="2" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067]">Rooms<input name="stayRooms" type="number" min="1" max="10" defaultValue="1" required className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <p aria-live="polite" data-find-state={searchingHotels ? "loading" : hotelSearchMessage === "Add your destination and dates to search stay options with the booking partner." ? "idle" : "terminal"} className="text-xs leading-5 text-[#718179] sm:col-span-2 lg:col-span-4">{hotelSearchMessage}</p>
    </form> : null}
    {active === "flights" ? <form id="finds-live-panel" noValidate onSubmit={(event) => { event.preventDefault(); void searchPartner(event.currentTarget, "flight", "flight"); }} className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-bold text-[#547067]">From<input name="flightOrigin" defaultValue={origin} placeholder="Halifax" aria-required="true" maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067]">To<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Lisbon" aria-required="true" maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067]">Depart<input name="flightDeparture" type="date" defaultValue={startDate} aria-required="true" className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067]">Return<input name="flightReturn" type="date" defaultValue={endDate} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <div className="flex items-end"><button disabled={searchingCategory === "flight"} className="min-h-11 w-full rounded-xl bg-[#0f6e66] px-4 text-xs font-black text-white disabled:opacity-60" type="submit">{searchingCategory === "flight" ? "Checking…" : "Check flights"}</button></div>
      <div className="sm:col-span-2 lg:col-span-5">
        <p key={partnerSearchMessage.flight || "flight-idle"} aria-live="polite" data-find-state={searchingCategory === "flight" ? "loading" : partnerSearchMessage.flight ? "terminal" : "idle"} className="text-xs leading-5 text-[#718179]">{partnerSearchMessage.flight || (flightLiveSearchConfigured ? "Checking current fares with the approved flight feed." : "Open a real partner search with your route and dates. Roamly does not independently verify fares here.")}</p>
        {partnerSearchHandoff.flight ? <a href={partnerSearchHandoff.flight} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#0f6e66] bg-[#0f6e66] px-4 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-[#0b5b55] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">Check current flights on Aviasales <span aria-hidden="true" className="ml-2">↗</span></a> : null}
      </div>
    </form> : null}
    {active === "activities" ? <form id="finds-live-panel" onSubmit={(event) => { event.preventDefault(); void searchPartner(event.currentTarget, "attraction", "activity"); }} className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-xs font-bold text-[#547067]">Destination<input name="partnerDestination" defaultValue={destination === "your next somewhere" ? "" : destination} placeholder="Tokyo" required maxLength={80} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <label className="text-xs font-bold text-[#547067] lg:col-span-2">What sounds fun?<input name="activityQuery" placeholder="Food tour, museum, evening walk…" required maxLength={100} className="mt-1 min-h-11 w-full rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] px-3 text-sm outline-none focus:border-[#0f6e66] focus:ring-4 focus:ring-[#0f6e66]/10" /></label>
      <div className="flex items-end"><button disabled={searchingCategory === "attraction"} className="min-h-11 w-full rounded-xl bg-[#0f6e66] px-4 text-xs font-black text-white disabled:opacity-60" type="submit">{searchingCategory === "attraction" ? "Looking…" : "Explore experiences"}</button></div>
      <p aria-live="polite" data-find-state={searchingCategory === "attraction" ? "loading" : partnerSearchMessage.attraction ? "terminal" : "idle"} className="text-xs leading-5 text-[#718179] sm:col-span-2 lg:col-span-4">{partnerSearchMessage.attraction || "Real activities and public events appear only when their details and links can be grounded."}</p>
    </form> : null}
    {active === "amazon" || active === "more" ? <div id="finds-live-panel" aria-live="polite" className="grid gap-3 pt-3">
      {(() => {
        const category = active === "amazon" ? "product" : "transport";
        const matches = marketCards.filter((card) => card.category === category);
        return matches.length ? <><p className="text-xs leading-5 text-[#718179]">{active === "amazon" ? "Travel essentials from verified category links." : "Getting around options with provider-grounded links."}</p><div className="grid gap-3 sm:grid-cols-2">{matches.slice(0, 4).map((card) => <a key={card.id} href={card.href} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-[#e0e8e1] bg-[#fcfdf9] p-3 text-sm font-bold text-[#365f56] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/15"><span className="block text-[10px] uppercase tracking-[0.16em] text-[#0f6e66]">{card.eyebrow}</span>{card.title}<span className="mt-1 block text-xs font-semibold text-[#718179]">{card.action} ↗</span></a>)}</div></> : <p className="rounded-xl bg-[#f1f5ef] p-4 text-xs leading-5 text-[#718179]">{active === "amazon" ? "No verified travel-essential categories are available for this destination yet." : "No verified getting-around options are available for this destination yet."}</p>;
      })()}
    </div> : null}
  </div>;

  return <FindsEditorialMagazine cards={marketCards} destination={destination} emptyMessage={emptyMessage} disclosures={disclosures} activePromo={activePromo} liveTools={liveTools} searchOpen={searchOpen} onSearchOpenChange={setSearchOpen} onOpenSearch={openSearch} />;
}
