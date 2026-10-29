// roamly-ux-day-summary-fixture.mjs — FINAL LOCAL TASKS ROUND
// (2026-10-27). Renders the day-summary generator's corrected
// language as a capturable page: composeDay() over plan-shaped
// fixture days (real first stop + real time from the day items —
// nothing invented). This proves the GENERATOR's wording. It does
// NOT rewrite any stored trip's already-generated primary_plan
// text: stored text changes only when a trip is regenerated, and
// this round performs no production-data write.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-day-summary-fixture.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { composeDay, newComposerState } from "@/lib/roamly/engine/frames.ts";

const OUT = "/home/hatch/workspace/roamly-ux-repair-2026-10-25/renders/final-2026-10-27";
mkdirSync(OUT, { recursive: true });

const day1 = {
  dayNumber: 1, date: "2026-10-26", role: "",
  items: [
    { type: "stop", name: "Musée du marché Sainte-Anne", start: 577, end: 697 },
    { type: "stop", name: "Galerie Blanche", start: 670, end: 730 }
  ],
  legs: [], envelope: null, move: undefined, endMin: 1200
};
const day2 = {
  dayNumber: 2, date: "2026-10-27", role: "",
  items: [
    { type: "stop", name: "Old Port of Montreal", start: 600, end: 720 }
  ],
  legs: [], envelope: null, move: undefined, endMin: 1200
};
const ctx = { earliestLabel: "09:37", weatherByDate: {}, baseName: "Montreal", hasDietary: false, stay: null };
const s1 = composeDay(day1, ctx, newComposerState());
const s2 = composeDay(day2, { ...ctx, earliestLabel: "10:00" }, newComposerState());
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Day summary — corrected language</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#eff2f7;color:#0f172a;margin:0;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}p.note{font-size:13px;color:#475569;margin:0 0 16px}.card{background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:12px;box-shadow:0 2px 10px rgba(15,23,42,.06)}h2{font-size:17px;margin:0 0 6px}p{font-size:15px;line-height:1.6;margin:0}</style>
</head><body>
<h1>Day summary — corrected language</h1>
<p class="note">Generator output (composeDay) over plan-shaped fixture days. First stop + time come from the day items.</p>
<div class="card"><h2>Day 1 · Mon, Oct 26</h2><p>${esc(s1.join(" "))}</p></div>
<div class="card"><h2>Day 2 · Tue, Oct 27</h2><p>${esc(s2.join(" "))}</p></div>
</body></html>`;
writeFileSync(`${OUT}/day-summary-fixture.html`, html);
writeFileSync(`${OUT}/day-summary-fixture.json`, JSON.stringify({ day1: s1, day2: s2 }, null, 2));
console.log("DAY1 OPENING:", s1[0]);
console.log("DAY2 OPENING:", s2[0]);
console.log("WROTE:", `${OUT}/day-summary-fixture.html`);
