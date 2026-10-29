// roamly-ux-final-render-round2.mjs — FINAL LOCAL ACCEPTANCE ROUND
// (2026-10-27). Headless captures at 390px + 320px for: trip home
// (display-corrected Day 1 summary, scrolled into view), the Day 1
// day card (second derived-summary surface), Live, Alerts. Offline
// captures come from scripts/roamly-ux-offline-proof.mjs (same server).
// The stored Day 1 summary is read read-only via the tester client
// (select only) and written to the report JSON, so the report can show
// STORED vs DISPLAYED side by side, labeled — the stored text is
// never rendered by the page anymore, which is exactly the point of
// the display-only correction.
// Run with the 0600 .render-env present; server on :3100.
// Captures: renders/final-local-round2-2026-10-27/
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/package.json");
const { chromium } = require("playwright-core");
const { createServerClient } = require("@supabase/ssr");
const { createClient } = require("@supabase/supabase-js");

const BASE = "http://localhost:3100";
const OUT = "/home/hatch/workspace/roamly-ux-repair-2026-10-25/renders/final-local-round2-2026-10-27";
mkdirSync(OUT, { recursive: true });
const MONTREAL = "4e5ac222-4ba9-4cb9-ba4b-ce618a03059f";
const EXE = "/home/hatch/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const env = Object.fromEntries(readFileSync("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/.render-env", "utf8").trim().split("\n").map((l) => l.split("=")));
const account = JSON.parse(readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-secrets/test-account.json", "utf8"));
const jar = new Map();
const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (list) => { for (const c of list) jar.set(c.name, c.value); } }
});
const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
if (signInError) { console.error("sign-in failed:", signInError.message); process.exit(3); }
const cookies = [...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }));

// Read-only stored Day 1 summary (tester scope, select only). The trip
// row's itinerary payload holds daily_itinerary[].primary_plan; the
// probe below inspects keys and extracts ONLY day 1's primary_plan.
let storedDay1 = null;
let storedProbe = null;
try {
  const reader = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } } });
  const tables = ["roamly_trips"];
  for (const table of tables) {
    const { data, error } = await reader.from(table).select("*").eq("id", MONTREAL).maybeSingle();
    if (error || !data) { storedProbe = error ? `${table}: ${error.message}` : `${table}: no row`; continue; }
    storedProbe = `${table}: keys=${Object.keys(data).join(",")}`;
    const candidates = [];
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if (Array.isArray(v.daily_itinerary)) candidates.push(...v.daily_itinerary);
        Object.values(v).forEach(walk);
      }
    };
    walk(data);
    const day1 = candidates.find((d) => d && (d.day_number === 1 || d.dayNumber === 1));
    if (day1) storedDay1 = day1.primary_plan || day1.morning || null;
    break;
  }
} catch (e) { storedProbe = `probe error: ${String(e).slice(0, 160)}`; }
console.log("STORED DAY1:", storedDay1);
console.log("STORED PROBE:", storedProbe);

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const report = { steps: [], storedDay1, storedProbe, generatedAt: new Date().toISOString() };
function log(step, obj) { report.steps.push({ step, ...obj }); console.log(`--- ${step}: ${JSON.stringify(obj)}`); }
async function makeCtx(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, userAgent: IPHONE_UA, locale: "en-CA", timezoneId: "America/Moncton" });
  await ctx.addCookies(cookies);
  return ctx;
}
async function skipGate(page, tripId) {
  await page.goto(`${BASE}/trip/${tripId}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const link = [...document.querySelectorAll("a")].find((a) => (a.textContent || "").trim().startsWith("Skip for now"));
    if (link) link.click();
  });
  await page.waitForTimeout(3000);
}
// Panel subtitle = the <p> right after the Day 1 <h3> inside the home
// panel; day-card summary = the first <p> after the Day 1 card heading.
async function extractDay1(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    const norm = text.replace(/\s+/g, " ");
    const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent.trim());
    const day1Heading = headings.find((h) => /^Day 1\b/.test(h)) || null;
    let panelSummary = null;
    const h3 = [...document.querySelectorAll("h3")].find((el) => /^Day 1\b/.test(el.textContent.trim()));
    if (h3) {
      let el = h3.nextElementSibling;
      while (el && el.tagName !== "P") el = el.nextElementSibling;
      if (el) panelSummary = el.textContent.replace(/\s+/g, " ").trim();
    }
    const card = document.querySelector("#day-1");
    let cardSummary = null;
    if (card) {
      const ps = [...card.querySelectorAll("p")];
      cardSummary = ps.length ? ps[0].textContent.replace(/\s+/g, " ").trim().slice(0, 300) : null;
    }
    return {
      chars: text.length, hasMontreal: text.includes("Montreal"),
      hasHumane: text.includes("humane hour"),
      day1Heading, panelSummary, cardSummary,
      head: norm.slice(0, 260)
    };
  });
}

for (const width of [390, 320]) {
  const ctx = await makeCtx(width);
  const page = await ctx.newPage();
  await skipGate(page, MONTREAL);
  await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3500);
  const home = await extractDay1(page);
  log(`home-${width}`, home);
  await page.screenshot({ path: join(OUT, `home-${width}.png`) });
  // Scroll the Day 1 panel heading into view and capture it.
  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].find((el) => /^Day 1\b/.test(el.textContent.trim()));
    if (h3) h3.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `home-${width}-day1.png`) });
  // Scroll to the Day 1 day card and capture its summary.
  await page.evaluate(() => {
    const card = document.querySelector("#day-1");
    if (card) card.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `daycard-${width}.png`) });
  await page.goto(`${BASE}/trip/${MONTREAL}/live`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3500);
  const live = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    return { chars: text.length, hasMontreal: text.includes("Montreal"), head: text.replace(/\s+/g, " ").slice(0, 220) };
  });
  log(`live-${width}`, live);
  await page.screenshot({ path: join(OUT, `live-${width}.png`) });
  await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3500);
  const alerts = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    return { chars: text.length, hasMontreal: text.includes("Montreal"), head: text.replace(/\s+/g, " ").slice(0, 220) };
  });
  log(`alerts-${width}`, alerts);
  await page.screenshot({ path: join(OUT, `alerts-${width}.png`) });
  await ctx.close();
}

writeFileSync(join(OUT, "final-render-report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("FINAL RENDER ROUND2 DONE");
