import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";

const root = process.cwd();
const campaignId = "roamly-premium-reels-2026-08";
const campaignName = "Roamly Premium 25-Day Reel Campaign";
const width = 1080;
const height = 1920;
const fps = 30;
const startUtcMs = Date.UTC(2026, 7, 4, 13, 30, 0, 0);

const dirs = {
  base: path.join(root, "content/social/roamly-25-day-reel-campaign"),
  sources: path.join(root, "content/social/roamly-25-day-reel-campaign/sources"),
  overlays: path.join(root, "content/social/roamly-25-day-reel-campaign/overlays"),
  assets: path.join(root, "content/social/roamly-25-day-reel-campaign/assets"),
  thumbs: path.join(root, "content/social/roamly-25-day-reel-campaign/thumbnails"),
  validation: path.join(root, "content/social/roamly-25-day-reel-campaign/validation")
};

const motionPresets = [
  { zoom: "1.020+0.00013*on", x: "(iw-iw/zoom)/2+18*sin(on/118)", y: "(ih-ih/zoom)/2-14*cos(on/142)" },
  { zoom: "1.028+0.00011*on", x: "(iw-iw/zoom)/2-14*cos(on/104)", y: "(ih-ih/zoom)/2+18*sin(on/130)" },
  { zoom: "1.016+0.00015*on", x: "(iw-iw/zoom)/2+10*cos(on/135)", y: "(ih-ih/zoom)/2+16*sin(on/115)" },
  { zoom: "1.024+0.00012*on", x: "(iw-iw/zoom)/2-20*sin(on/128)", y: "(ih-ih/zoom)/2-10*cos(on/122)" },
  { zoom: "1.014+0.00016*on", x: "(iw-iw/zoom)/2+14*cos(on/110)", y: "(ih-ih/zoom)/2+12*cos(on/150)" },
  { zoom: "1.030+0.00010*on", x: "(iw-iw/zoom)/2-12*sin(on/96)", y: "(ih-ih/zoom)/2+14*sin(on/118)" },
  { zoom: "1.018+0.00014*on", x: "(iw-iw/zoom)/2+22*cos(on/132)", y: "(ih-ih/zoom)/2-12*sin(on/112)" },
  { zoom: "1.026+0.00012*on", x: "(iw-iw/zoom)/2-10*cos(on/125)", y: "(ih-ih/zoom)/2+20*cos(on/146)" },
  { zoom: "1.012+0.00017*on", x: "(iw-iw/zoom)/2+16*sin(on/144)", y: "(ih-ih/zoom)/2-16*cos(on/134)" }
];

const grades = [
  "eq=contrast=1.075:saturation=1.075:brightness=-0.010,vignette=PI/5.1",
  "eq=contrast=1.065:saturation=1.055:brightness=-0.006,vignette=PI/5.4",
  "eq=contrast=1.090:saturation=1.045:brightness=-0.014,vignette=PI/4.9",
  "eq=contrast=1.070:saturation=1.085:brightness=-0.012,vignette=PI/5.0",
  "eq=contrast=1.080:saturation=1.035:brightness=-0.008,vignette=PI/5.2"
];

const audioProfiles = [
  [146.83, 220.0, 293.66],
  [130.81, 196.0, 261.63],
  [164.81, 246.94, 329.63],
  [174.61, 261.63, 349.23],
  [196.0, 293.66, 392.0],
  [155.56, 233.08, 311.13]
];

const campaigns = [
  {
    dayNumber: 1,
    slug: "santorini-dream-destinations",
    theme: "Dream Destinations",
    destination: "Santorini, Greece",
    hook: "Blue hour belongs to Santorini.",
    caption:
      "Whitewashed mornings, caldera sunsets, and dinner timed before the island glows. Roamly turns the dream trip into a plan that feels composed from the first booking.",
    cta: "Start your Santorini plan in Roamly",
    visualConcept:
      "Caldera arrival, terrace planning detail, and sunset cliffside finale with clean Cycladic light.",
    reelScript:
      "Open on a calm caldera reveal, move into a refined terrace planning detail, then finish with a sunset village path and a confident Roamly CTA.",
    voiceover:
      "Some places do not need more stops. They need better timing. Let Roamly shape Santorini around the light, the meals, and the moments you came for.",
    musicMood: "Luminous Mediterranean piano with airy strings and a soft pulse",
    hashtags: ["Roamly", "SantoriniTravel", "DreamTrip", "GreekIslands", "TravelPlanning"],
    duration: 20,
    shotSources: ["santorini-dream-01.png", "santorini-dream-02.png", "santorini-dream-03.png"],
    shotDurations: [6.4, 6.7, 6.9],
    overlays: [
      { title: "Blue hour belongs here.", subtitle: "Build the trip around the moments that matter." },
      { title: "Sunset is not a stop.", subtitle: "It is the anchor for the whole day." },
      { title: "Dream it. Then time it.", subtitle: "Start Santorini in Roamly." }
    ]
  },
  {
    dayNumber: 2,
    slug: "kyoto-smart-itinerary",
    theme: "Smart Itinerary Planning",
    destination: "Kyoto, Japan",
    hook: "Kyoto rewards the unhurried plan.",
    caption:
      "Temple mornings, garden pauses, and neighborhood dinners belong in a rhythm, not a rush. Roamly sequences Kyoto so each move feels intentional.",
    cta: "Sequence Kyoto with Roamly",
    visualConcept:
      "Quiet temple morning, table-level itinerary craft, and lantern-lit lane for a rhythm-led planning story.",
    reelScript:
      "Begin with a still temple path, cut to a calm planning surface, then close in a lantern lane that shows how a well-paced day lands.",
    voiceover:
      "In Kyoto, the best itinerary leaves space. Roamly balances the temples, the trains, the tea, and the quiet hours in between.",
    musicMood: "Minimal koto texture, warm bass, and slow modern percussion",
    hashtags: ["Roamly", "KyotoTravel", "JapanTrip", "SmartItinerary", "SlowLuxury"],
    duration: 21,
    shotSources: ["kyoto-itinerary-01.png", "kyoto-itinerary-02.png", "kyoto-itinerary-03.png"],
    shotDurations: [6.8, 7.0, 7.2],
    overlays: [
      { title: "Less rushing. More Kyoto.", subtitle: "Let the day breathe before it begins." },
      { title: "Temples. Transit. Dinner.", subtitle: "One rhythm, not a pile of tabs." },
      { title: "Plan the quiet parts too.", subtitle: "Sequence Kyoto with Roamly." }
    ]
  },
  {
    dayNumber: 3,
    slug: "lisbon-budget-travel",
    theme: "Budget Travel",
    destination: "Lisbon, Portugal",
    hook: "Spend less. Feel richer.",
    caption:
      "Lisbon does not need an inflated budget to feel elevated. Roamly helps line up neighborhoods, viewpoints, transit, and meals that deliver more value per hour.",
    cta: "Find Lisbon value in Roamly",
    visualConcept:
      "Tram-side arrival, elevated cafe planning, and golden miradouro payoff built around value without cheap cues.",
    reelScript:
      "Use a cinematic tram moment, show budget-aware choices as a quiet cafe detail, then reveal the sunset viewpoint as the premium result.",
    voiceover:
      "A smart Lisbon trip is not about cutting the joy. It is about choosing the hours, meals, and views that make the budget work harder.",
    musicMood: "Warm guitar pulse with crisp percussion and a coastal afternoon feel",
    hashtags: ["Roamly", "LisbonTravel", "BudgetTravel", "PortugalTrip", "TravelValue"],
    duration: 19,
    shotSources: ["lisbon-budget-01.png", "lisbon-budget-02.png", "lisbon-budget-03.png"],
    shotDurations: [6.2, 6.2, 6.6],
    overlays: [
      { title: "Premium is not always pricey.", subtitle: "Lisbon proves the point." },
      { title: "Choose value by the hour.", subtitle: "Views, transit, meals, neighborhoods." },
      { title: "Spend where it shows.", subtitle: "Find Lisbon value in Roamly." }
    ]
  },
  {
    dayNumber: 4,
    slug: "paris-luxury-travel",
    theme: "Luxury Travel",
    destination: "Paris, France",
    hook: "Luxury is not more. It is easier.",
    caption:
      "Paris feels premium when the hotel, transfers, dinner windows, and slow mornings work in sync. Roamly turns the trip into something calm, polished, and ready.",
    cta: "Upgrade your Paris plan in Roamly",
    visualConcept:
      "Approved showcase style: suite detail, polished transfer planning, and rooftop Eiffel-view finish.",
    reelScript:
      "Open with the Paris luxury reveal, shift into the suite-level planning moment, and close with a rooftop evening that sells ease, not excess.",
    voiceover:
      "Real luxury is fewer loose ends. Roamly brings the hotel, transfers, meals, and pace into one polished Paris plan.",
    musicMood: "Warm cinematic lounge bed with soft piano and brushed percussion",
    hashtags: ["Roamly", "ParisTravel", "LuxuryTravel", "PremiumTravel", "TravelPlanning"],
    duration: 20,
    shotSources: ["paris-luxury-01.png", "paris-luxury-02.png", "paris-luxury-03.png"],
    shotDurations: [6.6, 6.6, 6.8],
    overlays: [
      { title: "Luxury is not more.", subtitle: "It is easier." },
      { title: "Hotels. Transfers. Dinner windows.", subtitle: "One plan that actually flows." },
      { title: "Upgrade the plan.", subtitle: "Roamly makes travel feel effortless." }
    ]
  },
  {
    dayNumber: 5,
    slug: "seoul-solo-travel",
    theme: "Solo Travel",
    destination: "Seoul, South Korea",
    hook: "Solo should never feel underplanned.",
    caption:
      "From first coffee to late-night neighborhoods, Seoul is better when the plan keeps you oriented and open. Roamly helps solo travel feel sharp, flexible, and secure.",
    cta: "Build your solo Seoul route",
    visualConcept:
      "Stylish solo cafe start, market orientation, and night street confidence without lonely or generic framing.",
    reelScript:
      "Show a confident solo morning, move into a route choice in a high-energy district, and close with a composed evening scene.",
    voiceover:
      "Solo travel is not winging it alone. It is knowing where you are headed, when to pivot, and where the day gets interesting.",
    musicMood: "Clean Seoul city-pop groove with soft synths and a refined night pulse",
    hashtags: ["Roamly", "SeoulTravel", "SoloTravel", "KoreaTrip", "TravelConfidence"],
    duration: 20,
    shotSources: ["seoul-solo-01.png", "seoul-solo-02.png", "seoul-solo-03.png"],
    shotDurations: [6.5, 6.7, 6.8],
    overlays: [
      { title: "Solo, not scattered.", subtitle: "A city feels better when the next move is clear." },
      { title: "Keep the plan flexible.", subtitle: "Markets, cafes, neighborhoods, pace." },
      { title: "Travel on your terms.", subtitle: "Build Seoul solo in Roamly." }
    ]
  },
  {
    dayNumber: 6,
    slug: "amalfi-couple-travel",
    theme: "Couple Travel",
    destination: "Amalfi Coast, Italy",
    hook: "Two travelers. One graceful pace.",
    caption:
      "A romantic coast trip needs more than pretty stops. Roamly balances boat timing, cliffside lunches, slow swims, and quiet evenings so the plan feels shared.",
    cta: "Shape an Amalfi trip for two",
    visualConcept:
      "Boat approach, shared lunch planning, and twilight terrace to keep the couple theme specific and cinematic.",
    reelScript:
      "Start on the coast from the water, bring the couple into an intimate planning detail, and end with an evening terrace that feels earned.",
    voiceover:
      "The best couple trips leave room for both people. Roamly builds the timing, the breaks, and the views into one shared rhythm.",
    musicMood: "Elegant Italian coastal strings with soft downtempo percussion",
    hashtags: ["Roamly", "AmalfiCoast", "CoupleTravel", "ItalyTrip", "RomanticTravel"],
    duration: 21,
    shotSources: ["amalfi-couple-01.png", "amalfi-couple-02.png", "amalfi-couple-03.png"],
    shotDurations: [6.8, 7.0, 7.2],
    overlays: [
      { title: "Plan for both of you.", subtitle: "Not just the postcard stops." },
      { title: "Boats, lunches, slow swims.", subtitle: "The magic is in the spacing." },
      { title: "Make the coast feel easy.", subtitle: "Shape Amalfi for two." }
    ]
  },
  {
    dayNumber: 7,
    slug: "costa-rica-family-travel",
    theme: "Family Travel",
    destination: "Costa Rica",
    hook: "Family travel needs softer edges.",
    caption:
      "Wildlife, beach time, drive windows, and downtime can coexist. Roamly helps Costa Rica feel adventurous for the kids and manageable for everyone.",
    cta: "Plan Costa Rica as a family",
    visualConcept:
      "Rainforest wildlife, lodge downtime, and beach sunset built around family energy management.",
    reelScript:
      "Open with rainforest wonder, move into a lodge break that proves pacing matters, and close on the beach with everyone still relaxed.",
    voiceover:
      "A great family trip is not packed tighter. It is paced better. Roamly balances the adventure with the breathing room.",
    musicMood: "Bright organic percussion, soft marimba, and warm family-adventure lift",
    hashtags: ["Roamly", "CostaRicaTravel", "FamilyTravel", "AdventureFamily", "TripPlanning"],
    duration: 20,
    shotSources: ["costa-rica-family-01.png", "costa-rica-family-02.png", "costa-rica-family-03.png"],
    shotDurations: [6.6, 6.6, 6.8],
    overlays: [
      { title: "Adventure needs downtime.", subtitle: "Especially when everyone is coming." },
      { title: "Wildlife, drives, beach hours.", subtitle: "Built around real family energy." },
      { title: "Keep the trip joyful.", subtitle: "Plan Costa Rica as a family." }
    ]
  },
  {
    dayNumber: 8,
    slug: "oaxaca-food-travel",
    theme: "Food Travel",
    destination: "Oaxaca, Mexico",
    hook: "Let the meal lead the map.",
    caption:
      "Oaxaca is a trip you taste. Roamly connects markets, mezcal, mole, and neighborhood walks into a food-first route that still leaves space to wander.",
    cta: "Taste-plan Oaxaca in Roamly",
    visualConcept:
      "Market color, chef-table detail, and dusk street dining designed as a culinary route.",
    reelScript:
      "Open in a vivid market, shift into a crafted plate or mezcal detail, and close with a warm street-dining evening.",
    voiceover:
      "In Oaxaca, the best plan starts with what you want to taste. Roamly builds the route around the markets, the tables, and the walk between them.",
    musicMood: "Refined Latin percussion, soft guitar, and warm evening texture",
    hashtags: ["Roamly", "OaxacaTravel", "FoodTravel", "MexicoTrip", "CulinaryTravel"],
    duration: 19,
    shotSources: ["oaxaca-food-01.png", "oaxaca-food-02.png", "oaxaca-food-03.png"],
    shotDurations: [6.1, 6.4, 6.5],
    overlays: [
      { title: "Start with what you want to taste.", subtitle: "Then build the day around it." },
      { title: "Markets. Mezcal. Mole.", subtitle: "A route with appetite." },
      { title: "Follow the flavor.", subtitle: "Taste-plan Oaxaca in Roamly." }
    ]
  },
  {
    dayNumber: 9,
    slug: "berlin-nightlife",
    theme: "Nightlife",
    destination: "Berlin, Germany",
    hook: "The night needs a smarter plan.",
    caption:
      "Berlin after dark is better with timing, transit, neighborhood flow, and a backup move. Roamly keeps the night polished without making it predictable.",
    cta: "Map your Berlin night",
    visualConcept:
      "Design-forward dinner start, transit between districts, and late-night terrace energy without club cliches.",
    reelScript:
      "Begin with a refined pre-night meal, move through transit and neighborhood choice, then finish in a tasteful late-night scene.",
    voiceover:
      "A good night out is not random. Roamly helps you pace the dinner, the district, the ride, and the plan B.",
    musicMood: "Deep Berlin electronic pulse with clean bass and restrained atmosphere",
    hashtags: ["Roamly", "BerlinTravel", "NightlifeTravel", "GermanyTrip", "CityNights"],
    duration: 20,
    shotSources: ["berlin-nightlife-01.png", "berlin-nightlife-02.png", "berlin-nightlife-03.png"],
    shotDurations: [6.4, 6.8, 6.8],
    overlays: [
      { title: "Do not leave the night to chance.", subtitle: "Berlin deserves better timing." },
      { title: "Dinner, district, ride, backup.", subtitle: "The plan stays loose but useful." },
      { title: "Make the night flow.", subtitle: "Map Berlin after dark." }
    ]
  },
  {
    dayNumber: 10,
    slug: "ljubljana-hidden-gems",
    theme: "Hidden Gems",
    destination: "Ljubljana, Slovenia",
    hook: "Small cities can feel enormous.",
    caption:
      "Ljubljana rewards travelers who look beyond the obvious square. Roamly surfaces riverside corners, quiet viewpoints, and places that feel personally found.",
    cta: "Uncover Ljubljana with Roamly",
    visualConcept:
      "Riverside calm, quiet cafe or gallery detail, and castle-view overlook for an understated hidden-gem arc.",
    reelScript:
      "Open along the river, reveal a tucked-away local detail, then lift into a soft overlook that makes the find feel valuable.",
    voiceover:
      "Hidden gems are not about secrecy. They are about fit. Roamly finds the places that match how you actually want to spend the day.",
    musicMood: "Soft indie cinematic texture with light piano and relaxed city ambience",
    hashtags: ["Roamly", "Ljubljana", "HiddenGems", "SloveniaTravel", "UnderratedCities"],
    duration: 19,
    shotSources: ["ljubljana-hidden-01.png", "ljubljana-hidden-02.png", "ljubljana-hidden-03.png"],
    shotDurations: [6.2, 6.3, 6.5],
    overlays: [
      { title: "Look past the obvious.", subtitle: "The city opens up quickly." },
      { title: "Corners that feel found.", subtitle: "Riverside, galleries, quiet views." },
      { title: "Travel smaller. Notice more.", subtitle: "Uncover Ljubljana." }
    ]
  },
  {
    dayNumber: 11,
    slug: "turks-caicos-beaches",
    theme: "Beaches",
    destination: "Turks and Caicos",
    hook: "A beach day can still be designed.",
    caption:
      "Clear water is the start. Roamly adds the right beach window, boat moment, shade break, and unhurried dinner so the day feels resort-level from end to end.",
    cta: "Design your beach day in Roamly",
    visualConcept:
      "Grace Bay blue hour walk, cabana planning detail, and sandbar boat arrival in luminous water.",
    reelScript:
      "Open with the shoreline mood, cut to a cabana planning beat, then expand into a private sandbar-style water reveal.",
    voiceover:
      "A perfect beach day is not empty time. It is the right light, the right water, the right break, and no scramble at dinner.",
    musicMood: "Elegant tropical downtempo with glassy pads and light percussion",
    hashtags: ["Roamly", "TurksAndCaicos", "BeachTrip", "IslandTravel", "LuxuryBeach"],
    duration: 20,
    shotSources: ["turks-caicos-beach-01.png", "turks-caicos-beach-02.png", "turks-caicos-beach-03.png"],
    shotDurations: [6.5, 6.7, 6.8],
    overlays: [
      { title: "Clear water is only the start.", subtitle: "Design the whole day around it." },
      { title: "Shade, boat, dinner, pace.", subtitle: "Small choices make it feel premium." },
      { title: "Let the day stay light.", subtitle: "Design your beach day." }
    ]
  },
  {
    dayNumber: 12,
    slug: "pacific-coast-highway-road-trip",
    theme: "Road Trips",
    destination: "Pacific Coast Highway, California",
    hook: "The road is better with room.",
    caption:
      "Big Sur, viewpoints, meals, and coastal inns need space between them. Roamly makes a road trip feel cinematic without turning the day into a race.",
    cta: "Route the coast with Roamly",
    visualConcept:
      "Convertible cliff drive, overlook picnic planning, and boutique inn arrival after coastal rain.",
    reelScript:
      "Open on the moving coast road, pause at an overlook for route intent, then end with a cinematic inn arrival.",
    voiceover:
      "A road trip is not the number of stops. It is the space between them. Roamly gives the drive room to become the memory.",
    musicMood: "Wide coastal guitar, soft analog drums, and cinematic sunset lift",
    hashtags: ["Roamly", "PacificCoastHighway", "RoadTrip", "CaliforniaTravel", "BigSur"],
    duration: 21,
    shotSources: ["pch-roadtrip-01.png", "pch-roadtrip-02.png", "pch-roadtrip-03.png"],
    shotDurations: [6.9, 7.0, 7.1],
    overlays: [
      { title: "Do not overstuff the drive.", subtitle: "The coast needs room." },
      { title: "Viewpoints, meals, arrival.", subtitle: "Timed like a film, not a checklist." },
      { title: "Let the route breathe.", subtitle: "Route the coast with Roamly." }
    ]
  },
  {
    dayNumber: 13,
    slug: "quebec-city-weekend-escape",
    theme: "Weekend Escapes",
    destination: "Quebec City, Canada",
    hook: "A weekend can feel far away.",
    caption:
      "Snowy lanes, cafe starts, and golden overlooks can fit inside two days when the plan is tight where it should be and soft where it matters.",
    cta: "Build a Quebec weekend in Roamly",
    visualConcept:
      "Snowy boutique arrival, frosted cafe itinerary detail, and Chateau Frontenac sunset overlook.",
    reelScript:
      "Open with a cozy arrival, move into a cafe planning pause, and close with an elevated winter city reveal.",
    voiceover:
      "A great weekend escape is not about distance. It is about arriving with the right shape already in place.",
    musicMood: "Warm winter piano, soft brushed drums, and cinematic city sparkle",
    hashtags: ["Roamly", "QuebecCity", "WeekendEscape", "CanadaTravel", "WinterTravel"],
    duration: 19,
    shotSources: ["quebec-weekend-01.png", "quebec-weekend-02.png", "quebec-weekend-03.png"],
    shotDurations: [6.1, 6.3, 6.6],
    overlays: [
      { title: "Two days can reset everything.", subtitle: "When the plan is shaped well." },
      { title: "Cafe starts. Snowy lanes.", subtitle: "A weekend with no wasted hours." },
      { title: "Go closer. Feel farther.", subtitle: "Build Quebec in Roamly." }
    ]
  },
  {
    dayNumber: 14,
    slug: "patagonia-adventure-travel",
    theme: "Adventure",
    destination: "Patagonia, Chile",
    hook: "Plan hard. Travel wild.",
    caption:
      "Patagonia is wild enough. Your transfers, layers, weather windows, and recovery time should not be. Roamly helps make the adventure practical before the trail begins.",
    cta: "Prepare Patagonia in Roamly",
    visualConcept:
      "Approved showcase style: mountain trail scale, lodge planning detail, and bridge crossing under dramatic light.",
    reelScript:
      "Open with the wild landscape, ground the plan at the lodge, then return outside for an earned trail moment.",
    voiceover:
      "The trail can stay wild. The logistics should not. Roamly helps shape the weather, gear, transfers, and recovery into the adventure.",
    musicMood: "Expansive cinematic outdoor pulse with deep drums and airy strings",
    hashtags: ["Roamly", "Patagonia", "AdventureTravel", "HikingTrip", "TravelPrep"],
    duration: 22,
    shotSources: ["patagonia-adventure-01.png", "patagonia-adventure-02.png", "patagonia-adventure-03.png"],
    shotDurations: [7.2, 7.4, 7.4],
    overlays: [
      { title: "Plan hard.", subtitle: "Travel wild." },
      { title: "Weather windows matter.", subtitle: "So do transfers, layers, and recovery time." },
      { title: "Make the wild part easier.", subtitle: "Prepare Patagonia with Roamly." }
    ]
  },
  {
    dayNumber: 15,
    slug: "luang-prabang-slow-travel",
    theme: "Slow Travel",
    destination: "Luang Prabang, Laos",
    hook: "Slow is a strategy.",
    caption:
      "Luang Prabang is best when sunrise, river time, temples, and quiet afternoons are protected. Roamly helps slow travel feel deliberate, not underplanned.",
    cta: "Slow-plan Luang Prabang",
    visualConcept:
      "Mekong sunrise walk, guesthouse balcony planning, and sunset long-tail boat reflection.",
    reelScript:
      "Start with a morning riverside walk, pause for a balcony planning scene, then let the river sunset carry the message.",
    voiceover:
      "Slow travel is not doing less by accident. It is protecting the moments that deserve more of you.",
    musicMood: "Soft ambient pads, light hand percussion, and quiet river warmth",
    hashtags: ["Roamly", "LuangPrabang", "SlowTravel", "LaosTravel", "MindfulTravel"],
    duration: 21,
    shotSources: ["luang-prabang-slow-01.png", "luang-prabang-slow-02.png", "luang-prabang-slow-03.png"],
    shotDurations: [6.8, 7.0, 7.2],
    overlays: [
      { title: "Slow is a choice.", subtitle: "Protect the hours that matter." },
      { title: "Sunrise, temples, river time.", subtitle: "A plan can be quiet and precise." },
      { title: "Travel at the right speed.", subtitle: "Slow-plan Luang Prabang." }
    ]
  },
  {
    dayNumber: 16,
    slug: "barcelona-flight-planning",
    theme: "Flights",
    destination: "Barcelona, Spain",
    hook: "The trip starts before takeoff.",
    caption:
      "Better flight timing changes the first day. Roamly helps align arrival windows, transfers, check-in, and energy so Barcelona begins smoothly.",
    cta: "Time your Barcelona arrival",
    visualConcept:
      "Airport lounge flight timing, airport-train arrival, and rooftop Sagrada Familia sunset payoff.",
    reelScript:
      "Open with the flight decision, show the arrival transfer working, and close with the first-day rooftop payoff.",
    voiceover:
      "The cheapest flight is not always the smartest one. Roamly helps pick the arrival that protects your first real day.",
    musicMood: "Modern airport lounge pulse with soft synth, clean percussion, and lift",
    hashtags: ["Roamly", "BarcelonaTravel", "FlightPlanning", "SpainTrip", "ArrivalDay"],
    duration: 20,
    shotSources: ["barcelona-flights-01.png", "barcelona-flights-02.png", "barcelona-flights-03.png"],
    shotDurations: [6.5, 6.7, 6.8],
    overlays: [
      { title: "Arrival time is a travel choice.", subtitle: "Not just a flight detail." },
      { title: "Landing, transfer, check-in.", subtitle: "Protect the first day." },
      { title: "Start smoother.", subtitle: "Time Barcelona in Roamly." }
    ]
  },
  {
    dayNumber: 17,
    slug: "nyc-hotel-selection",
    theme: "Hotels",
    destination: "New York City, USA",
    hook: "The right hotel changes the map.",
    caption:
      "In New York, the hotel is not just a room. It decides your mornings, neighborhoods, rides, and late-night returns. Roamly helps match the stay to the trip.",
    cta: "Choose your New York base",
    visualConcept:
      "Boutique hotel arrival, skyline room comparison, and neighborhood morning exit.",
    reelScript:
      "Open at a polished hotel door, move into room and view evaluation, then prove the choice with an easy neighborhood morning.",
    voiceover:
      "A good hotel is not just beautiful. It sits in the right version of your trip. Roamly helps you choose the base before the city chooses for you.",
    musicMood: "Sophisticated urban lounge with upright bass, light drums, and warm keys",
    hashtags: ["Roamly", "NewYorkTravel", "HotelSelection", "CityBreak", "TravelPlanning"],
    duration: 20,
    shotSources: ["nyc-hotels-01.png", "nyc-hotels-02.png", "nyc-hotels-03.png"],
    shotDurations: [6.6, 6.6, 6.8],
    overlays: [
      { title: "A hotel is a strategy.", subtitle: "Especially in New York." },
      { title: "View, neighborhood, return time.", subtitle: "Choose for the whole trip." },
      { title: "Pick the right base.", subtitle: "Choose New York in Roamly." }
    ]
  },
  {
    dayNumber: 18,
    slug: "amsterdam-transportation",
    theme: "Transportation",
    destination: "Amsterdam, Netherlands",
    hook: "Move through the city, not against it.",
    caption:
      "Amsterdam is smoother when you know when to walk, ride, tram, or float. Roamly keeps transportation choices simple, scenic, and matched to the day.",
    cta: "Navigate Amsterdam with Roamly",
    visualConcept:
      "Tram-bike-walk decision, canal boat option, and morning bike route across canal light.",
    reelScript:
      "Show the transportation decision, reveal a canal option, then finish with a quiet bike route that feels obvious in hindsight.",
    voiceover:
      "The best way across Amsterdam changes by hour. Roamly helps choose the ride, walk, tram, or canal moment that fits.",
    musicMood: "Light kinetic city groove with soft bells and understated movement",
    hashtags: ["Roamly", "AmsterdamTravel", "Transportation", "NetherlandsTrip", "CityTravel"],
    duration: 19,
    shotSources: ["amsterdam-transport-01.png", "amsterdam-transport-02.png", "amsterdam-transport-03.png"],
    shotDurations: [6.1, 6.4, 6.5],
    overlays: [
      { title: "Choose the move.", subtitle: "Walk, ride, tram, or float." },
      { title: "Transport can be part of the trip.", subtitle: "Not just the gap between stops." },
      { title: "Make the city simple.", subtitle: "Navigate Amsterdam." }
    ]
  },
  {
    dayNumber: 19,
    slug: "iceland-packing",
    theme: "Packing",
    destination: "Iceland South Coast",
    hook: "Pack for the weather you want to enjoy.",
    caption:
      "The South Coast can change by the hour. Roamly turns waterfalls, black sand, wind, and lodge time into a packing plan that keeps the day open.",
    cta: "Pack Iceland smarter",
    visualConcept:
      "Lodge gear layout, waterfall mist field test, and black-sand shell adjustment.",
    reelScript:
      "Begin with premium gear laid out against the landscape, move into the misty waterfall proof point, and end at black sand in weather-ready confidence.",
    voiceover:
      "Packing is part of the itinerary. In Iceland, the right layer can decide whether a weather shift becomes a problem or the best part of the day.",
    musicMood: "Cinematic Nordic ambient bed with low drums and cold-air texture",
    hashtags: ["Roamly", "IcelandTravel", "PackingTips", "SouthCoastIceland", "AdventurePrep"],
    duration: 20,
    shotSources: ["iceland-packing-01.png", "iceland-packing-02.png", "iceland-packing-03.png"],
    shotDurations: [6.6, 6.6, 6.8],
    overlays: [
      { title: "The forecast is part of the plan.", subtitle: "Pack for the day you want." },
      { title: "Mist, wind, black sand.", subtitle: "Layers decide the mood." },
      { title: "Stay ready for the coast.", subtitle: "Pack Iceland smarter." }
    ]
  },
  {
    dayNumber: 20,
    slug: "london-live-companion",
    theme: "Live Travel Companion",
    destination: "London, UK",
    hook: "When the day changes, the plan should too.",
    caption:
      "Rain, queues, closures, and late discoveries are normal in a real city day. Roamly helps the plan adapt in the moment without losing the thread.",
    cta: "Let London adapt in Roamly",
    visualConcept:
      "Rainy awning check-in, logo-free courtyard reroute, and Thames evening after a successful pivot.",
    reelScript:
      "Open with rain changing the day, show a real-time reroute into a better nearby option, then close on the river once the day is back on track.",
    voiceover:
      "Travel plans should not break when the day changes. Roamly helps you reroute, recover, and keep moving with confidence.",
    musicMood: "Rainy London electronic texture with soft piano and steady pulse",
    hashtags: ["Roamly", "LondonTravel", "TravelCompanion", "RealTimeTravel", "CityGuide"],
    duration: 20,
    shotSources: ["london-live-companion-01.png", "london-live-companion-02.png", "london-live-companion-03.png"],
    shotDurations: [6.4, 6.8, 6.8],
    overlays: [
      { title: "The day changed.", subtitle: "The plan can change with it." },
      { title: "Rain, queues, new openings.", subtitle: "Roamly keeps the thread." },
      { title: "Recover the day in real time.", subtitle: "Let London adapt." }
    ]
  },
  {
    dayNumber: 21,
    slug: "rome-travel-mistakes",
    theme: "Travel Mistakes",
    destination: "Rome, Italy",
    hook: "Avoid the trip that fights you.",
    caption:
      "Rome is magic when timing works and tiring when it does not. Roamly helps avoid the classic mistakes: harsh hours, crowded routes, and dinner left too late.",
    cta: "Refine your Rome plan",
    visualConcept:
      "Midday Colosseum friction, quiet early piazza correction, and on-time Trastevere dinner payoff.",
    reelScript:
      "Show the costly timing mistake, contrast it with a calm morning alternative, then finish with dinner arriving exactly when it should.",
    voiceover:
      "Most travel mistakes are timing mistakes. Roamly helps Rome feel lighter by moving the right moments to the right hours.",
    musicMood: "Elegant Italian cinematic pulse with warm strings and grounded drums",
    hashtags: ["Roamly", "RomeTravel", "TravelMistakes", "ItalyTravel", "BetterPlanning"],
    duration: 19,
    shotSources: ["rome-mistakes-01.png", "rome-mistakes-02.png", "rome-mistakes-03.png"],
    shotDurations: [6.2, 6.3, 6.5],
    overlays: [
      { title: "Most mistakes are timing mistakes.", subtitle: "Rome makes that obvious." },
      { title: "Shift the hard hours.", subtitle: "Protect the magic." },
      { title: "Make Rome feel lighter.", subtitle: "Refine the plan." }
    ]
  },
  {
    dayNumber: 22,
    slug: "marrakech-personalized-travel",
    theme: "Personalized Travel",
    destination: "Marrakech, Morocco",
    hook: "Recommendations should feel like you.",
    caption:
      "Marrakech can be medina energy, quiet riads, craft, desert dinners, or all of it in balance. Roamly shapes suggestions around the traveler, not the average list.",
    cta: "Personalize Marrakech in Roamly",
    visualConcept:
      "Riad entry from the medina, artisan craft conversation, and Agafay desert dinner recommendation.",
    reelScript:
      "Open with a personalized escape from the medina into a riad, move into a craft recommendation, and close on a private desert dinner.",
    voiceover:
      "The best recommendation is not the most popular one. It is the one that matches your pace, your taste, and your day.",
    musicMood: "Refined oud, soft hand percussion, and warm desert evening ambience",
    hashtags: ["Roamly", "MarrakechTravel", "PersonalizedTravel", "MoroccoTrip", "CuratedTravel"],
    duration: 21,
    shotSources: ["marrakech-personalized-01.png", "marrakech-personalized-02.png", "marrakech-personalized-03.png"],
    shotDurations: [6.8, 7.0, 7.2],
    overlays: [
      { title: "Not the average list.", subtitle: "The right recommendation for your pace." },
      { title: "Craft, calm, desert, dinner.", subtitle: "Your version of Marrakech." },
      { title: "Make it personal.", subtitle: "Personalize Marrakech in Roamly." }
    ]
  },
  {
    dayNumber: 23,
    slug: "vancouver-travel-confidence",
    theme: "Travel Confidence",
    destination: "Vancouver, Canada",
    hook: "Confidence is knowing the next move.",
    caption:
      "Vancouver can shift from ferry to forest to skyline in one day. Roamly keeps the transitions clear, so the trip feels expansive without feeling uncertain.",
    cta: "Travel Vancouver with confidence",
    visualConcept:
      "Waterfront ferry orientation, North Shore forest bridge, and skyline terrace reflection.",
    reelScript:
      "Open with an arrival and route confirmation, expand into a confident nature move, then close with a composed skyline pause.",
    voiceover:
      "Travel confidence is not having every minute locked. It is knowing the next move well enough to enjoy the one you are in.",
    musicMood: "Clean Pacific Northwest cinematic bed with soft drums and open-air synths",
    hashtags: ["Roamly", "VancouverTravel", "TravelConfidence", "CanadaTrip", "CityNature"],
    duration: 20,
    shotSources: ["vancouver-confidence-01.png", "vancouver-confidence-02.png", "vancouver-confidence-03.png"],
    shotDurations: [6.5, 6.7, 6.8],
    overlays: [
      { title: "Know the next move.", subtitle: "Then enjoy this one." },
      { title: "Ferry, forest, skyline.", subtitle: "Big days need clear transitions." },
      { title: "Move with confidence.", subtitle: "Travel Vancouver in Roamly." }
    ]
  },
  {
    dayNumber: 24,
    slug: "bali-post-trip-memories",
    theme: "Post-Trip Memories",
    destination: "Bali, Indonesia",
    hook: "The trip should last longer than the flight home.",
    caption:
      "The best journeys deserve a beautiful afterlife. Roamly helps turn Bali moments, routes, photos, and notes into memories worth returning to.",
    cta: "Keep your Bali story in Roamly",
    visualConcept:
      "Villa photo review, rice-terrace memory replay, and warm desk archive with printed trip images.",
    reelScript:
      "Open with photo review in the place itself, relive a golden terrace walk, then close at home with a curated memory archive.",
    voiceover:
      "A trip is not finished when you land. Roamly keeps the routes, notes, and moments together so the memory stays easy to return to.",
    musicMood: "Dreamy tropical piano, soft pads, and light nostalgic percussion",
    hashtags: ["Roamly", "BaliTravel", "TravelMemories", "PostTrip", "TravelStory"],
    duration: 20,
    shotSources: ["bali-memories-01.png", "bali-memories-02.png", "bali-memories-03.png"],
    shotDurations: [6.6, 6.6, 6.8],
    overlays: [
      { title: "Bring the trip home well.", subtitle: "Moments deserve a place to live." },
      { title: "Routes, notes, photos.", subtitle: "The story stays together." },
      { title: "Return to it anytime.", subtitle: "Keep Bali in Roamly." }
    ]
  },
  {
    dayNumber: 25,
    slug: "copenhagen-design-reset",
    theme: "Design-Led City Reset",
    destination: "Copenhagen, Denmark",
    hook: "Pick a city. Then pick a pace.",
    caption:
      "Copenhagen rewards travelers who balance design shops, bakeries, bikes, transit, and one slow waterfront hour. Roamly shapes the city break so it feels curated, not crowded.",
    cta: "Shape Copenhagen in Roamly",
    visualConcept:
      "Approved showcase style: design-city street, bike-transit motion, and clean waterfront close.",
    reelScript:
      "Open with the city-break promise, move through bike and transit choices, then end at the waterfront with the pace resolved.",
    voiceover:
      "A city break can be designed around pace. Roamly helps Copenhagen feel curated without squeezing out the quiet parts.",
    musicMood: "Clean Nordic city-pop texture with airy synths and light percussion",
    hashtags: ["Roamly", "Copenhagen", "CityBreak", "ScandinavianTravel", "DesignTravel"],
    duration: 19,
    shotSources: ["copenhagen-design-reset-01.png", "copenhagen-design-reset-02.png", "copenhagen-design-reset-03.png"],
    shotDurations: [6.2, 6.3, 6.5],
    overlays: [
      { title: "Pick a city.", subtitle: "Then pick a pace." },
      { title: "Bakeries. Bikes. Canals.", subtitle: "A city break should breathe." },
      { title: "Curated, not crowded.", subtitle: "Shape Copenhagen in Roamly." }
    ]
  }
];

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function dateForDay(dayNumber) {
  const date = new Date(startUtcMs + (dayNumber - 1) * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function localDateForDay(dayNumber) {
  const date = new Date(Date.UTC(2026, 7, 4 + dayNumber - 1, 0, 0, 0, 0));
  return `${date.toISOString().slice(0, 10)} 10:30 ADT`;
}

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(value, maxChars, maxLines) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function tspans(lines, x, y, size, gap, color, weight = 850) {
  return lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</tspan>`
    )
    .join("");
}

function overlaySvg(reel, card, index) {
  const titleLines = wrap(card.title, 18, 3);
  const subtitleLines = wrap(card.subtitle, 30, 2);
  const destination = `${reel.destination.toUpperCase()} / ${reel.theme.toUpperCase()}`;
  const progress = Math.round(936 * ((index + 1) / reel.overlays.length));
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.17"/>
          <stop offset="0.46" stop-color="#000000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.61"/>
        </linearGradient>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#000000" flood-opacity="0.34"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#shade)"/>
      <rect x="68" y="72" width="210" height="58" rx="29" fill="#ffffff" fill-opacity="0.92"/>
      <text x="96" y="110" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" letter-spacing="4" fill="#102027">ROAMLY</text>
      <text x="72" y="158" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800" letter-spacing="3" fill="#ffffff" fill-opacity="0.86">${xml(destination)}</text>
      <g filter="url(#softShadow)">
        <text font-family="Arial, Helvetica, sans-serif">${tspans(titleLines, 72, 1390, 70, 78, "#ffffff", 900)}</text>
        <text font-family="Arial, Helvetica, sans-serif">${tspans(subtitleLines, 76, 1628, 31, 45, "#f3f7f5", 760)}</text>
      </g>
      <rect x="72" y="1774" width="936" height="5" rx="2.5" fill="#ffffff" fill-opacity="0.36"/>
      <rect x="72" y="1774" width="${Math.max(120, progress)}" height="5" rx="2.5" fill="#ffffff"/>
    </svg>
  `);
}

async function makeOverlay(reel, card, index) {
  const file = path.join(dirs.overlays, `${String(reel.dayNumber).padStart(2, "0")}-${reel.slug}-${index + 1}.png`);
  await sharp(overlaySvg(reel, card, index)).png().toFile(file);
  return file;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

function makeShots(reel) {
  const motionOffset = (reel.dayNumber - 1) % motionPresets.length;
  return reel.shotSources.map((source, index) => ({
    source,
    duration: reel.shotDurations[index],
    ...motionPresets[(motionOffset + index) % motionPresets.length]
  }));
}

async function buildReel(reel) {
  const shots = makeShots(reel);
  for (const shot of shots) await stat(path.join(dirs.sources, shot.source));
  const outputName = `roamly-2026-08-day-${String(reel.dayNumber).padStart(2, "0")}-${reel.slug}.mp4`;
  const thumbName = `roamly-2026-08-day-${String(reel.dayNumber).padStart(2, "0")}-${reel.slug}.jpg`;
  const output = path.join(dirs.assets, outputName);
  const thumb = path.join(dirs.thumbs, thumbName);
  const overlays = [];
  for (let i = 0; i < reel.overlays.length; i += 1) overlays.push(await makeOverlay(reel, reel.overlays[i], i));

  const grade = grades[(reel.dayNumber - 1) % grades.length];
  const shotFilters = shots.map((shot, index) => {
    const frames = Math.round(shot.duration * fps);
    const overlayInput = shots.length + index;
    return `[${index}:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='${shot.zoom}':x='${shot.x}':y='${shot.y}':d=${frames}:s=${width}x${height}:fps=${fps},${grade},format=rgba[base${index}];[base${index}][${overlayInput}:v]overlay=0:0,trim=duration=${shot.duration},setpts=PTS-STARTPTS[shot${index}]`;
  });
  const filter = [
    ...shotFilters,
    `${shots.map((_, index) => `[shot${index}]`).join("")}concat=n=${shots.length}:v=1:a=0[vout]`
  ].join(";");

  const [a, b, c] = audioProfiles[(reel.dayNumber - 1) % audioProfiles.length];
  const audio = `aevalsrc='0.018*sin(2*PI*${a}*t)+0.014*sin(2*PI*${b}*t)+0.010*sin(2*PI*${c}*t)':s=44100:d=${reel.duration}`;
  const args = [
    "-y",
    ...shots.flatMap((shot) => ["-loop", "1", "-i", path.join(dirs.sources, shot.source)]),
    ...overlays.flatMap((file) => ["-i", file]),
    "-f",
    "lavfi",
    "-i",
    audio,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    `${shots.length + overlays.length}:a`,
    "-t",
    String(reel.duration),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-af",
    `volume=0.42,afade=t=in:st=0:d=1.0,afade=t=out:st=${Math.max(0, reel.duration - 1.4)}:d=1.4`,
    "-movflags",
    "+faststart",
    output
  ];
  await run(ffmpegInstaller.path, args);
  await run(ffmpegInstaller.path, ["-y", "-ss", "00:00:04.000", "-i", output, "-vframes", "1", "-q:v", "2", thumb]);
  const info = await stat(output);
  return {
    ...reel,
    shots,
    output,
    thumb,
    outputName,
    thumbName,
    byteSize: info.size,
    sha256: hash(await sharp(thumb).raw().toBuffer()).slice(0, 16)
  };
}

function requireUnique(name, values) {
  const seen = new Set();
  const duplicates = [];
  for (const value of values) {
    if (seen.has(value)) duplicates.push(value);
    seen.add(value);
  }
  if (duplicates.length) throw new Error(`${name} has duplicates: ${duplicates.join(", ")}`);
}

function validateCampaign() {
  if (campaigns.length !== 25) throw new Error(`Expected 25 campaign posts, got ${campaigns.length}`);
  requireUnique("destinations", campaigns.map((reel) => reel.destination));
  requireUnique("hooks", campaigns.map((reel) => reel.hook));
  requireUnique("captions", campaigns.map((reel) => reel.caption));
  requireUnique("ctas", campaigns.map((reel) => reel.cta));
  requireUnique("visual concepts", campaigns.map((reel) => reel.visualConcept));
  requireUnique("storyboards", campaigns.map((reel) => reel.reelScript));
  requireUnique("voiceovers", campaigns.map((reel) => reel.voiceover));
  requireUnique("source files", campaigns.flatMap((reel) => reel.shotSources));
  for (let index = 1; index < campaigns.length; index += 1) {
    if (campaigns[index - 1].destination === campaigns[index].destination) {
      throw new Error(`Repeated consecutive destination at day ${campaigns[index].dayNumber}`);
    }
    if (campaigns[index - 1].theme === campaigns[index].theme) {
      throw new Error(`Repeated consecutive theme at day ${campaigns[index].dayNumber}`);
    }
  }
}

async function makeContactSheet(built) {
  const cellWidth = 270;
  const cellHeight = 480;
  const cols = 5;
  const rows = 5;
  const labelHeight = 56;
  const canvas = sharp({
    create: {
      width: cols * cellWidth,
      height: rows * (cellHeight + labelHeight),
      channels: 4,
      background: "#101820"
    }
  });
  const composites = [];
  for (const reel of built) {
    const index = reel.dayNumber - 1;
    const x = (index % cols) * cellWidth;
    const y = Math.floor(index / cols) * (cellHeight + labelHeight);
    const image = await sharp(reel.thumb).resize(cellWidth, cellHeight, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
    const label = Buffer.from(`
      <svg width="${cellWidth}" height="${labelHeight}" viewBox="0 0 ${cellWidth} ${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${cellWidth}" height="${labelHeight}" fill="#101820"/>
        <text x="14" y="22" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#ffffff">Day ${reel.dayNumber}: ${xml(reel.destination.split(",")[0])}</text>
        <text x="14" y="44" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="#cfd8dc">${xml(reel.theme)}</text>
      </svg>
    `);
    composites.push({ input: image, left: x, top: y });
    composites.push({ input: label, left: x, top: y + cellHeight });
  }
  const contactSheet = path.join(dirs.thumbs, "roamly-25-day-campaign-contact-sheet.jpg");
  await canvas.composite(composites).jpeg({ quality: 90 }).toFile(contactSheet);
  return contactSheet;
}

function publicObjectPath(reel) {
  return `social/videos/roamly/${campaignId}/day-${String(reel.dayNumber).padStart(2, "0")}-${reel.slug}.mp4`;
}

function planForReel(reel) {
  const assetPath = path.relative(root, reel.output);
  const thumbnailPath = path.relative(root, reel.thumb);
  return {
    dayNumber: reel.dayNumber,
    theme: reel.theme,
    destination: reel.destination,
    hook: reel.hook,
    caption: reel.caption,
    cta: reel.cta,
    visualConcept: reel.visualConcept,
    reelScript: reel.reelScript,
    storyboard: reel.overlays.map((overlay, index) => ({
      shot: index + 1,
      source: reel.shots[index].source,
      durationSeconds: reel.shots[index].duration,
      onScreenText: `${overlay.title} ${overlay.subtitle}`,
      action: reel.reelScript
    })),
    durationSeconds: reel.duration,
    recommendedReelDuration: `${reel.duration} seconds`,
    onScreenText: reel.overlays.map((overlay) => `${overlay.title} ${overlay.subtitle}`),
    voiceover: reel.voiceover,
    musicDirection: reel.musicMood,
    hashtags: reel.hashtags.map((tag) => `#${tag}`).join(" "),
    captionHashtags: reel.hashtags.map((tag) => `#${tag}`),
    reelAsset: assetPath,
    reelAssetFilename: reel.outputName,
    reelThumbnail: thumbnailPath,
    sourcePlates: reel.shots.map((shot) => path.relative(root, path.join(dirs.sources, shot.source))),
    publicObjectPath: publicObjectPath(reel),
    scheduledFor: dateForDay(reel.dayNumber),
    scheduledLocal: localDateForDay(reel.dayNumber),
    status: "ready_for_queue",
    publishingState: "not_published"
  };
}

async function main() {
  validateCampaign();
  await Promise.all(Object.values(dirs).map((dir) => mkdir(dir, { recursive: true })));
  await rm(dirs.overlays, { recursive: true, force: true });
  await mkdir(dirs.overlays, { recursive: true });

  const built = [];
  for (const reel of campaigns) {
    process.stdout.write(`Building day ${reel.dayNumber}: ${reel.destination}... `);
    const result = await buildReel(reel);
    built.push(result);
    process.stdout.write("done\n");
  }

  const contactSheet = await makeContactSheet(built);
  const plan = {
    campaignId,
    campaignName,
    brand: "Roamly",
    platforms: ["facebook_reels", "instagram_reels"],
    format: {
      aspectRatio: "9:16",
      width,
      height,
      fps
    },
    startDateLocal: "2026-08-04 10:30 ADT",
    endDateLocal: "2026-08-28 10:30 ADT",
    scheduleTimezone: "America/Moncton",
    publicationInstruction: "Do not publish until final queue approval.",
    generationStyle:
      "Premium three-shot cinematic travel Reel with realistic source plates, subtle camera movement, restrained Roamly overlay branding, and no slideshow-only treatment.",
    counts: {
      posts: built.length,
      reelAssets: built.length,
      sourcePlates: built.flatMap((reel) => reel.shots).length
    },
    contactSheet: path.relative(root, contactSheet),
    posts: built.map(planForReel),
    validation: {
      uniqueDestinations: new Set(built.map((reel) => reel.destination)).size,
      uniqueHooks: new Set(built.map((reel) => reel.hook)).size,
      uniqueCaptions: new Set(built.map((reel) => reel.caption)).size,
      uniqueCtas: new Set(built.map((reel) => reel.cta)).size,
      uniqueVisualConcepts: new Set(built.map((reel) => reel.visualConcept)).size,
      verticalNineBySixteen: true,
      queueDatesConsecutive: true,
      failedGenerations: 0,
      failedUploads: null
    }
  };

  const planPath = path.join(dirs.base, "roamly-25-day-reel-campaign-2026-08-04.json");
  const validationPath = path.join(dirs.validation, "build-validation.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(
    validationPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        planPath: path.relative(root, planPath),
        contactSheet: path.relative(root, contactSheet),
        assets: built.map((reel) => ({
          dayNumber: reel.dayNumber,
          destination: reel.destination,
          file: path.relative(root, reel.output),
          thumbnail: path.relative(root, reel.thumb),
          bytes: reel.byteSize,
          status: "generated"
        }))
      },
      null,
      2
    )}\n`
  );

  console.log(
    JSON.stringify(
      {
        campaignId,
        generatedAt: new Date().toISOString(),
        count: built.length,
        planPath: path.relative(root, planPath),
        validationPath: path.relative(root, validationPath),
        contactSheet: path.relative(root, contactSheet),
        firstThreeAssets: built.slice(0, 3).map((reel) => path.relative(root, reel.output))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
