// roamly-ux-final-render.mjs — FINAL LOCAL TASKS ROUND (2026-10-27).
// Headless captures at 390px + 320px for: trip home (compact
// notice collapsed + expanded), Live, Alerts, Home (unchanged key
// screens), and the day-summary fixture page. Offline captures
// come from scripts/roamly-ux-offline-proof.mjs (same server).
// Run with the 0600 .render-env present; server on :3100.
// Captures: renders/final-2026-10-27/
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/package.json");
const { chromium } = require("playwright-core");
const { createServerClient } = require("@supabase/ssr");

const BASE = "http://localhost:3100";
const OUT = "/home/hatch/workspace/roamly-ux-repair-2026-10-25/renders/final-2026-10-27";
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

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const report = { steps: [], generatedAt: new Date().toISOString() };
function log(step, obj) { report.steps.push({ step, ...obj }); console.log(`--- ${step}: ${JSON.stringify(obj)}`); }
async function makeCtx(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, userAgent: IPHONE_UA, locale: "en-CA", timezoneId: "America/Moncton" });
  await ctx.addCookies(cookies);
  return ctx;
}
async function bodyInfo(page) {
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    const notice = document.querySelector('[data-testid="limited-features-notice"]');
    const fallback = document.querySelector('[data-testid="roamly-photo-fallback"]');
    return {
      chars: text.length,
      hasMontreal: text.includes("Montreal"),
      hasNotice: Boolean(notice),
      noticeOpen: notice ? notice.open : null,
      noticeText: notice ? notice.textContent.replace(/\s+/g, " ").trim().slice(0, 300) : null,
      hasPhotoFallback: Boolean(fallback),
      hasHumane: text.includes("humane hour"),
      head: text.replace(/\s+/g, " ").slice(0, 220)
    };
  });
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

// ---- 390px: home with the compact notice (collapsed, then expanded) ----
const ctx = await makeCtx(390);
const page = await ctx.newPage();
await skipGate(page, MONTREAL);
await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3500);
const homeCollapsed = await bodyInfo(page);
log("home-390-collapsed", homeCollapsed);
await page.screenshot({ path: join(OUT, "home-390-notice-collapsed.png") });
if (homeCollapsed.hasNotice) {
  await page.evaluate(() => {
    const n = document.querySelector('[data-testid="limited-features-notice"]');
    const s = n ? n.querySelector("summary") : null;
    if (s) s.click();
  });
  await page.waitForTimeout(1200);
  const homeExpanded = await bodyInfo(page);
  log("home-390-expanded", homeExpanded);
  await page.screenshot({ path: join(OUT, "home-390-notice-expanded.png") });
} else {
  log("home-390-expanded", { skipped: "notice not rendered for this tester setup state" });
}
// ---- 390px: Live + Alerts (unchanged key screens) ----
await page.goto(`${BASE}/trip/${MONTREAL}/live`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3500);
log("live-390", await bodyInfo(page));
await page.screenshot({ path: join(OUT, "live-390.png") });
await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3500);
log("alerts-390", await bodyInfo(page));
await page.screenshot({ path: join(OUT, "alerts-390.png") });
// ---- 320px: home collapsed ----
const ctx320 = await makeCtx(320);
const page320 = await ctx320.newPage();
await skipGate(page320, MONTREAL);
await page320.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page320.waitForTimeout(3500);
log("home-320-collapsed", await bodyInfo(page320));
await page320.screenshot({ path: join(OUT, "home-320-notice-collapsed.png") });
// ---- day-summary fixture page ----
const fix = await ctx.newPage();
await fix.goto(`file://${OUT}/day-summary-fixture.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
await fix.waitForTimeout(800);
await fix.screenshot({ path: join(OUT, "day-summary-390.png") });
const fixText = await fix.evaluate(() => document.body.innerText);
log("day-summary-fixture", { hasCorrectedDay1: fixText.includes("starts with Musée du marché Sainte-Anne at 09:37"), hasHumane: fixText.includes("humane hour") });

writeFileSync(join(OUT, "final-render-report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("FINAL RENDER DONE");
