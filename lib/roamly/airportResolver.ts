import airportData from "@/lib/roamly/data/iata-airports.json";
import { normalizePlaceText, resolveCityPlace } from "@/lib/roamly/placeResolver";

type AirportTuple = [
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
  string
];

type AirportRecord = {
  iata: string;
  name: string;
  municipality: string;
  countryCode: string;
  countryName: string;
  regionCode: string;
  regionName: string;
  regionLocalCode: string;
  scheduledService: boolean;
  type: string;
  keywords: string;
};

const airportTuples = (airportData as unknown as { airports: AirportTuple[] }).airports;

let airportRecords: AirportRecord[] | null = null;
let codeIndex: Map<string, AirportRecord> | null = null;
let nameIndex: Map<string, AirportRecord[]> | null = null;

function records() {
  if (!airportRecords) {
    airportRecords = airportTuples.map((row) => ({
      iata: row[0],
      name: row[1],
      municipality: row[2],
      countryCode: row[3],
      countryName: row[4],
      regionCode: row[5],
      regionName: row[6],
      regionLocalCode: row[7],
      scheduledService: row[8] === 1,
      type: row[9],
      keywords: row[10]
    }));
  }

  return airportRecords;
}

function codes() {
  if (!codeIndex) {
    codeIndex = new Map(records().map((airport) => [airport.iata, airport]));
  }
  return codeIndex;
}

function addName(index: Map<string, AirportRecord[]>, value: string, airport: AirportRecord) {
  const key = normalizePlaceText(value);
  if (!key) return;
  const list = index.get(key);
  if (list) list.push(airport);
  else index.set(key, [airport]);
}

function names() {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const airport of records()) {
      addName(nameIndex, airport.name, airport);
      addName(nameIndex, airport.municipality, airport);
      for (const keyword of airport.keywords.split(",")) addName(nameIndex, keyword, airport);
    }
  }

  return nameIndex;
}

function airportScore(airport: AirportRecord) {
  let score = 0;
  if (airport.scheduledService) score += 40;
  if (airport.type === "large_airport") score += 35;
  if (airport.type === "medium_airport") score += 25;
  if (airport.type === "small_airport") score += 8;
  return score;
}

function bestAirport(candidates: AirportRecord[]) {
  return candidates
    .slice()
    .sort((left, right) => airportScore(right) - airportScore(left) || left.iata.localeCompare(right.iata))[0] || null;
}

function airportForPlace(input?: string | null) {
  const place = resolveCityPlace(input);
  if (!place) return "";
  if (place.travelCode) return place.travelCode;

  const cityKey = normalizePlaceText(place.asciiName || place.name);
  const candidates = (names().get(cityKey) || [])
    .filter((airport) => airport.countryCode === place.countryCode)
    .filter((airport) =>
      airport.regionLocalCode
        ? airport.regionLocalCode === place.admin1LocalCode || airport.regionName === place.admin1Name
        : airport.regionName === place.admin1Name
    );

  return bestAirport(candidates)?.iata || "";
}

function airportForName(input?: string | null) {
  const key = normalizePlaceText(input);
  if (!key) return "";
  const candidates = names().get(key) || [];
  return bestAirport(candidates)?.iata || "";
}

export function resolveTravelIataCode(input?: string | null) {
  const key = normalizePlaceText(input);
  if (!key) return "";

  if (/^[A-Z]{3}$/.test(key) && codes().has(key)) {
    return key;
  }

  return airportForPlace(input) || airportForName(input) || "";
}
