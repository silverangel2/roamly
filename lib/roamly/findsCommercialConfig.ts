export type FindsWidgetKind = "experiences" | "flights" | "travel" | "cars" | "esim";

export type FindsWidgetConfig = {
  id: string;
  kind: FindsWidgetKind;
  src: string;
  eyebrow: string;
  heading: string;
  description: string;
  minHeight: number;
  placement: "primary" | "secondary";
};

export type FindsPromoConfig = {
  id: string;
  enabled: boolean;
  type: "tracked_link";
  eyebrow: string;
  headline: string;
  description: string;
  href: string;
  placement: "feature" | "secondary";
};

const TRAVELPAYOUTS_WIDGET_ORIGIN = "https://tpwdgt.com";
const TRAVELPAYOUTS_WIDGET_PATH = "/content";

export const findsWidgets = {
  experiences107: {
    id: "travelpayouts-experiences-107",
    kind: "experiences",
    src: "https://tpwdgt.com/content?currency=CAD&trs=549715&shmarker=750294&locale=en&city_id=107&category=3&amount=3&powered_by=true&campaign_id=137&promo_id=4497",
    eyebrow: "Featured experiences",
    heading: "Things worth doing",
    description: "Browse real experiences and local ideas when they fit the trip.",
    minHeight: 260,
    placement: "primary"
  },
  experiences121: {
    id: "travelpayouts-experiences-121",
    kind: "experiences",
    src: "https://tpwdgt.com/content?currency=CAD&trs=549715&shmarker=750294&locale=en&city_id=121&category=3&amount=3&powered_by=true&campaign_id=137&promo_id=4497",
    eyebrow: "More to discover",
    heading: "Make a day of it",
    description: "A second shelf of real experiences to keep exploring.",
    minHeight: 260,
    placement: "primary"
  },
  flights: {
    id: "travelpayouts-flights",
    kind: "flights",
    src: "https://tpwdgt.com/content?currency=usd&trs=549715&shmarker=750294&target_host=www.aviasales.com%2Fsearch&locale=en&limit=6&powered_by=true&primary=%230085FF&promo_id=4044&campaign_id=100",
    eyebrow: "Flights worth checking",
    heading: "A real place to start looking",
    description: "Explore current fare ideas for your next trip.",
    minHeight: 280,
    placement: "primary"
  },
  travel: {
    id: "travelpayouts-travel-search",
    kind: "travel",
    src: "https://tpwdgt.com/content?currency=cad&trs=549715&shmarker=750294&locale=en&powered_by=true&limit=4&primary_color=00AE98&results_background_color=FFFFFF&form_background_color=FFFFFF&promo_id=4563&campaign_id=111",
    eyebrow: "Travel ideas",
    heading: "More ways to get there",
    description: "Keep exploring routes and travel ideas for the journey ahead.",
    minHeight: 250,
    placement: "secondary"
  },
  cars: {
    id: "travelpayouts-rental-cars",
    kind: "cars",
    src: "https://tpwdgt.com/content?trs=549715&shmarker=750294&powered_by=true&locale=en&curr=USD&color=blue&pbi=0&ag=18&ap=34&rid=481&campaign_id=22&promo_id=3507",
    eyebrow: "Need a car?",
    heading: "Keep the journey moving",
    description: "Browse current car options for the road ahead. Prices are shown in USD.",
    minHeight: 300,
    placement: "secondary"
  },
  esim: {
    id: "travelpayouts-esim",
    kind: "esim",
    src: "https://tpwdgt.com/content?trs=549715&shmarker=750294&locale=en&country=Spain&powered_by=true&color_button=%23f2685f&color_focused=%23f2685f&secondary=%23FFFFFF&dark=%2311100f&light=%23FFFFFF&special=%23C4C4C4&border_radius=5&plain=false&no_labels=true&promo_id=8588&campaign_id=541",
    eyebrow: "Stay connected",
    heading: "Connected when you land",
    description: "Stay connected abroad with an eSIM before you land.",
    minHeight: 190,
    placement: "secondary"
  }
} satisfies Record<string, FindsWidgetConfig>;

export const activeFindsPromo: FindsPromoConfig = {
  id: "kkday-current-promo",
  enabled: true,
  type: "tracked_link",
  eyebrow: "A little extra to discover",
  headline: "Find something memorable for the journey",
  description: "Browse the current experience selection from Roamly’s travel partners.",
  href: "https://kkday.tpo.lu/DrPvqlSH",
  placement: "feature"
};

export const findsTravelServices = {
  airportTransfer: {
    eyebrow: "Getting from the airport",
    headline: "Start the trip smoothly",
    description: "Explore airport transfer options through the supplied travel partner.",
    href: "https://intui.tpo.lu/6GQiV5Ai"
  },
  stays: {
    href: "https://booking.stay22.com/roamly/YhpfMFjm2n"
  }
} as const;

export const stay22Config = {
  lmaId: "6ab4484f066caaef31bc282f",
  scriptSrc: "https://scripts.stay22.com/letmeallez.js"
} as const;

export function isTrustedTravelpayoutsWidgetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === TRAVELPAYOUTS_WIDGET_ORIGIN
      && url.pathname === TRAVELPAYOUTS_WIDGET_PATH
      && url.searchParams.get("trs") === "549715"
      && url.searchParams.get("shmarker") === "750294";
  } catch {
    return false;
  }
}
