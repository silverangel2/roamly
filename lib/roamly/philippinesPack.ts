/*
 * Philippines data pack (Roamly PH launch — P0/P1 build, 2026-10-23).
 *
 * Every activity in this pack was verified through Google Places
 * (Text Search via the registered Places connector) on 2026-10-23:
 * the place exists, and its coordinates, display name, and address
 * below are the provider's own record — nothing is written from
 * memory. An activity that could not be verified did not enter
 * the pack (the launch plan's hard rule: no coordinate, no activity).
 *
 * Costs are per-person planning ESTIMATES in Philippine pesos.
 * Every cost carries cost_status "ESTIMATED" and a plain-words
 * cost_basis; entrance fees and tour prices change, so the app
 * keeps telling travelers to verify before booking.
 *
 * Season notes are labelled general patterns / estimates, exactly
 * as the launch plan requires — they are guidance, not promises.
 */
import {
  buildStarterItinerary,
  clampTripDays,
  normalizeItinerary,
  type RoamlyActivitySeed,
  type RoamlyItinerary
} from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export const PH_PACK_VERIFIED_AT = "2026-10-23";
export const PH_PACK_CURRENCY = "PHP";

export type PhActivitySeed = RoamlyActivitySeed & {
  /** Google Places place ID of the verified place (external identifier). */
  google_place_id: string;
  /** Plain-words basis for the estimated cost (never presented as a verified price). */
  cost_basis: string;
};

export type PhDestinationArea = {
  key: string;
  displayName: string;
  region: string;
  tagline: string;
  seasonNote: string;
  festivalHook: { name: string; when: string; note: string } | null;
  planLinks: { label: string; plannerLabel: string }[];
  activities: PhActivitySeed[];
};

/** Format an amount as pesos (₱) for the /ph surface. */
export function formatPeso(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `₱${Math.round(amount).toLocaleString("en")}`;
  }
}

export function philippinesPlanHref(plannerLabel: string): string {
  return `/plan?destination=${encodeURIComponent(plannerLabel)}`;
}

export const PH_AREA_MANILA: PhDestinationArea = {
  key: "manila",
  displayName: "Manila",
  region: "Metro Manila",
  tagline: "Where every trip home begins — the walled city, the bay, and the modern skyline.",
  seasonNote: "Rainy season runs roughly June to November; December to February is usually the coolest, driest window. General pattern only — check the forecast before you go.",
  festivalHook: null,
  planLinks: [{ label: "Plan a Manila trip", plannerLabel: "Manila, Philippines" }],
  activities: [
    {
      time_label: "9:00 AM",
      title: "Intramuros — the Walled City",
      description: "Walk the Spanish colonial walled city — cobbled streets, horse-drawn kalesa, and centuries of Manila history inside the old walls.",
      location_name: "Intramuros",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Intramuros, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 14.589597200000002, longitude: 120.9747258 },
      google_place_id: "ChIJ--F1Ez3KlzMRCLrAWKa_ngQ",
      cost_basis: "Free to enter and walk; individual sites inside charge their own small fees."
    },    {
      time_label: "9:30 AM",
      title: "Fort Santiago",
      description: "The citadel at the mouth of the Pasig River, with the Rizal Shrine tracing the national hero's final days.",
      location_name: "Fort Santiago",
      estimated_cost: 75,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Fort Santiago, Intramuros, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.594235299999998, longitude: 120.97041189999999 },
      google_place_id: "ChIJvZ4MeBbKlzMRQ7CLeMYOQ80",
      cost_basis: "Typical posted adult entrance fee (estimate — verify at the gate)."
    },    {
      time_label: "11:00 AM",
      title: "San Agustin Church",
      description: "A UNESCO World Heritage stone church from 1607 — the oldest in the Philippines — with a museum of colonial religious art.",
      location_name: "San Agustin Church, Intramuros",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "San Agustin Church, Intramuros, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.589077399999999, longitude: 120.97535099999999 },
      google_place_id: "ChIJY1NEIz3KlzMRamMm7IEXLWw",
      cost_basis: "Church entry is free; the adjoining museum charges a small fee (estimate)."
    },    {
      time_label: "8:30 AM",
      title: "Manila Cathedral",
      description: "The grand Romanesque cathedral of Intramuros, rebuilt many times across four centuries of earthquakes and war.",
      location_name: "Manila Cathedral, Intramuros",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Manila Cathedral, Intramuros, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 45,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.5917422, longitude: 120.97339210000001 },
      google_place_id: "ChIJeWcu0hfKlzMRnYOqfe-gowY",
      cost_basis: "Free church entry."
    },    {
      time_label: "10:00 AM",
      title: "National Museum of Fine Arts",
      description: "Home of Juan Luna's Spoliarium and the country's finest art collection, part of the National Museum complex by Rizal Park.",
      location_name: "National Museum of Fine Arts",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Museums",
      map_query: "National Museum of Fine Arts, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.5870316, longitude: 120.98102519999999 },
      google_place_id: "ChIJa5tW0CPKlzMRKuDqk7sMx88",
      cost_basis: "The National Museum complex offers free admission (policy as widely published — verify on the day)."
    },    {
      time_label: "7:00 AM",
      title: "Rizal Park (Luneta)",
      description: "Manila's great green front yard by the bay — the Rizal Monument, gardens, and the city's favorite early-morning walk.",
      location_name: "Rizal Park",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Rizal Park, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 14.5826446, longitude: 120.97868869999999 },
      google_place_id: "ChIJPxN-XiXKlzMRMpp1toc0Krc",
      cost_basis: "Free public park."
    },    {
      time_label: "4:00 PM",
      title: "Binondo — the world's oldest Chinatown",
      description: "Established in 1594, Binondo is a feast on foot — dumplings, hopia, and noodle houses along Ongpin Street and beyond.",
      location_name: "Binondo",
      estimated_cost: 500,
      cost_status: "ESTIMATED",
      category: "Food",
      map_query: "Binondo, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "restaurant",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.601192000000001, longitude: 120.97500649999999 },
      google_place_id: "ChIJCYk0LRDKlzMR-N9ONSkgq-0",
      cost_basis: "Estimate for a self-guided food crawl (several small dishes and snacks per person)."
    },    {
      time_label: "8:00 AM",
      title: "Quiapo Church",
      description: "Home of the Black Nazarene and one of the country's most fervent devotions, surrounded by a famously lively market quarter.",
      location_name: "Quiapo Church - Minor Basilica and National Shrine of Jesús Nazareno",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Quiapo Church, Manila, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 45,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.598927299999998, longitude: 120.98377780000001 },
      google_place_id: "ChIJWbdA7BzKlzMRSn3yPxEPtO0",
      cost_basis: "Free church entry."
    },    {
      time_label: "1:00 PM",
      title: "Manila Ocean Park",
      description: "Oceanarium and marine attractions behind Rizal Park on Manila Bay — a reliable family half-day, rain or shine.",
      location_name: "Manila Ocean Park",
      estimated_cost: 750,
      cost_status: "ESTIMATED",
      category: "Family",
      map_query: "Manila Ocean Park, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 180,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.5793088, longitude: 120.9724475 },
      google_place_id: "ChIJDXUM9QPKlzMRDOajr3iHEoQ",
      cost_basis: "Typical posted ticket bundle per person (estimate — packages vary; verify current rates)."
    },    {
      time_label: "7:30 PM",
      title: "Cultural Center of the Philippines",
      description: "The country's flagship performing-arts complex on the bay — check the season calendar for ballet, orchestra, and theater.",
      location_name: "Cultural Center of the Philippines",
      estimated_cost: 500,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Cultural Center of the Philippines, Pasay",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.558412, longitude: 120.985911 },
      google_place_id: "ChIJHxrGi9fLlzMRVSHiA1IJTOY",
      cost_basis: "Typical mid-range performance ticket per person (estimate — prices vary by show)."
    },    {
      time_label: "5:00 PM",
      title: "Bonifacio Global City",
      description: "Manila's modern face — wide sidewalks, public art, Bonifacio High Street, and an easy evening of dining and people-watching.",
      location_name: "Bonifacio Global City (Bonifacio High Street), Taguig",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Shopping",
      map_query: "Bonifacio High Street, Taguig, Metro Manila, Philippines (re-query; first hit was the Fort Bonifacio district point)",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 14.550729599999999, longitude: 121.0503969 },
      google_place_id: "ChIJPSRB9O7IlzMRyWGILpcpHEs",
      cost_basis: "Free to explore; food and shopping are pay-as-you-go."
    }
  ]
};

export const PH_AREA_BORACAY: PhDestinationArea = {
  key: "boracay",
  displayName: "Boracay",
  region: "Malay, Aklan",
  tagline: "The island that reset Philippine beach travel — powder sand on the west, kite-wild water on the east.",
  seasonNote: "Dry season with calmer west-side seas runs roughly November to May (Amihan). June to October brings Habagat rain and rougher water. General pattern only — island tours are weather-dependent.",
  festivalHook: null,
  planLinks: [{ label: "Plan a Boracay trip", plannerLabel: "Boracay, Philippines" }],
  activities: [
    {
      time_label: "8:00 AM",
      title: "White Beach",
      description: "Four kilometers of powder-white sand and calm, clear water — the beach that made Boracay world-famous.",
      location_name: "White Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "White Beach, Boracay Island, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 180,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 11.952444, longitude: 121.929614 },
      google_place_id: "ChIJa0aowyI8pTMRsvScrmZRPkQ",
      cost_basis: "Free public beach; island environmental/terminal fees are paid on arrival, not per activity."
    },    {
      time_label: "4:30 PM",
      title: "Willy's Rock",
      description: "The island's postcard landmark — a volcanic rock outcrop with a small grotto, just offshore at Station 1.",
      location_name: "Willy's Rock",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Willy's Rock, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 45,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9682252, longitude: 121.91871340000002 },
      google_place_id: "ChIJnxiaKxE8pTMRZJ6zvUafJ6M",
      cost_basis: "Free; wade out at low tide."
    },    {
      time_label: "9:00 AM",
      title: "Puka Shell Beach (Yapak)",
      description: "Boracay's quieter northern shore, named for its puka shells — coarser sand, fewer people, same blue water.",
      location_name: "Puka Shell Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Puka Shell Beach, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9946643, longitude: 121.91219810000001 },
      google_place_id: "ChIJ-0qso2I8pTMRNIrXs5qrXy4",
      cost_basis: "Free public beach."
    },    {
      time_label: "3:00 PM",
      title: "Diniwid Beach",
      description: "A small, relaxed cove a short walk north of White Beach — the local answer to the main strip's buzz.",
      location_name: "Diniwid Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Diniwid Beach, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9762953, longitude: 121.91166769999998 },
      google_place_id: "ChIJiUxzkRI8pTMRVkfLZEJ2WZ0",
      cost_basis: "Free public beach."
    },    {
      time_label: "8:30 AM",
      title: "Mount Luho Viewpoint",
      description: "The island's highest point, with a viewing deck over Bulabog Bay and the whole east coast.",
      location_name: "Mount Luho",
      estimated_cost: 120,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Mount Luho, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.978979599999999, longitude: 121.9279861 },
      google_place_id: "ChIJjcKdfEE8pTMRA1HZXsV1T4M",
      cost_basis: "Typical viewpoint entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "10:00 AM",
      title: "Bulabog Beach — kite & windsurf bay",
      description: "Boracay's windy east side, Asia-famous for kiteboarding in the Amihan season — watch the bay fill with kites, or take a lesson.",
      location_name: "Bulabog Beach",
      estimated_cost: 1500,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Bulabog Beach, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9692679, longitude: 121.9273114 },
      google_place_id: "ChIJEZp3Yzs8pTMRRk39gb5nhyo",
      cost_basis: "Typical one-hour kiteboarding taster/lesson share per person (estimate — schools vary)."
    },    {
      time_label: "9:30 AM",
      title: "Crystal Cove Island",
      description: "A small island of coves, caves, and viewpoints, a standard stop on Boracay island-hopping boats.",
      location_name: "Crystal Cove Island Resort",
      estimated_cost: 300,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Crystal Cove Island, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.944503899999999, longitude: 121.9580638 },
      google_place_id: "ChIJK_8GB3o-pTMRFV2scmFWFvo",
      cost_basis: "Typical island-hopping stop with a small entrance fee per person (estimate — usually bundled in a boat tour)."
    },    {
      time_label: "10:30 AM",
      title: "Crocodile Island snorkeling",
      description: "The island's best-known snorkel reef — coral gardens and dense fish life off a rock shaped like its namesake.",
      location_name: "Crocodile Island",
      estimated_cost: 350,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Crocodile Island, Boracay, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9497801, longitude: 121.9514883 },
      google_place_id: "ChIJaedkQH8-pTMRr04AUdTN6ho",
      cost_basis: "Typical snorkeling fee/share per person within an island-hopping tour (estimate)."
    },    {
      time_label: "10:30 AM",
      title: "Ariel's Point cliff diving (day trip)",
      description: "A boat ride to Buruanga's eco-adventure outpost — cliff diving boards from 3 to 15 meters, swimming, and a long lazy lunch.",
      location_name: "Ariel's Point",
      estimated_cost: 2800,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Ariel's Point, Buruanga, Aklan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 300,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.8649652, longitude: 121.8774912 },
      google_place_id: "ChIJ-9AVGmpHpTMRs7BdHEmEklY",
      cost_basis: "Typical day-trip package per person including boat, lunch, and drinks (estimate — verify with the operator)."
    }
  ]
};

export const PH_AREA_PALAWAN: PhDestinationArea = {
  key: "palawan",
  displayName: "Palawan",
  region: "Palawan",
  tagline: "El Nido's lagoons, Coron's lakes and wrecks, and the Underground River — the dream-trip cluster.",
  seasonNote: "Dry season runs roughly November to May. Boat tours run year-round in good weather but are cancelled in rough seas at any time of year. General pattern only — confirm per town before booking.",
  festivalHook: null,
  planLinks: [{ label: "Plan El Nido", plannerLabel: "El Nido, Philippines" }, { label: "Plan Coron", plannerLabel: "Coron, Philippines" }, { label: "Plan Puerto Princesa", plannerLabel: "Puerto Princesa, Philippines" }],
  activities: [
    {
      time_label: "9:00 AM",
      title: "Big Lagoon",
      description: "Kayak between towering limestone walls into a vast, calm lagoon — the signature El Nido experience.",
      location_name: "Big Lagoon",
      estimated_cost: 1200,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Big Lagoon, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 11.1544236, longitude: 119.32103710000001 },
      google_place_id: "ChIJA48DcIlTtjMRHYjURyc8mgo",
      cost_basis: "Reached on El Nido island-hopping Tour A; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "el-nido-tour-a",
      packageName: "El Nido Tour A",
    },    {
      time_label: "11:00 AM",
      title: "Small Lagoon",
      description: "Slip through a gap in the rock into a hidden emerald pool on Miniloc Island — swim and kayak in near silence.",
      location_name: "Small Lagoon",
      estimated_cost: 1200,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Small Lagoon, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.158156, longitude: 119.31868209999999 },
      google_place_id: "ChIJYTo4UY9TtjMRVlai3o-5OXw",
      cost_basis: "Reached on El Nido island-hopping Tour A; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "el-nido-tour-a",
      packageName: "El Nido Tour A",
    },    {
      time_label: "1:00 PM",
      title: "Secret Lagoon",
      description: "A beach-hidden lagoon tucked inside a karst wall, reached through a small opening — part of the classic Tour A circuit.",
      location_name: "Secret Lagoon",
      estimated_cost: 1200,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Secret Lagoon, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.145541999999999, longitude: 119.3127177 },
      google_place_id: "ChIJgQMlc_JTtjMR7WdrITcL5Cs",
      cost_basis: "Reached on El Nido island-hopping Tour A; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "el-nido-tour-a",
      packageName: "El Nido Tour A",
    },    {
      time_label: "12:00 PM",
      title: "Shimizu Island",
      description: "The usual Tour A lunch stop — a small island with good snorkeling right off the sand.",
      location_name: "Shimizu Island",
      estimated_cost: 1200,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Shimizu Island, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.138866199999999, longitude: 119.31856160000001 },
      google_place_id: "ChIJIeqOqPBTtjMRRZ1-mWksR_M",
      cost_basis: "Reached on El Nido island-hopping Tour A; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "el-nido-tour-a",
      packageName: "El Nido Tour A",
    },    {
      time_label: "3:00 PM",
      title: "Seven Commandos Beach",
      description: "A long palm-fringed beach with a swing, a beach bar, and soft late-afternoon light — the gentle end to a Tour A day.",
      location_name: "Seven Commandos Beach",
      estimated_cost: 1200,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Seven Commandos Beach, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.1736705, longitude: 119.378839 },
      google_place_id: "ChIJxYHcOxtVtjMR-cXnckGR6d0",
      cost_basis: "Reached on El Nido island-hopping Tour A; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "el-nido-tour-a",
      packageName: "El Nido Tour A",
    },    {
      time_label: "6:00 AM",
      title: "Taraw Cliff Canopy Walk",
      description: "A guided via-ferrata style climb above El Nido town for sunrise over Bacuit Bay — booked early, worth the alarm.",
      location_name: "Taraw Cliff",
      estimated_cost: 400,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Taraw Cliff, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.1790798, longitude: 119.38886289999999 },
      google_place_id: "ChIJ0SnmgRZVtjMR0yJFmVGxPbQ",
      cost_basis: "Typical guided canopy-walk fee per person (estimate — verify with the operator)."
    },    {
      time_label: "9:00 AM",
      title: "Nacpan Beach",
      description: "A four-kilometer sweep of golden sand north of town — twin-beach views from the hill, and room to breathe.",
      location_name: "Nacpan Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Nacpan Beach, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 240,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.3211895, longitude: 119.427758 },
      google_place_id: "ChIJd37nuHgHtzMR4MX5vpEOoRw",
      cost_basis: "Free public beach; budget for the tricycle or shuttle ride from town."
    },    {
      time_label: "4:30 PM",
      title: "Las Cabañas Beach (Marimegmeg)",
      description: "El Nido's sunset beach — a short ride from town, with beach bars and a zipline over the water.",
      location_name: "Las Cabañas Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Las Cabanas Beach, El Nido, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.1448032, longitude: 119.39445730000001 },
      google_place_id: "ChIJld6ZHr5VtjMRxXad8eDfSjE",
      cost_basis: "Free public beach; the zipline across to Depeldet Island is a separate paid activity."
    },    {
      time_label: "8:00 AM",
      title: "Kayangan Lake",
      description: "Often called the cleanest lake in Asia — a short climb to the famous viewpoint, then a swim in glass-clear brackish water.",
      location_name: "Kayangan Lake",
      estimated_cost: 1500,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Kayangan Lake, Coron, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 11.9578378, longitude: 120.22602859999998 },
      google_place_id: "ChIJ642l7PMcujMRhGBA1dyvXH0",
      cost_basis: "Reached on Coron island tours; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "coron-island-tour",
      packageName: "Coron island tour",
    },    {
      time_label: "10:30 AM",
      title: "Barracuda Lake",
      description: "A surreal freediving and swimming lake where the water temperature shifts in layers between limestone walls.",
      location_name: "Barracuda Lake",
      estimated_cost: 1500,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Barracuda Lake, Coron, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9550501, longitude: 120.216697 },
      google_place_id: "ChIJDz4mcvAcujMRdEox-GOObYs",
      cost_basis: "Reached on Coron island tours; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "coron-island-tour",
      packageName: "Coron island tour",
    },    {
      time_label: "1:00 PM",
      title: "Twin Lagoon",
      description: "Two lagoons joined by a low rock opening you swim or kayak through as the tide allows — warm and cool currents in one swim.",
      location_name: "Twin Lagoon",
      estimated_cost: 1500,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Twin Lagoon, Coron, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9476028, longitude: 120.20967979999999 },
      google_place_id: "ChIJ2_px0QwdujMRIRvv9VcjmF0",
      cost_basis: "Reached on Coron island tours; typical joiner tour price per person (estimate — verify with the operator).",
      packageId: "coron-island-tour",
      packageName: "Coron island tour",
    },    {
      time_label: "3:30 PM",
      title: "Maquinit Hot Spring",
      description: "Saltwater hot spring pools by the mangroves — the classic way to end a Coron boat day.",
      location_name: "Maquinit Hot Spring",
      estimated_cost: 350,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Maquinit Hot Spring, Coron, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 11.9915909, longitude: 120.2281506 },
      google_place_id: "ChIJYzrpn9MdujMRLcOZG0eE1WU",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "5:30 PM",
      title: "Mount Tapyas",
      description: "Coron town's sunset hill — a stair climb to a giant cross and a full view over the harbor and islands.",
      location_name: "Mount Tapyas",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Hiking",
      map_query: "Mount Tapyas, Coron, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 12.004982, longitude: 120.20366680000001 },
      google_place_id: "ChIJ_cwvI34eujMRX9tr3GMABM0",
      cost_basis: "Free; climb the ~700 steps at your own pace."
    },    {
      time_label: "8:00 AM",
      title: "Puerto Princesa Underground River",
      description: "A UNESCO-listed navigable underground river through cathedral-like caves — the flagship day trip from Puerto Princesa, via Sabang.",
      location_name: "Puerto Princesa Subterranean River National Park",
      estimated_cost: 2000,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Puerto Princesa Subterranean River National Park, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 300,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 10.1925595, longitude: 118.92658290000001 },
      google_place_id: "ChIJ2S2fQEKRtTMRxH_ykqtdyx4",
      cost_basis: "Typical full-day tour per person including permits, boat, and lunch (estimate — permits are limited; book ahead)."
    },    {
      time_label: "8:30 AM",
      title: "Honda Bay island hopping",
      description: "A boat day across Honda Bay's islands — Starfish Island's shallows, Luli Island's sandbar, and Cowrie Island for lunch.",
      location_name: "Honda Bay",
      estimated_cost: 1500,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Honda Bay, Puerto Princesa, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 300,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.8439043, longitude: 118.74552630000001 },
      google_place_id: "ChIJsaW-5pJ8tTMRJHcvAy6Ha0c",
      cost_basis: "Typical joiner island-hopping tour per person (estimate — island fees vary by stop)."
    },    {
      time_label: "1:00 PM",
      title: "Ugong Rock Adventures",
      description: "A community-run limestone climb through echoing chambers ('ugong' = the rock's hum), ending in a zipline ride down.",
      location_name: "UGONG ROCK ADVENTURES",
      estimated_cost: 700,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Ugong Rock, Puerto Princesa, Palawan, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.0868653, longitude: 118.85466969999999 },
      google_place_id: "ChIJ90_fd_tjtTMRY8smgDQoFo0",
      cost_basis: "Typical caving + zipline package per person (estimate — community-run; verify on site)."
    }
  ]
};

export const PH_AREA_CEBU_BOHOL: PhDestinationArea = {
  key: "cebu-bohol",
  displayName: "Cebu + Bohol",
  region: "Central Visayas",
  tagline: "The Philippines' oldest city, sardine runs and falls — with the Chocolate Hills a ferry ride away.",
  seasonNote: "Driest roughly February to May; rain is possible year-round. January is Sinulog month — the city fills up and prices jump. General pattern only.",
  festivalHook: { name: "Sinulog Festival", when: "Mid-January (third Sunday)", note: "Cebu's grandest festival, honoring the Santo Niño. The Basilica and Magellan's Cross are its heart. Book rooms and flights early — the city is at its fullest." },
  planLinks: [{ label: "Plan Cebu City", plannerLabel: "Cebu City, Philippines" }, { label: "Plan Bohol", plannerLabel: "Bohol, Philippines" }],
  activities: [
    {
      time_label: "8:30 AM",
      title: "Magellan's Cross",
      description: "The cross planted on Magellan's arrival in 1521, housed in a small chapel beside the Basilica — the symbolic start of Philippine Christianity.",
      location_name: "Magellan's Cross",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Magellan's Cross, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 30,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 10.2935626, longitude: 123.9019549 },
      google_place_id: "ChIJQVwA2-ObqTMR--ZXFjrCXiQ",
      cost_basis: "Free public site."
    },    {
      time_label: "9:00 AM",
      title: "Basilica Minore del Santo Niño",
      description: "Cebu's beloved basilica and home of the Santo Niño image — the living heart of Sinulog devotion every January.",
      location_name: "Basilica Minore del Santo Niño, Cebu City",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Basilica Minore del Santo Niño, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.2941085, longitude: 123.90210569999999 },
      google_place_id: "ChIJp45-1uObqTMRKiyk55UEjGY",
      cost_basis: "Free church entry."
    },    {
      time_label: "10:30 AM",
      title: "Fort San Pedro",
      description: "The smallest and oldest triangular fort in the Philippines — quiet gardens a few steps from the port.",
      location_name: "Fort San Pedro",
      estimated_cost: 30,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Fort San Pedro, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.292456999999999, longitude: 123.905636 },
      google_place_id: "ChIJiYix3uCbqTMRAqkwfbD7es0",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "1:00 PM",
      title: "Casa Gorordo Museum",
      description: "A beautifully kept 19th-century bahay na bato in the old Parian district — Cebuano family life, preserved.",
      location_name: "Casa Gorordo Museum",
      estimated_cost: 70,
      cost_status: "ESTIMATED",
      category: "Museums",
      map_query: "Casa Gorordo Museum, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.299913, longitude: 123.9048616 },
      google_place_id: "ChIJdZVg9F6ZqTMRbU7ErBLR6vU",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "11:30 AM",
      title: "Cebu Taoist Temple",
      description: "A colorful hilltop temple in Beverly Hills with dragon statues, a Great Wall replica, and city views.",
      location_name: "Cebu Taoist Temple",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Cebu Taoist Temple, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.334248299999999, longitude: 123.88798429999999 },
      google_place_id: "ChIJ8ZcMGyuZqTMRh0kBRAhSv_o",
      cost_basis: "Free entry (donations welcome)."
    },    {
      time_label: "2:00 PM",
      title: "Sirao Flower Garden",
      description: "Cebu's 'Little Amsterdam' — hillside flower fields in the cool uplands above the city.",
      location_name: "Sirao Garden",
      estimated_cost: 100,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Sirao Flower Garden, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.406157799999999, longitude: 123.86584160000001 },
      google_place_id: "ChIJH7-Frg-hqTMRcR-eubefklo",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "3:30 PM",
      title: "Temple of Leah",
      description: "A grand Roman-style shrine built as a monument of love, with columns, statues, and a sweeping city panorama.",
      location_name: "Temple of Leah",
      estimated_cost: 150,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Temple of Leah, Cebu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.3688615, longitude: 123.87325349999998 },
      google_place_id: "ChIJPwVVvlqfqTMR8k8YW0-7Luo",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "9:00 AM",
      title: "Mactan Shrine (Lapu-Lapu Monument)",
      description: "The memorial to Lapu-Lapu and the 1521 Battle of Mactan, on the shore where it happened.",
      location_name: "Mactan Shrine",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Mactan Shrine, Lapu-Lapu City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.3108234, longitude: 124.0152507 },
      google_place_id: "ChIJ3xcIQNCXqTMR5QCimnAfri4",
      cost_basis: "Free public park."
    },    {
      time_label: "9:00 AM",
      title: "Moalboal sardine run, Panagsama Beach",
      description: "A swirling sardine school that lives just off the beach year-round — snorkel straight into it from Panagsama.",
      location_name: "Panagsama Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Panagsama Beach, Moalboal, Cebu, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 180,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.9464207, longitude: 123.3685522 },
      google_place_id: "ChIJjdOKTMLoqzMR8s8ab7MnfKs",
      cost_basis: "Free to snorkel from shore at your own pace; gear rental and boat dives are pay-as-you-go."
    },    {
      time_label: "8:00 AM",
      title: "Kawasan Falls, Badian",
      description: "Three tiers of milky turquoise falls reached by an easy riverside walk — Cebu's most famous day trip south.",
      location_name: "Kawasan Falls",
      estimated_cost: 45,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Kawasan Falls, Badian, Cebu, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 240,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.8035027, longitude: 123.37433109999998 },
      google_place_id: "ChIJzaFdmHHAqzMRzyRjfu-ZeDU",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate; canyoneering tours are separate and cost more)."
    },    {
      time_label: "6:00 AM",
      title: "Oslob whale shark watching",
      description: "A strictly regulated early-morning encounter with whale sharks in Tan-awan — brief, supervised, and run under local rules.",
      location_name: "Oslob Whale Shark Watching",
      estimated_cost: 1000,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Oslob Whale Shark Watching, Tan-awan, Oslob, Cebu, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.4633589, longitude: 123.37973380000001 },
      google_place_id: "ChIJBwm4UkR0qzMR1yMRjqgTPUQ",
      cost_basis: "Typical regulated watching fee per person (estimate — verify the current LGU rate; go early, follow the no-touch rules)."
    },    {
      time_label: "8:00 AM",
      title: "Chocolate Hills",
      description: "Over a thousand cone hills that turn chocolate-brown in the dry season — Bohol's icon, best from the Carmen viewpoint.",
      location_name: "Chocolate Hills Complex",
      estimated_cost: 100,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Chocolate Hills, Carmen, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 9.798644099999999, longitude: 124.16746369999998 },
      google_place_id: "ChIJ7bQymfgWqjMRsIML34Cnk_g",
      cost_basis: "Typical posted viewpoint entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "10:30 AM",
      title: "Philippine Tarsier Sanctuary, Corella",
      description: "A quiet conservation forest where guides point out sleeping tarsiers — one of the world's smallest primates, protected here.",
      location_name: "Philippine Tarsier Sanctuary",
      estimated_cost: 120,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Philippine Tarsier Sanctuary, Corella, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.6907827, longitude: 123.9526892 },
      google_place_id: "ChIJiygR7CVJqjMRN6KOwTPZm78",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "9:30 AM",
      title: "Bilar Man-Made Forest",
      description: "A two-kilometer tunnel of mahogany trees planted decades ago — the famous cool, green drive-through on the way to the hills.",
      location_name: "Bilar Man-Made Forest",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Bilar Man-Made Forest, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 30,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.667214399999999, longitude: 124.08451719999998 },
      google_place_id: "ChIJV3MW-lhBqjMRYdXbTWLZk-8",
      cost_basis: "Free roadside stop."
    },    {
      time_label: "12:00 PM",
      title: "Loboc River cruise",
      description: "Lunch on a floating restaurant drifting down the emerald Loboc River, with folk music stops along the banks.",
      location_name: "Loboc River",
      estimated_cost: 1000,
      cost_status: "ESTIMATED",
      category: "Food",
      map_query: "Loboc River, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "restaurant",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.7160167, longitude: 124.0496704 },
      google_place_id: "ChIJC81vDcZAqjMRJKlGhRiwXVY",
      cost_basis: "Typical floating-restaurant cruise with buffet lunch per person (estimate — verify with the operator)."
    },    {
      time_label: "2:00 PM",
      title: "Hinagdanan Cave",
      description: "A limestone cave with a sunlit underground lagoon — a quick, atmospheric stop on Panglao.",
      location_name: "Hinagdanan Cave",
      estimated_cost: 75,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Hinagdanan Cave, Panglao, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.6254774, longitude: 123.80094489999998 },
      google_place_id: "ChIJNev-FVJNqjMRpk4oja6EHi4",
      cost_basis: "Typical posted entrance fee per person (estimate — swimming privilege costs extra)."
    },    {
      time_label: "4:00 PM",
      title: "Alona Beach, Panglao",
      description: "Panglao's lively white-sand strip — swim in the afternoon, then choose from a long row of beachfront dinners.",
      location_name: "Alona Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Alona Beach, Panglao, Bohol, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.5485549, longitude: 123.7740322 },
      google_place_id: "ChIJp3TlMp-sqzMR4VhodDXL50g",
      cost_basis: "Free public beach."
    }
  ]
};

export const PH_AREA_SIARGAO: PhDestinationArea = {
  key: "siargao",
  displayName: "Siargao",
  region: "Surigao del Norte",
  tagline: "The surf capital — Cloud 9, hidden lagoons, and a slow island rhythm.",
  seasonNote: "Cloud 9's surf peaks roughly September to November. The island is visitable year-round; rain is more likely roughly November to February. Season timing is an estimate — check surf and weather reports before you go.",
  festivalHook: null,
  planLinks: [{ label: "Plan a Siargao trip", plannerLabel: "Siargao, Philippines" }],
  activities: [
    {
      time_label: "9:00 AM",
      title: "Cloud 9 — surf break & boardwalk",
      description: "The Philippines' most famous wave, watched from the iconic boardwalk tower — lessons run at the gentler inside sections.",
      location_name: "Cloud 9 Surfing Area",
      estimated_cost: 800,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Cloud 9 Surfing Area, General Luna, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 9.8136625, longitude: 126.1651406 },
      google_place_id: "ChIJPaM9Xu0JBDMRy9VmalHFu9I",
      cost_basis: "Typical surf lesson + board rental share per person (estimate — instructors vary; the tower itself is free to visit)."
    },    {
      time_label: "9:30 AM",
      title: "Naked Island",
      description: "A bare white sandbar with nothing on it but sand and sea — the first stop on Siargao's classic tri-island boat day.",
      location_name: "Naked Island",
      estimated_cost: 1700,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Naked Island, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.7348585, longitude: 126.1260153 },
      google_place_id: "ChIJTYaG5CX3AzMR_nUdyoAV7Q8",
      cost_basis: "Reached on the tri-island tour; typical joiner tour price per person covering Naked, Daku, and Guyam (estimate).",
      packageId: "siargao-tri-island",
      packageName: "Siargao tri-island tour",
    },    {
      time_label: "11:00 AM",
      title: "Daku Island",
      description: "The lunch island — palm groves, a small village, and fresh seafood cooked for your boat group.",
      location_name: "Daku Island",
      estimated_cost: 1700,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Daku Island, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.741183699999999, longitude: 126.1640441 },
      google_place_id: "ChIJzQvytZf2AzMRqipRH3w1OUY",
      cost_basis: "Reached on the tri-island tour; typical joiner tour price per person covering Naked, Daku, and Guyam (estimate).",
      packageId: "siargao-tri-island",
      packageName: "Siargao tri-island tour",
    },    {
      time_label: "2:00 PM",
      title: "Guyam Island",
      description: "A tiny teardrop island off General Luna — palm shade, rock pools, and an easy swim to end the boat day.",
      location_name: "Guyam Island",
      estimated_cost: 1700,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Guyam Island, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.7651337, longitude: 126.16794709999999 },
      google_place_id: "ChIJ8YHTAXv2AzMR4ED_7PVLgSo",
      cost_basis: "Reached on the tri-island tour; typical joiner tour price per person covering Naked, Daku, and Guyam (estimate).",
      packageId: "siargao-tri-island",
      packageName: "Siargao tri-island tour",
    },    {
      time_label: "8:30 AM",
      title: "Sugba Lagoon, Del Carmen",
      description: "A vast, calm lagoon in the mangroves — paddleboarding, kayaking, and the famous diving-board jump.",
      location_name: "Sugba Blue Lagoon",
      estimated_cost: 1600,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Sugba Lagoon, Del Carmen, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 240,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 9.9065266, longitude: 125.9003021 },
      google_place_id: "ChIJQZqF8vapBjMRwMOzYwYTtpU",
      cost_basis: "Typical tour per person including boat and board rental share (estimate — verify with the operator)."
    },    {
      time_label: "10:00 AM",
      title: "Magpupungko Rock Pools",
      description: "Natural turquoise pools revealed in the reef at low tide in Pilar — time this one by the tide chart, not the clock.",
      location_name: "Magpupungko Rock Pools, Pilar",
      estimated_cost: 60,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Magpupungko Rock Pools, Pilar, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.8766561, longitude: 126.12075879999999 },
      google_place_id: "ChIJ7_UsNM0IBDMRQZrwXJFk8vc",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate; pools appear only at low tide)."
    },    {
      time_label: "1:00 PM",
      title: "Tayangban Cave Pool",
      description: "Swim through a torch-lit cave into a hidden emerald pool — a guided, slightly adventurous inland stop in Pilar.",
      location_name: "Tayangban Cave Pool",
      estimated_cost: 100,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Tayangban Cave Pool, Pilar, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.861264, longitude: 126.0629932 },
      google_place_id: "ChIJ6zuLQkEGBDMRrP98XgrkqNs",
      cost_basis: "Typical posted entrance fee per person with guide (estimate — verify at the gate)."
    },    {
      time_label: "3:30 PM",
      title: "Maasin River & the bent palm",
      description: "A jungle river with a rope swing under its famous bent coconut palm — small, playful, and very Siargao.",
      location_name: "Maasin River Bridge",
      estimated_cost: 20,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Maasin River, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.8214908, longitude: 126.05620689999999 },
      google_place_id: "ChIJr_qOUOYHBDMRGEGzasHCoYM",
      cost_basis: "Typical posted environmental fee per person (estimate — verify at the gate)."
    },    {
      time_label: "9:00 AM",
      title: "Pacifico Beach",
      description: "The island's wilder north shore — a long, quiet beach with a consistent surf break and a slower pace than General Luna.",
      location_name: "Pacifico Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Pacifico Beach, San Isidro, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 9.9440671, longitude: 126.10319349999999 },
      google_place_id: "ChIJe7HPCgAPBDMRhlJsHlawWeE",
      cost_basis: "Free public beach."
    },    {
      time_label: "11:00 AM",
      title: "Alegria Beach",
      description: "A palm-fringed white beach at Siargao's northern tip — the calm end of an island road trip.",
      location_name: "Alegria Beach",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Alegria Beach, Santa Monica, Siargao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 10.054659, longitude: 126.07104569999998 },
      google_place_id: "ChIJ42hujHEZBDMRAR3jYNT99yA",
      cost_basis: "Free public beach."
    }
  ]
};

export const PH_AREA_BAGUIO: PhDestinationArea = {
  key: "baguio",
  displayName: "Baguio",
  region: "Benguet, Cordillera",
  tagline: "The City of Pines — the cool mountain escape above the lowland heat.",
  seasonNote: "Coolest and driest roughly November to February. The wet months (roughly June to October) bring rain and fog; roads up (Kennon, Marcos, Naguilian) can be slow in bad weather. General pattern only.",
  festivalHook: { name: "Panagbenga Flower Festival", when: "February", note: "Baguio's month of flowers, closing with the famous floral float parade. The city is at its busiest — book early and expect Session Road crowds." },
  planLinks: [{ label: "Plan a Baguio trip", plannerLabel: "Baguio, Philippines" }],
  activities: [
    {
      time_label: "7:00 AM",
      title: "Burnham Park",
      description: "Baguio's central green — row a boat on the lake, rent a bike, and start the day the way locals do.",
      location_name: "Burnham Park",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Burnham Park, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 16.4123795, longitude: 120.59297040000001 },
      google_place_id: "ChIJiYLvmGmhkTMR8rwh5qkzitE",
      cost_basis: "Free public park; boat rentals on the lake are pay-as-you-go."
    },    {
      time_label: "7:30 AM",
      title: "Baguio Cathedral",
      description: "The twin-spired Our Lady of the Atonement Cathedral above Session Road — a city landmark since 1936.",
      location_name: "Baguio Cathedral and Diocesan Shrine of Our Lady of the Atonement",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Baguio Cathedral, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 45,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.412777, longitude: 120.5984802 },
      google_place_id: "ChIJwblPOF2hkTMROOQiH9qxCwg",
      cost_basis: "Free church entry."
    },    {
      time_label: "8:30 AM",
      title: "Mines View Park",
      description: "The classic lookout over the old gold and copper mines of Itogon — and a gauntlet of souvenir stalls worth browsing.",
      location_name: "Mines View Park",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Mines View Park, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4216262, longitude: 120.63005670000001 },
      google_place_id: "ChIJT8QveAOkkTMRsukWY41vhig",
      cost_basis: "Free public viewpoint; souvenir and photo spots are pay-as-you-go."
    },    {
      time_label: "9:30 AM",
      title: "Camp John Hay",
      description: "Pine-forest trails, gardens, and old-American-hill-station calm — Baguio's greenest half-day.",
      location_name: "Camp John Hay",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Camp John Hay, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.3969873, longitude: 120.61136549999999 },
      google_place_id: "ChIJIZaHXBqhkTMR11L41gzuibs",
      cost_basis: "Free to enter and walk; individual attractions inside charge their own fees."
    },    {
      time_label: "11:00 AM",
      title: "The Mansion",
      description: "The presidential summer residence — manicured lawns and the famous gate, a staple Baguio photo stop.",
      location_name: "The Mansion",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "The Mansion, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 45,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4123678, longitude: 120.62147270000001 },
      google_place_id: "ChIJobXs6qymkTMRluHL5rcRpeM",
      cost_basis: "Grounds viewing is free; the museum inside charges a small fee (estimate)."
    },    {
      time_label: "11:45 AM",
      title: "Wright Park",
      description: "Pony rides under the pines in front of The Mansion — a Baguio childhood ritual, still going strong.",
      location_name: "Wright Park",
      estimated_cost: 250,
      cost_status: "ESTIMATED",
      category: "Family",
      map_query: "Wright Park, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.415699699999998, longitude: 120.61722329999998 },
      google_place_id: "ChIJHVAPuaqmkTMRsGjxiLAaDNY",
      cost_basis: "Typical horseback-riding rate per person for a short guided ride (estimate — verify with handlers)."
    },    {
      time_label: "1:00 PM",
      title: "Baguio Botanical Garden",
      description: "Shaded gardens, Igorot village displays, and art installations — a cool, quiet wander.",
      location_name: "Baguio Botanical Garden",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Baguio Botanical Garden, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4150118, longitude: 120.61290640000001 },
      google_place_id: "ChIJJ3IMHFShkTMR0mgoul-AOmc",
      cost_basis: "Free entry (as widely published — verify on the day)."
    },    {
      time_label: "2:30 PM",
      title: "Tam-Awan Village",
      description: "A reconstructed Cordillera village and artists' enclave — traditional huts, galleries, and mountain views.",
      location_name: "Tam-awan Village",
      estimated_cost: 60,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Tam-Awan Village, Baguio City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4296517, longitude: 120.5763849 },
      google_place_id: "ChIJP0aG-tSjkTMRr56IllZArzc",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "3:30 PM",
      title: "BenCab Museum",
      description: "National Artist Benedicto Cabrera's museum in Tuba — Cordillera art and artifacts above a ravine garden and eco-trail.",
      location_name: "BenCab Museum",
      estimated_cost: 200,
      cost_status: "ESTIMATED",
      category: "Museums",
      map_query: "BenCab Museum, Tuba, Benguet, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4107369, longitude: 120.55041289999998 },
      google_place_id: "ChIJR78RMcChkTMRyWGEria6N9c",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "8:00 AM",
      title: "La Trinidad Strawberry Farm",
      description: "Pick your own strawberries in the valley farms of La Trinidad, Baguio's cooler neighbor — go early for the best rows.",
      location_name: "Strawberry Farm, La Trinidad",
      estimated_cost: 600,
      cost_status: "ESTIMATED",
      category: "Food",
      map_query: "Strawberry Farm, La Trinidad, Benguet, Philippines",
      item_type: "activity",
      affiliate_category: "restaurant",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.4575176, longitude: 120.58618489999999 },
      google_place_id: "ChIJDzK8NYqjkTMRICeNyW9FpSw",
      cost_basis: "Typical pick-your-own rate per kilo harvested (estimate — priced by weight; verify current rate)."
    },    {
      time_label: "4:30 PM",
      title: "Lion's Head, Kennon Road",
      description: "The giant carved lion guarding Kennon Road since the 1970s — the traditional 'welcome to Baguio' stop.",
      location_name: "Lion’s Head",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Culture",
      map_query: "Lion's Head, Kennon Road, Baguio, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 30,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 16.367534799999998, longitude: 120.60597329999997 },
      google_place_id: "ChIJYdZEH8WgkTMR7cqKb3gr82A",
      cost_basis: "Free roadside landmark."
    }
  ]
};

export const PH_AREA_DAVAO_SAMAL: PhDestinationArea = {
  key: "davao-samal",
  displayName: "Davao + Samal",
  region: "Davao",
  tagline: "Eagles and durian in the city, quiet island shores ten minutes across the water.",
  seasonNote: "Davao sits largely outside the typhoon belt and is visitable most of the year, with rain showers in any month. Samal beach days depend on tide and boat schedules. General pattern only.",
  festivalHook: { name: "Kadayawan Festival", when: "August", note: "Davao's harvest thanksgiving — street parades, floral floats, and fruit everywhere. The city's biggest week." },
  planLinks: [{ label: "Plan a Davao trip", plannerLabel: "Davao City, Philippines" }],
  activities: [
    {
      time_label: "8:30 AM",
      title: "Philippine Eagle Center",
      description: "The breeding home of the Philippine eagle in Malagos rainforest — the country's flagship conservation visit.",
      location_name: "Philippine Eagle Center",
      estimated_cost: 350,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Philippine Eagle Center, Davao City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "must_do",
      must_do: true,
      coordinates: { latitude: 7.18498, longitude: 125.41528369999999 },
      google_place_id: "ChIJsVlo7aAX-TIRAjBUK3kIOEg",
      cost_basis: "Typical posted entrance fee per person (estimate — includes the Malagos area entry pattern; verify at the gate)."
    },    {
      time_label: "10:30 AM",
      title: "Davao Crocodile Park & Zoo",
      description: "Crocodiles, a zoo, and riverfront attractions north of the city center — an easy family half-day.",
      location_name: "Davao Riverfront Crocodile Park & Zoo",
      estimated_cost: 350,
      cost_status: "ESTIMATED",
      category: "Family",
      map_query: "Davao Crocodile Park, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 150,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.0970749, longitude: 125.599249 },
      google_place_id: "ChIJ0xrnLf1s-TIRG7bBbtynfa4",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "1:00 PM",
      title: "Museo Dabawenyo",
      description: "Davao's city museum — Lumad heritage, colonial history, and the story of the durian capital.",
      location_name: "Museo Dabawenyo",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Museums",
      map_query: "Museo Dabawenyo, Davao City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.0791656, longitude: 125.60464659999998 },
      google_place_id: "ChIJMetRV39t-TIRl7THE0AwKBg",
      cost_basis: "Free admission (as widely published — verify on the day)."
    },    {
      time_label: "9:00 AM",
      title: "Eden Nature Park",
      description: "A cool mountain resort park in Toril at the foot of Mt. Talomo — gardens, trails, and a skycycle over the trees.",
      location_name: "Eden Nature Park & Resort",
      estimated_cost: 350,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Eden Nature Park, Toril, Davao City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 240,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.0292029, longitude: 125.39926849999998 },
      google_place_id: "ChIJJ_Ck33oP-TIRsns78SOkZXo",
      cost_basis: "Typical posted entrance fee per person (estimate — guided shuttle tours inside cost extra)."
    },    {
      time_label: "4:00 PM",
      title: "People's Park Davao",
      description: "A green, sculpture-filled city park famous for its durian dome and evening strollers.",
      location_name: "People’s Park",
      estimated_cost: 0,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "People's Park, Davao City, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.070526399999999, longitude: 125.60846640000001 },
      google_place_id: "ChIJf7hQMHZt-TIRGg4U2az0c6M",
      cost_basis: "Free public park."
    },    {
      time_label: "6:30 PM",
      title: "Roxas Night Market",
      description: "Davao's famous night market — barbecue rows, fresh tuna, and durian for the brave, under tight city order.",
      location_name: "Roxas Night Market",
      estimated_cost: 500,
      cost_status: "ESTIMATED",
      category: "Food",
      map_query: "Roxas Night Market, Davao City, Philippines",
      item_type: "activity",
      affiliate_category: "restaurant",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.071797900000001, longitude: 125.61229180000001 },
      google_place_id: "ChIJ9UTyY5xt-TIRVk5Tw38mvPQ",
      cost_basis: "Estimate for a street-food dinner per person (grilled seafood and durian treats)."
    },    {
      time_label: "9:00 AM",
      title: "Monfort Bat Sanctuary, Samal",
      description: "A Guinness-record colony of over a million fruit bats in caves on Samal Island — conservation you can hear and smell.",
      location_name: "Monfort Bat Sanctuary",
      estimated_cost: 300,
      cost_status: "ESTIMATED",
      category: "Nature",
      map_query: "Monfort Bat Sanctuary, Samal Island, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 60,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.164839299999999, longitude: 125.6922184 },
      google_place_id: "ChIJVfvqFqxp-TIRE8KHvGIEr00",
      cost_basis: "Typical posted entrance fee per person (estimate — verify at the gate)."
    },    {
      time_label: "10:30 AM",
      title: "Giant Clam Sanctuary, Samal",
      description: "Snorkel over hundreds of protected giant clams with community guides in Adecor, Samal.",
      location_name: "Giant Clam (Taklobo) Sanctuary, Adecor",
      estimated_cost: 300,
      cost_status: "ESTIMATED",
      category: "Adventure",
      map_query: "Giant Clam Sanctuary, Samal Island, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.013849, longitude: 125.72052239999998 },
      google_place_id: "ChIJ5aV9PGBw-TIRT9FTIi-awsE",
      cost_basis: "Typical sanctuary tour fee per person (estimate — verify with the community operator)."
    },    {
      time_label: "11:00 AM",
      title: "Vanishing Island, Samal",
      description: "A white sandbar that appears and disappears with the tide off Samal's coast — plan around the tide table.",
      location_name: "Vanishing Island",
      estimated_cost: 200,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Vanishing Island, Samal, Davao, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 90,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 7.1591083, longitude: 125.6821453 },
      google_place_id: "ChIJY8OLSwlp-TIRvidRmFy6H6Q",
      cost_basis: "Typical boat share + environmental fee per person (estimate — the sandbar shows only at low tide)."
    },    {
      time_label: "1:00 PM",
      title: "Kaputian Beach, Samal",
      description: "A local public beach on Samal's west coast — calm water, simple cottages, and Davao City on the horizon.",
      location_name: "Kaputian Beach",
      estimated_cost: 20,
      cost_status: "ESTIMATED",
      category: "Beaches",
      map_query: "Kaputian Beach, Samal Island, Philippines",
      item_type: "activity",
      affiliate_category: "attraction",
      durationMinutes: 120,
      factualStatus: "verified",
      plan_role: "primary",
      must_do: false,
      coordinates: { latitude: 6.9668334, longitude: 125.72597119999999 },
      google_place_id: "ChIJ0Q5QkUV3-TIRhIx3-NuwOV0",
      cost_basis: "Typical posted small entrance fee per person (estimate — verify at the gate)."
    }
  ]
};

export const PHILIPPINES_AREAS: PhDestinationArea[] = [
  PH_AREA_MANILA, PH_AREA_BORACAY, PH_AREA_PALAWAN, PH_AREA_CEBU_BOHOL, PH_AREA_SIARGAO, PH_AREA_BAGUIO, PH_AREA_DAVAO_SAMAL
];

export function philippinesArea(key: string): PhDestinationArea | null {
  return PHILIPPINES_AREAS.find((area) => area.key === key) ?? null;
}

export function philippinesActivityCount(): number {
  return PHILIPPINES_AREAS.reduce((sum, area) => sum + area.activities.length, 0);
}

/** Sample-day rules (PH02/PH05): the old builder sliced the pack list into
 *  fixed triples and sorted by clock label only, which published impossible
 *  days — two stops at the same hour, a 240-minute activity overlapping the
 *  next stop, and same-day jumps between islands. Days are now assigned by
 *  geography first: activities cluster in list order (a new cluster when a
 *  stop is more than SAMPLE_CLUSTER_KM from the cluster's first stop),
 *  clusters chunk into days of at most SAMPLE_MAX_PER_DAY, adjacent
 *  underfull days merge when their anchors are within the cluster radius,
 *  and the day list is reconciled to the requested day count by dropping
 *  the shortest day (ties: earliest) or splitting the longest day
 *  (ties: earliest). Times are then re-timed forward only — a stop that
 *  would overlap the previous stop moves to the previous stop's end plus a
 *  transfer gap sized by the distance (15 min nearby, 45 min across town,
 *  180 min for a long hop) — so a published sample day never overlaps and
 *  never jumps islands without a transfer window. The pack's own labels are
 *  never mutated: re-timing copies each stop. A shared tour package
 *  (packageId) is counted once per day it appears: the first stop keeps
 *  the package price and later same-day stops on the package ride included
 *  (estimated_cost 0 + packageIncluded), so a ₱1,200 Tour A day is ₱1,200,
 *  not ₱3,600. Costs are the pack's per-person estimates, in PHP. */
const SAMPLE_CLUSTER_KM = 40;
const SAMPLE_MAX_PER_DAY = 3;

function sampleCoords(item: PhActivitySeed): { latitude: number; longitude: number } | null {
  const coords = item.coordinates as { latitude?: unknown; longitude?: unknown } | null | undefined;
  if (!coords || typeof coords.latitude !== "number" || typeof coords.longitude !== "number") return null;
  return { latitude: coords.latitude, longitude: coords.longitude };
}

function sampleHaversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const earthKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

function sampleTimeOfDay(label: string): number {
  const match = label.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 24 * 60;
  const hours = (parseInt(match[1], 10) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return hours * 60 + parseInt(match[2], 10);
}

function sampleFormatTimeLabel(minutes: number): string {
  const hours24 = Math.floor(minutes / 60) % 24;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

function sampleTransferGapMinutes(distanceKm: number): number {
  if (distanceKm <= 5) return 15;
  if (distanceKm <= SAMPLE_CLUSTER_KM) return 45;
  return 180;
}

/**
 * Build a sample itinerary for a PH area entirely from this pack,
 * through the app's own itinerary machinery: buildStarterItinerary
 * supplies the plan frame for the payload, the pack's verified
 * activities fill the days, and normalizeItinerary sanitizes the
 * result exactly as it does for generated plans.
 */
export function buildPhilippinesSampleItinerary(areaKey: string, daysCount = 5, startDate = "2026-12-10"): RoamlyItinerary {
  const area = philippinesArea(areaKey);
  if (!area) throw new RangeError(`no Philippines pack area named ${areaKey}`);
  const days = clampTripDays(daysCount);
  const plannerLabel = area.planLinks[0]?.plannerLabel ?? `${area.displayName}, Philippines`;
  // 1. Cluster in list order: a new cluster when a stop is farther than
  // SAMPLE_CLUSTER_KM from the cluster's first stop.
  const clusters: PhActivitySeed[][] = [];
  for (const activity of area.activities) {
    const current = clusters[clusters.length - 1];
    const anchor = current?.[0];
    const anchorCoords = anchor ? sampleCoords(anchor) : null;
    const coords = sampleCoords(activity);
    const distance = anchorCoords && coords ? sampleHaversineKm(anchorCoords, coords) : 0;
    if (!current || distance > SAMPLE_CLUSTER_KM) clusters.push([activity]);
    else current.push(activity);
  }
  // 2. Chunk clusters into days of at most SAMPLE_MAX_PER_DAY, in list order.
  const dayGroups: PhActivitySeed[][] = [];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.length; i += SAMPLE_MAX_PER_DAY) {
      dayGroups.push(cluster.slice(i, i + SAMPLE_MAX_PER_DAY));
    }
  }
  // 3. Merge adjacent underfull days whose anchors are within the cluster
  // radius (combined size stays within SAMPLE_MAX_PER_DAY).
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i + 1 < dayGroups.length; i += 1) {
      const left = dayGroups[i];
      const right = dayGroups[i + 1];
      if (left.length + right.length > SAMPLE_MAX_PER_DAY) continue;
      const leftCoords = sampleCoords(left[0]);
      const rightCoords = sampleCoords(right[0]);
      const distance = leftCoords && rightCoords ? sampleHaversineKm(leftCoords, rightCoords) : 0;
      if (distance > SAMPLE_CLUSTER_KM) continue;
      dayGroups.splice(i, 2, [...left, ...right]);
      merged = true;
      break;
    }
  }
  // 4. Too many days: drop the shortest day (ties: earliest). This drops
  // the fewest stops; the dropped stops stay on the area page.
  while (dayGroups.length > days) {
    let drop = 0;
    for (let i = 1; i < dayGroups.length; i += 1) {
      if (dayGroups[i].length < dayGroups[drop].length) drop = i;
    }
    dayGroups.splice(drop, 1);
  }
  // 5. Too few days: split the longest day into time-sorted halves
  // (ties: earliest) until the day count matches or every day is a single.
  while (dayGroups.length < days) {
    let split = -1;
    for (let i = 0; i < dayGroups.length; i += 1) {
      if (dayGroups[i].length < 2) continue;
      if (split === -1 || dayGroups[i].length > dayGroups[split].length) split = i;
    }
    if (split === -1) break;
    const sorted = [...dayGroups[split]].sort((a, b) => sampleTimeOfDay(a.time_label) - sampleTimeOfDay(b.time_label));
    const mid = Math.ceil(sorted.length / 2);
    dayGroups.splice(split, 1, sorted.slice(0, mid), sorted.slice(mid));
  }
  // 6. Per day: sort by clock label, then re-time forward only (on copies,
  // never the pack's own objects) so no stop overlaps the previous stop,
  // with a transfer gap sized by the hop distance. Then count each shared
  // tour package once per day.
  const chosen: PhActivitySeed[][] = dayGroups.map((items) => {
    const sorted = [...items].sort((a, b) => sampleTimeOfDay(a.time_label) - sampleTimeOfDay(b.time_label));
    const timed: PhActivitySeed[] = [];
    let prevEnd: number | null = null;
    let prevCoords: { latitude: number; longitude: number } | null = null;
    for (const item of sorted) {
      const copy = { ...item };
      const start = sampleTimeOfDay(copy.time_label);
      const duration = copy.durationMinutes ?? 60;
      let assigned = start;
      if (prevEnd !== null) {
        const coords = sampleCoords(copy);
        const distance = prevCoords && coords ? sampleHaversineKm(prevCoords, coords) : 0;
        const earliest = prevEnd + sampleTransferGapMinutes(distance);
        if (assigned < earliest) assigned = earliest;
      }
      if (assigned !== start) copy.time_label = sampleFormatTimeLabel(assigned);
      timed.push(copy);
      prevEnd = assigned + duration;
      prevCoords = sampleCoords(copy);
    }
    const seenPackages = new Set<string>();
    for (const item of timed) {
      if (!item.packageId) continue;
      if (seenPackages.has(item.packageId)) {
        item.estimated_cost = 0;
        item.packageIncluded = true;
      } else {
        seenPackages.add(item.packageId);
      }
    }
    return timed;
  });
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(start.getTime() + (days - 1) * 86400000);
  const payload: TripPlannerPayload = {
    tripType: "single_destination",
    destination: plannerLabel,
    destinationCity: area.displayName,
    destinationCountry: "Philippines",
    startDate,
    endDate: end.toISOString().slice(0, 10),
    daysCount: days,
    travelersCount: 2,
    budgetAmount: null,
    budgetCurrency: PH_PACK_CURRENCY,
    travelStyle: "Balanced",
    interests: ["Culture", "Food", "Nature"],
    pace: "Balanced",
    accommodationPreference: "Mid-range",
    transportationPreference: "Mixed",
    specialNotes: ""
  };
  const starter = buildStarterItinerary(payload);
  const raw = {
    ...starter,
    destination_summary: `${area.displayName} planned from Roamly's verified Philippines pack — every stop below is a real place with map coordinates, and every price is a per-person estimate in pesos. ${area.tagline}`,
    daily_itinerary: starter.daily_itinerary.map((day, index) => {
      const items = chosen[index] ?? [];
      const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
      return {
        ...day,
        date,
        city: plannerLabel,
        title: index === 0 ? `Arrive in ${area.displayName}` : `${area.displayName} — day ${index + 1}`,
        morning: items[0] ? `Start with ${items[0].title}.` : day.morning,
        afternoon: items[1] ? `Then ${items[1].title}.` : day.afternoon,
        evening: items[2] ? `Finish with ${items[2].title}.` : day.evening,
        estimated_cost: items.reduce((sum, item) => sum + (item.estimated_cost ?? 0), 0),
        map_queries: items.map((item) => item.map_query),
        live_timeline: items
      };
    })
  };
  return normalizeItinerary(raw, payload);
}
