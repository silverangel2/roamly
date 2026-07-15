import cityData from "@/lib/roamly/data/geonames-cities15000.json";

type CityTuple = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  number
];

type CityRecord = {
  name: string;
  asciiName: string;
  countryCode: string;
  countryName: string;
  admin1Code: string;
  admin1Name: string;
  admin1AsciiName: string;
  admin1LocalCode: string;
  population: number;
  featureCode: string;
  latitude: number;
  longitude: number;
};

export type ResolvedPlace = CityRecord & {
  label: string;
  searchLabel: string;
  travelCode: string | null;
};

type PlaceAlias = {
  name: string;
  countryCode: string;
  regionCode?: string;
  travelCode?: string;
  displayName?: string;
};

const cityTuples = (cityData as unknown as { cities: CityTuple[] }).cities;

const placeAliases: Record<string, PlaceAlias> = {
  NYC: { name: "New York City", countryCode: "US", regionCode: "NY", travelCode: "NYC" },
  "NEW YORK": { name: "New York City", countryCode: "US", regionCode: "NY", travelCode: "NYC" },
  "NEW YORK CITY": { name: "New York City", countryCode: "US", regionCode: "NY", travelCode: "NYC" },
  YMQ: { name: "Montreal", countryCode: "CA", regionCode: "10", travelCode: "YMQ", displayName: "Montreal" },
  MONTREAL: { name: "Montreal", countryCode: "CA", regionCode: "10", travelCode: "YMQ", displayName: "Montreal" },
  YTO: { name: "Toronto", countryCode: "CA", regionCode: "08", travelCode: "YTO" },
  TORONTO: { name: "Toronto", countryCode: "CA", regionCode: "08", travelCode: "YTO" },
  PAR: { name: "Paris", countryCode: "FR", travelCode: "PAR" },
  PARIS: { name: "Paris", countryCode: "FR", travelCode: "PAR" },
  LON: { name: "London", countryCode: "GB", travelCode: "LON" },
  LONDON: { name: "London", countryCode: "GB", travelCode: "LON" }
};

const countryAliases: Record<string, string> = {
  CA: "CA",
  CAN: "CA",
  CANADA: "CA",
  US: "US",
  USA: "US",
  "U S A": "US",
  AMERICA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  GB: "GB",
  UK: "GB",
  "U K": "GB",
  BRITAIN: "GB",
  "GREAT BRITAIN": "GB",
  "UNITED KINGDOM": "GB",
  FR: "FR",
  FRA: "FR",
  FRANCE: "FR"
};

let cityRecords: CityRecord[] | null = null;
let nameIndex: Map<string, CityRecord[]> | null = null;
let countryNameIndex: Map<string, string> | null = null;

export function normalizePlaceText(value?: string | null) {
  return (value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\bST\.?\b/g, "SAINT")
    .replace(/\bSTE\.?\b/g, "SAINTE")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function records() {
  if (!cityRecords) {
    cityRecords = cityTuples.map((row) => ({
      name: row[0],
      asciiName: row[1],
      countryCode: row[2],
      countryName: row[3],
      admin1Code: row[4],
      admin1Name: row[5],
      admin1AsciiName: row[6],
      admin1LocalCode: row[7],
      population: row[8],
      featureCode: row[9],
      latitude: row[10],
      longitude: row[11]
    }));
  }

  return cityRecords;
}

function addName(index: Map<string, CityRecord[]>, key: string, city: CityRecord) {
  const normalized = normalizePlaceText(key);
  if (!normalized) return;
  const list = index.get(normalized);
  if (list) list.push(city);
  else index.set(normalized, [city]);
}

function names() {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const city of records()) {
      addName(nameIndex, city.name, city);
      addName(nameIndex, city.asciiName, city);
    }
  }

  return nameIndex;
}

function countries() {
  if (!countryNameIndex) {
    countryNameIndex = new Map();
    for (const city of records()) {
      countryNameIndex.set(city.countryCode, city.countryCode);
      countryNameIndex.set(normalizePlaceText(city.countryName), city.countryCode);
    }
    for (const [alias, code] of Object.entries(countryAliases)) {
      countryNameIndex.set(normalizePlaceText(alias), code);
    }
  }

  return countryNameIndex;
}

function splitInput(value?: string | null) {
  const parts = (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    main: parts[0] || "",
    hints: parts.slice(1)
  };
}

function countryHintCodes(hints: string[]) {
  const index = countries();
  return new Set(
    hints
      .map((hint) => index.get(normalizePlaceText(hint)))
      .filter((code): code is string => Boolean(code))
  );
}

function regionHintMatches(city: CityRecord, hints: string[]) {
  if (!hints.length) return false;
  const values = [
    city.admin1Code,
    city.admin1Name,
    city.admin1AsciiName,
    city.admin1LocalCode
  ].map(normalizePlaceText);
  return hints.some((hint) => {
    const normalized = normalizePlaceText(hint);
    return normalized && values.includes(normalized);
  });
}

function hasRegionHint(hints: string[]) {
  return hints.some((hint) => !countries().get(normalizePlaceText(hint)));
}

function aliasCandidates(key: string) {
  const alias = placeAliases[key];
  if (!alias) return [];
  const targetKey = normalizePlaceText(alias.name);
  return (names().get(targetKey) || [])
    .filter((city) => city.countryCode === alias.countryCode)
    .filter((city) => !alias.regionCode || city.admin1Code === alias.regionCode || city.admin1LocalCode === alias.regionCode)
    .map((city) => ({ city, alias }));
}

function travelCodeFor(city: CityRecord, key: string) {
  const exactAlias = placeAliases[key];
  if (
    exactAlias &&
    exactAlias.countryCode === city.countryCode &&
    (!exactAlias.regionCode || exactAlias.regionCode === city.admin1Code || exactAlias.regionCode === city.admin1LocalCode)
  ) {
    return exactAlias.travelCode || null;
  }

  const cityKey = normalizePlaceText(city.asciiName || city.name);
  const alias = placeAliases[cityKey];
  if (
    alias &&
    alias.countryCode === city.countryCode &&
    (!alias.regionCode || alias.regionCode === city.admin1Code || alias.regionCode === city.admin1LocalCode)
  ) {
    return alias.travelCode || null;
  }

  return null;
}

function displayNameFor(city: CityRecord, key: string) {
  const exactAlias = placeAliases[key];
  const cityKey = normalizePlaceText(city.asciiName || city.name);
  const cityAlias = placeAliases[cityKey];
  return exactAlias?.displayName || cityAlias?.displayName || city.asciiName || city.name;
}

function labelFor(city: CityRecord, key: string) {
  const name = displayNameFor(city, key);
  if (normalizePlaceText(name) === "SAINT JOHN" && city.admin1Name) {
    return `${name}, ${city.admin1Name}, ${city.countryName}`;
  }
  return `${name}, ${city.countryName}`;
}

function scoreCity(params: {
  city: CityRecord;
  key: string;
  hints: string[];
  alias?: PlaceAlias;
  countryHints: Set<string>;
  regionHintPresent: boolean;
}) {
  const { city, key, hints, alias, countryHints, regionHintPresent } = params;
  const cityNameMatches =
    normalizePlaceText(city.name) === key ||
    normalizePlaceText(city.asciiName) === key;
  const countryMatches = countryHints.size ? countryHints.has(city.countryCode) : false;
  const regionMatches = regionHintMatches(city, hints);
  let score = 0;

  if (cityNameMatches) score += 120;
  if (alias) score += 80;
  if (countryHints.size) score += countryMatches ? 90 : -180;
  if (regionHintPresent) score += regionMatches ? 70 : -35;
  if (city.featureCode === "PPLC") score += 25;
  if (/^PPLA/.test(city.featureCode)) score += 10;
  score += Math.min(60, Math.log10(Math.max(city.population, 1)) * 9);

  return score;
}

export function resolveCityPlace(value?: string | null): ResolvedPlace | null {
  const input = splitInput(value);
  const key = normalizePlaceText(input.main);
  if (!key) return null;

  const direct = (names().get(key) || []).map((city) => ({ city, alias: undefined as PlaceAlias | undefined }));
  const aliases = aliasCandidates(key);
  const candidates = [...direct, ...aliases];
  if (!candidates.length) return null;

  const countryHints = countryHintCodes(input.hints);
  const regionHintPresent = hasRegionHint(input.hints);
  const ranked = candidates
    .map(({ city, alias }) => ({
      city,
      alias,
      score: scoreCity({
        city,
        key,
        hints: input.hints,
        alias,
        countryHints,
        regionHintPresent
      })
    }))
    .sort((left, right) => right.score - left.score || right.city.population - left.city.population);

  const best = ranked[0];
  if (!best || best.score < 95) return null;

  return {
    ...best.city,
    label: labelFor(best.city, key),
    searchLabel: labelFor(best.city, key),
    travelCode: travelCodeFor(best.city, key)
  };
}

export function requireResolvedPlaceLabel(value?: string | null) {
  return resolveCityPlace(value)?.searchLabel || "";
}
