export type CrossBorderTripInput = {
  origin?: string | null;
  originCountry?: string | null;
  destination?: string | null;
  destinationCountry?: string | null;
  routeText?: string | null;
  originCurrency?: string | null;
  destinationCurrency?: string | null;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

export function normalizeCountry(value?: string | null) {
  const text = clean(value).toLowerCase();
  if (!text) return "";
  if (["ca", "can", "canada"].includes(text)) return "canada";
  if (["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"].includes(text)) return "united states";
  if (["mx", "mexico", "méxico"].includes(text)) return "mexico";
  if (["fr", "france"].includes(text)) return "france";
  return text;
}

export function countryHintFromText(value?: string | null) {
  const text = clean(value).toLowerCase();
  if (/\bsaint john\b|\bmoncton\b|\bfredericton\b|\bhalifax\b|\bmontreal\b|\bmontr[eé]al\b|\btoronto\b|\bottawa\b|\bquebec\b|\bvancouver\b|\bcalgary\b/.test(text)) {
    return "canada";
  }
  if (/\bnew york\b|\bboston\b|\bwashington\b|\bphiladelphia\b|\bchicago\b|\blos angeles\b|\blas vegas\b|\bseattle\b|\bmiami\b/.test(text)) {
    return "united states";
  }
  if (/\bmexico city\b|\bcancun\b|\bcancún\b|\btijuana\b|\bguadalajara\b/.test(text)) return "mexico";
  if (/\bparis\b|\blyon\b|\bnice\b|\bmarseille\b|\bfrance\b/.test(text)) return "france";
  return "";
}

export function currencyForCountry(country?: string | null) {
  const normalized = normalizeCountry(country);
  if (normalized === "canada") return "CAD";
  if (normalized === "united states") return "USD";
  if (normalized === "mexico") return "MXN";
  if (normalized === "france") return "EUR";
  return "";
}

export function detectCrossBorderTrip(input: CrossBorderTripInput) {
  const originCountry = normalizeCountry(input.originCountry) || countryHintFromText(input.origin || input.routeText);
  const destinationCountry = normalizeCountry(input.destinationCountry) || countryHintFromText(input.destination || input.routeText);
  const routeText = clean(input.routeText || `${input.origin || ""} ${input.destination || ""}`).toLowerCase();
  const textCrosses =
    (/canada|canadian|saint john|moncton|fredericton|halifax|montreal|montr[eé]al|toronto|ottawa|quebec/.test(routeText) &&
      /united states|usa|u\.s\.|new york|boston|washington|philadelphia|chicago|los angeles|las vegas/.test(routeText)) ||
    (/canada|united states|usa|u\.s\./.test(routeText) && /france|paris|lyon|nice/.test(routeText)) ||
    (/united states|usa|u\.s\./.test(routeText) && /mexico|méxico|cancun|cancún|tijuana|mexico city/.test(routeText));
  const crossBorder = Boolean(
    (originCountry && destinationCountry && originCountry !== destinationCountry) ||
      textCrosses ||
      (input.originCurrency && input.destinationCurrency && input.originCurrency !== input.destinationCurrency)
  );
  const originCurrency = clean(input.originCurrency).toUpperCase() || currencyForCountry(originCountry);
  const destinationCurrency = clean(input.destinationCurrency).toUpperCase() || currencyForCountry(destinationCountry);

  return {
    cross_border: crossBorder,
    origin_country: originCountry,
    destination_country: destinationCountry,
    origin_currency: originCurrency,
    destination_currency: destinationCurrency,
    currency_change: Boolean(originCurrency && destinationCurrency && originCurrency !== destinationCurrency)
  };
}

export function crossBorderTravelDocumentReminders(driving = false) {
  return [
    "Passport",
    "Visa / ESTA / eTA if applicable",
    driving ? "Driver's license" : "",
    driving ? "Vehicle registration / rental car cross-border permission" : "",
    "Hotel/booking confirmations",
    "Return/onward travel proof if relevant",
    "Check official entry requirements before travel."
  ].filter(Boolean);
}

export function crossBorderTravelNotes(params: { originCurrency?: string | null; destinationCurrency?: string | null; driving?: boolean }) {
  const originCurrency = clean(params.originCurrency).toUpperCase();
  const destinationCurrency = clean(params.destinationCurrency).toUpperCase();
  const currencyNote =
    originCurrency && destinationCurrency && originCurrency !== destinationCurrency
      ? `Your trip crosses from ${originCurrency} to ${destinationCurrency}. Check card foreign transaction fees and carry a backup payment method.`
      : "Check exchange rates, card foreign transaction fees, and backup payment options before departure.";

  return [
    "Check official entry requirements before travel.",
    "Border wait times can change. Allow extra time.",
    currencyNote,
    params.driving ? "Confirm tolls, parking payment methods, vehicle registration, and rental car cross-border permission before driving." : "Confirm baggage, transfer, and payment assumptions before booking.",
    "Review customs rules before crossing. Food, alcohol, tobacco, medication, plants, and large purchases may have restrictions.",
    "Confirm roaming or eSIM/SIM coverage and download offline maps before departure.",
    "Save emergency contacts and the local emergency number before travel."
  ];
}

export function crossBorderBadgeLabels(input: { crossBorder?: boolean; currencyChange?: boolean }) {
  if (!input.crossBorder) return [];
  return [
    "Cross-border trip",
    "Passport check",
    input.currencyChange ? "Currency change" : "",
    "Border time buffer",
    "Roaming reminder",
    "Customs reminder"
  ].filter(Boolean);
}
