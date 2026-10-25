// Fix-everything batch checks (structural, source-level).
// 1. Wallet renders booking_segments (legs were stored but never shown).
// 2. Interest hint no longer contradicts the at-least-one validation.
// 3. The price-check notice no longer duplicates the price panel text.
// 4. Guest timeline skips rows whose traveler-facing title is empty.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const timeline = read("components/companion/BookingWalletTimeline.tsx");
check("timeline reads booking_segments", timeline.includes("booking.booking_segments"));
check("timeline sorts legs by sequence", timeline.includes("a.sequence"));
check("timeline renders leg lines under the route", timeline.includes("segmentLines(booking, locale)"));
check("timeline renders leg lines for the next booking", timeline.includes("segmentLines(next, locale)"));

const form = read("components/plan/TripPlanForm.tsx");
check("interest hint matches the at-least-one rule", form.includes("Pick at least one interest to shape your days."));
check("old contradictory hint is gone", !form.includes("Interests stay empty until you choose them."));
check("price notice suppressed while the price panel shows the same text", form.includes('!(priceChecking && notice === "Checking trip costs...")'));
check("other notices still render", form.includes("translateText(notice)"));

const guest = read("components/plan/GuestFreeItinerary.tsx");
check("guest timeline skips empty display titles", guest.includes("if (!displayTitle.trim()) return null;"));

console.log(`\n${passed} fix-everything checks passed`);
