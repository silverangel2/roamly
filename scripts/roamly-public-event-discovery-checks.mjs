import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      require(id) {
        if (id.startsWith("@/")) return load(`${id.slice(2)}.ts`);
        if (id.startsWith(".")) return load(path.join(path.dirname(file), `${id}.ts`));
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const events = loadTsModule("lib/roamly/publicEventDiscovery.ts");
const { normalizePublicEventEvidence, evaluatePublicEventForTrip, evaluatePublicEventTruth, publicEventTruthForMarketResult, dedupePublicEvents, publicEventToMarketResult } = events;
const retrievedAt = "2026-09-14T12:00:00.000Z";
const trip = { destination: "Montreal, Canada", startDate: "2026-10-09", endDate: "2026-10-12" };

function event(overrides = {}) {
  return normalizePublicEventEvidence({
    sourceName: "Official Montreal Festival",
    sourceUrl: "https://festival.example.org/montreal",
    retrievedAt,
    title: "Montreal Saturday Festival",
    summary: "Official event details.",
    destination: "Montreal, Canada",
    venue: "Old Port",
    startDate: "2026-10-10",
    categories: ["festival", "cultural"],
    sourceQuality: "official_event",
    sourceConfidence: "high",
    occurrenceEvidence: "exact_date",
    ...overrides
  });
}

const exact = event();
assert.ok(exact, "normalizes an exact public event");
assert.equal(evaluatePublicEventForTrip(exact, trip).eligible, true, "A: exact trip-date event accepted");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2026-10-08" }), trip).eligible, false, "B: event before trip rejected");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2026-10-20" }), trip).eligible, false, "C: event after trip rejected");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2025-10-10" }), trip).eligible, false, "D: prior-year event rejected");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2027-10-10" }), trip).eligible, false, "E: future-year event rejected");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2026-10-08", endDate: "2026-10-10", occurrenceEvidence: "date_range" }), trip).eligible, true, "F: overlapping multi-day event accepted");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2026-10-01", endDate: "2026-10-08", occurrenceEvidence: "date_range" }), trip).eligible, false, "G: multi-day event ending before trip rejected");
assert.equal(evaluatePublicEventForTrip(event({ startDate: "2026-10-13", endDate: "2026-10-15", occurrenceEvidence: "date_range" }), trip).eligible, false, "H: multi-day event starting after trip rejected");

assert.equal(evaluatePublicEventForTrip(event({ sourceQuality: "organizer" }), trip).eligible, true, "I: official/organizer evidence accepted");
assert.equal(evaluatePublicEventForTrip(event({ sourceQuality: "unknown" }), trip).eligible, false, "J: weak source is insufficient");
assert.equal(evaluatePublicEventForTrip(event({ sourceConfidence: "low" }), trip).eligible, false, "K: low-confidence source is insufficient");
assert.equal(evaluatePublicEventForTrip(event({ recurrenceStatus: "recurring", occurrenceEvidence: "none" }), trip).eligible, false, "L: recurring claim does not prove occurrence");

assert.equal(exact.sourceUrl, "https://festival.example.org/montreal");
assert.equal(exact.sourceDomain, "festival.example.org", "M/N: source URL and domain preserved");
assert.equal(exact.retrievedAt, retrievedAt, "O: retrieval timestamp preserved");
assert.notEqual(exact.retrievedAt.slice(0, 10), exact.startDate, "P: retrieval and occurrence dates remain distinct");
assert.equal(event({ startTime: "" }).startTime, undefined, "Q: unknown time remains unknown");
assert.equal(event({ price: undefined }).priceStatus, "unknown", "R/S: missing price is unknown, not free");
assert.equal(event({ price: 40, priceStatus: "from_price" }).priceStatus, "from_price", "T: from-price remains non-final");
assert.equal(exact.informationUrl, exact.sourceUrl, "U/V: information URL is separate and informational");
assert.equal(exact.ticketStatus, "unknown", "W: ticket URL/status does not imply availability");

const publicFestival = event({ title: "Montreal Public Festival", sourceName: "Official Festival", sourceUrl: "https://festival.example.org/a" });
const publicConcert = event({ title: "Montreal Public Concert", sourceName: "Official Venue", sourceUrl: "https://venue.example.org/c", categories: ["concert"] });
const publicNightlife = event({ title: "Montreal Public Nightlife Event", sourceName: "Official Club", sourceUrl: "https://club.example.org/n", categories: ["nightlife", "party"] });
for (const candidate of [publicFestival, publicConcert, publicNightlife]) {
  assert.ok(candidate, "X-Z: public event categories normalize");
  assert.equal(publicEventToMarketResult(candidate).source, "public_web", "AA: public event has public-web provenance");
  assert.equal(publicEventToMarketResult(candidate).affiliate_url, undefined, "AA: no fabricated Klook/affiliate action");
}
const market = publicEventToMarketResult(publicFestival);
assert.equal(market.price_type, "unknown", "AB: public event does not imply availability/price");
assert.equal(market.metadata.public_event.title, publicFestival.title, "AC/AD: event identity and facts remain attached");
assert.equal(market.metadata.ticket_status, "unknown", "W: ticket URL is not availability proof");
assert.equal(publicEventTruthForMarketResult(market, new Date("2026-09-15T12:00:00.000Z")).state, "REVIEW_REQUIRED", "AK: retrievedAt alone does not establish current truth");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-09-20T00:00:00.000Z", startDate: "2026-10-10", ticketStatus: "unknown" }, new Date("2026-09-15T12:00:00.000Z")).state, "CURRENT_VERIFIED", "AL: valid future freshness can establish current event evidence");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-09-14T12:00:00.000Z", startDate: "2026-10-10" }, new Date("2026-09-15T12:00:00.000Z")).state, "REVIEW_REQUIRED", "AM: expired evidence requires review");
assert.equal(evaluatePublicEventTruth({ source: "public_web", startDate: "2026-10-10" }, new Date("2026-09-15T12:00:00.000Z")).state, "REVIEW_REQUIRED", "AN: missing expiry requires review");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "not-a-date", startDate: "2026-10-10" }, new Date("2026-09-15T12:00:00.000Z")).state, "REVIEW_REQUIRED", "AO: malformed expiry requires review");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2025-10-10" }, new Date("2026-09-15T12:00:00.000Z")).state, "HISTORICAL", "AP: ended events remain historical");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "bad-date" }, new Date("2026-09-15T12:00:00.000Z")).state, "REVIEW_REQUIRED", "AQ: malformed event dates do not create certainty");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-10-10", ticketStatus: "unknown" }, new Date("2026-09-15T12:00:00.000Z")).ticketStatus, "unknown", "AR: unknown ticket status remains unknown");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-10-10", ticketStatus: "available" }, new Date("2026-09-15T12:00:00.000Z")).ticketStatus, "available", "AS: ticket state remains separate from event truth");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-10-10", priceStatus: "known" }, new Date("2026-09-15T12:00:00.000Z")).priceStatus, "known", "AT: price provenance remains separate from event truth");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-09-15", startTime: "10:00", endTime: "11:00", timezone: "America/Toronto" }, new Date("2026-09-15T15:30:00.000Z")).state, "HISTORICAL", "AU: an event whose supplied end time has passed is historical");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-09-15", startTime: "10:00", endTime: "11:00", timezone: "America/Toronto" }, new Date("2026-09-15T15:30:00.000Z")).reason, "PAST_EVENT_TIME", "AV: event-time expiry is distinguished from date expiry");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-09-15", startTime: "10:00", endTime: "11:00" }, new Date("2026-09-15T14:30:00.000Z")).state, "REVIEW_REQUIRED", "AW: event time without a timezone remains uncertain");
assert.equal(evaluatePublicEventTruth({ source: "public_web", expiresAt: "2026-12-01T00:00:00.000Z", startDate: "2026-09-15", startTime: "10:00", endTime: "11:00", timezone: "America/Toronto" }, new Date("2026-09-15T14:00:00.000Z")).state, "CURRENT_VERIFIED", "AX: an event before its supplied end time remains current");

const duplicate = dedupePublicEvents([publicFestival, publicFestival]);
assert.equal(duplicate.length, 1, "AE: equivalent evidence dedupes deterministically");
const conflicting = dedupePublicEvents([
  event({ sourceUrl: publicFestival.sourceUrl, title: publicFestival.title, sourceEventId: "festival-a" }),
  event({ sourceUrl: publicFestival.sourceUrl, title: publicFestival.title, sourceEventId: "festival-a", startDate: "2026-10-11" })
]);
assert.equal(conflicting.length, 0, "AH: conflicting duplicate facts fail closed");
assert.notEqual(publicFestival.eventCandidateId, publicConcert.eventCandidateId, "AF: similar date/title events retain distinct identities");
assert.notEqual(publicFestival.eventCandidateId, publicNightlife.eventCandidateId, "AG: different venues/source identities remain distinct");
assert.equal(publicFestival.timezone, undefined, "AI/AJ: unknown timezone remains unknown; no device-timezone shift");

const marketSearch = fs.readFileSync(path.join(root, "lib/roamly/travelMarketSearch.ts"), "utf8");
const itinerary = fs.readFileSync(path.join(root, "lib/roamly/itineraryIntelligence.ts"), "utf8");
const tripPage = fs.readFileSync(path.join(root, "app/trip/[id]/page.tsx"), "utf8");
assert.match(marketSearch, /publicEventRequest/, "public event discovery is limited to event-shaped requests");
assert.match(marketSearch, /options\.allowFirecrawlFallback[\s\S]*publicEventRequest\(normalized\)/, "existing Firecrawl fallback is reused");
assert.match(marketSearch, /normalizePublicEventEvidence/, "search evidence uses the public event normalizer");
assert.match(marketSearch, /evaluatePublicEventForTrip/, "search evidence is date/context evaluated");
assert.match(marketSearch, /publicEventToMarketResult/, "grounded events feed the existing market-result stream");
assert.match(marketSearch, /start_date: payload\.startDate[\s\S]*end_date: payload\.endDate/, "trip event request binds exact dates");
assert.match(marketSearch, /\[\.\.\.primaryResults, \.\.\.discoveryResults\]/, "public events coexist with Klook/provider activity results");
assert.match(marketSearch, /if \(publicEventRequest\(request\)\)[\s\S]*continue;/, "weak event hits do not fall through as generic activity results");
assert.match(itinerary, /result\?\.source === "public_web"\) return "Check current event details"/, "public events use current-details CTA wording");
assert.doesNotMatch(marketSearch, /Klook.*replace|replace.*Klook/i, "Klook is not an event replacement strategy");
assert.doesNotMatch(marketSearch, /candidateDecisionCore|BOOKING_DEMAND_AFFILIATE_ID|orders\/(?:preview|create)/i, "AM/AS: unrelated authority is untouched");
assert.doesNotMatch(itinerary, /affiliate_provider: .*public_web/, "public-web events are not affiliate providers");
assert.match(itinerary, /candidateId: result\.id/, "grounded market identity remains available to activity intelligence");
assert.match(itinerary, /event_start_time/, "AY: public event times survive into the persisted suggestion");
assert.match(itinerary, /destinationPlace\?\.timezone/, "AZ: destination timezone is available to public-event truth evaluation");
assert.match(tripPage, /market_source === "public_web" && suggestion\.factual_status === "unknown"\) return null/, "BA: historical public events do not retain a current booking action");

console.log("Roamly public event discovery checks passed.");
