const ROAMLY_TRAVEL_INTENTS = [
  { key: "pace", label: "a calmer pace", tag: "CalmTravel" },
  { key: "budget", label: "a realistic budget", tag: "TravelBudget" },
  { key: "arrival", label: "a smoother arrival", tag: "ArrivalPlanning" },
  { key: "packing", label: "a lighter pack", tag: "PackingSmart" },
  { key: "booking", label: "clearer booking details", tag: "BookingDetails" },
  { key: "backup", label: "a useful backup plan", tag: "TravelBackup" },
  { key: "food", label: "room for local food", tag: "TravelFood" },
  { key: "documents", label: "the right travel documents", tag: "TravelDocuments" },
  { key: "transit", label: "less rushed transit", tag: "TransitPlanning" },
  { key: "detour", label: "space for a detour", tag: "TravelDetours" },
  { key: "companions", label: "a plan everyone can follow", tag: "GroupTravel" },
  { key: "confidence", label: "more confidence on the day", tag: "TravelConfidence" }
] as const;

const ROAMLY_TRAVEL_MOMENTS = [
  { key: "before-booking", label: "before booking", tag: "BeforeYouBook" },
  { key: "first-morning", label: "on the first morning", tag: "FirstTravelDay" },
  { key: "between-stops", label: "between stops", tag: "BetweenStops" },
  { key: "arrival-day", label: "on arrival day", tag: "ArrivalDay" },
  { key: "weather-change", label: "when the weather changes", tag: "WeatherReady" },
  { key: "slow-afternoon", label: "during a slower afternoon", tag: "SlowTravel" },
  { key: "travel-home", label: "on the way home", tag: "TravelHome" },
  { key: "group-check", label: "when the group checks in", tag: "TravelTogether" },
  { key: "last-minute", label: "when plans change", tag: "FlexibleTravel" },
  { key: "next-trip", label: "while planning the next trip", tag: "NextTrip" }
] as const;

const ROAMLY_EDITORIAL_ANGLES = [
  { key: "practical-check", label: "a practical check" },
  { key: "small-win", label: "one small planning win" },
  { key: "tradeoff", label: "an honest travel tradeoff" },
  { key: "question", label: "a question worth asking" },
  { key: "checklist", label: "a short checklist" },
  { key: "reset", label: "a calmer reset" },
  { key: "discovery", label: "a discovery prompt" },
  { key: "reminder", label: "a useful reminder" },
  { key: "comparison", label: "a simple comparison" },
  { key: "reflection", label: "a quick reflection" }
] as const;

const ROAMLY_HOOK_FRAMES = [
  // Trial-conversion frames first: the generation index restarts at 0 for every
  // refill batch, so leading frames are the ones that actually ship. Each points
  // the curiosity gap at the plan itself so the caption CTA feels like the answer.
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Build ${intent} into your ${destination} plan ${moment}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `The ${destination} trips that feel effortless share one thing ${moment}: ${intent}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `${destination} ${moment} is easier when ${intent} is already in the itinerary`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Turn ${moment} in ${destination} into ${intent} — start with the itinerary`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Planning for ${intent} can make ${destination} easier ${moment}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `What would you change about ${destination} ${moment} to create ${intent}?`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Save this ${destination} planning prompt for ${moment}: ${intent}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `The ${destination} detail worth checking ${moment} is ${intent}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `A realistic ${destination} plan leaves room for ${intent} ${moment}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Before the ${destination} day gets busy, make space for ${intent} ${moment}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `A better ${destination} itinerary starts with ${intent} ${moment}`,
  ({ destination, intent, moment }: { destination: string; intent: string; moment: string }) =>
    `Travel question: how will ${destination} support ${intent} ${moment}?`
];

export function buildRoamlyContentVariant(index: number, destination = "your next destination") {
  const intent = ROAMLY_TRAVEL_INTENTS[index % ROAMLY_TRAVEL_INTENTS.length];
  const moment = ROAMLY_TRAVEL_MOMENTS[Math.floor(index / ROAMLY_TRAVEL_INTENTS.length) % ROAMLY_TRAVEL_MOMENTS.length];
  const angle = ROAMLY_EDITORIAL_ANGLES[Math.floor(index / (ROAMLY_TRAVEL_INTENTS.length * ROAMLY_TRAVEL_MOMENTS.length)) % ROAMLY_EDITORIAL_ANGLES.length];
  const frameIndex = Math.floor(index / (ROAMLY_TRAVEL_INTENTS.length * ROAMLY_TRAVEL_MOMENTS.length * ROAMLY_EDITORIAL_ANGLES.length)) % ROAMLY_HOOK_FRAMES.length;
  const frame = ROAMLY_HOOK_FRAMES[frameIndex];

  return {
    key: `${angle.key}-${intent.key}-${moment.key}-frame-${frameIndex}`,
    intent,
    moment,
    angle,
    hook: frame({ destination, intent: intent.label, moment: moment.label }),
    body: `Use ${angle.label} to think about ${intent.label} ${moment.label}. Keep the route, timing, budget, and booking details connected so the plan stays useful without promising more certainty than the trip has.`,
    hashtagTerms: [intent.tag, moment.tag]
  };
}
