import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const i18n = read("lib/i18n.ts");
const language = read("lib/roamly/generationLanguage.ts");
const legacy = read("lib/ai/roamly-itinerary.ts");
const staged = read("lib/roamly/stagedItineraryGeneration.ts");
const daily = read("lib/roamly/brain/dailyItineraryStage.ts");
const route = read("app/api/trips/generate/route.ts");
const itinerary = read("lib/itinerary.ts");

for (const locale of ["en", "fr", "es", "ja", "ko", "zh"]) {
  assert.ok(i18n.includes(`"${locale}"`), `${locale} must remain supported`);
}
assert.match(language, /ROAMLY_GENERATION_LANGUAGE_INSTRUCTION/);
assert.match(language, /ALL Roamly descriptive and customer-facing prose/);
for (const properNoun of ["Amazon", "Stay22", "Travelpayouts", "Google Maps", "Apple Maps", "Citymapper"]) {
  assert.ok(language.includes(properNoun), `${properNoun} preservation instruction must exist`);
}
for (const source of [legacy, staged, daily]) {
  assert.match(source, /ROAMLY_GENERATION_LANGUAGE_INSTRUCTION/);
}
assert.match(legacy, /buildCompactPrompt\(payload, validationErrors\)/);
assert.match(staged, /outlinePrompt\(state\.payload, state\)/);
assert.match(staged, /dayBatchPrompt\(/);
assert.match(daily, /systemPrompt\(params\.payload\.language\)/);
assert.match(route, /getRequestLocale\(request, getString\(body\.language\)\)/);
assert.match(route, /language: normalizeLocale\(language \|\| getString\(planning\.language\)\)/);
assert.match(staged, /safePayloadForState[\s\S]*language: normalizeLocale\(payload\.language\)/);
assert.match(staged, /payload: state\.payload/);
assert.match(itinerary, /localizeGeneratedExactText/);
for (const field of ["id", "booking_id", "url", "affiliate_url", "currency", "latitude", "longitude", "scheduled_start", "scheduled_end", "timezone"]) {
  assert.ok(language.includes(`"${field}"`), `${field} must be protected during localization`);
}
assert.match(language, /timeZone|timezone/);
console.log("Roamly itinerary language checks passed (locale propagation, prompts, retries, schema/fact protection, and timezone contract).");
