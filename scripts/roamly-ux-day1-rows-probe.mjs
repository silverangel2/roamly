// One-off probe (this round only): list the home panel's Day 1 rows
// and the Day 1 day-card rows for the live Montreal trip, so the
// derived count can be checked against the rows on screen.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/package.json");
const { chromium } = require("playwright-core");
const { createServerClient } = require("@supabase/ssr");
const BASE = "http://localhost:3100";
const MONTREAL = "4e5ac222-4ba9-4cb9-ba4b-ce618a03059f";
const EXE = "/home/hatch/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const env = Object.fromEntries(readFileSync("/home/hatch/workspace/roamly-ux-repair-2026-10-25/tree/.render-env", "utf8").trim().split("\n").map((l) => l.split("=")));
const account = JSON.parse(readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-secrets/test-account.json", "utf8"));
const jar = new Map();
const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  cookies: { getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })), setAll: (list) => { for (const c of list) jar.set(c.name, c.value); } }
});
const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
if (error) { console.error("sign-in failed"); process.exit(3); }
const cookies = [...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }));
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, locale: "en-CA", timezoneId: "America/Moncton" });
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto(`${BASE}/trip/${MONTREAL}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const link = [...document.querySelectorAll("a")].find((a) => (a.textContent || "").trim().startsWith("Skip for now"));
  if (link) link.click();
});
await page.waitForTimeout(3000);
await page.goto(`${BASE}/trip/${MONTREAL}?skipSetupGate=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3500);
const rows = await page.evaluate(() => {
  const panel = document.querySelector('section[aria-label^="Itinerary home"]');
  const panelRows = panel ? [...panel.querySelectorAll("ol li a")].map((a) => a.textContent.replace(/\s+/g, " ").trim()) : [];
  const card = document.querySelector("#day-1");
  const cardRows = card ? [...card.querySelectorAll("article")].map((a) => a.textContent.replace(/\s+/g, " ").trim().slice(0, 200)) : [];
  return { panelRows, cardRows };
});
console.log("PANEL ROWS (" + rows.panelRows.length + "):");
rows.panelRows.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
console.log("CARD ARTICLES (" + rows.cardRows.length + "):");
rows.cardRows.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
await browser.close();
