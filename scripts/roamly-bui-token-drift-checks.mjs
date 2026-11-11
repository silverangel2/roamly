// roamly-bui-token-drift-checks.mjs — G11 SINGLE-SOURCE pins
// (Stage 8, 2026-11-11): the brand tokens used to live as three
// hand-kept copies — components/boardui/tokens.ts, the --bui-*
// variables in app/globals.css, and the c-* palette in
// tailwind.config.ts — free to drift apart silently. Now
// tokens.ts is the one canonical home: tailwind.config.ts
// IMPORTS it, and the globals.css variables are DERIVED from it
// by scripts/generate-bui-css-vars.mjs.
//
// Pins:
//   - tokens.ts carries the owner's law values byte-exactly
//     (the nine named brand hexes);
//   - app/globals.css is byte-identical to what the generator
//     derives from tokens.ts (the stylesheet IS the generated
//     copy — regenerate with --write after any token edit);
//   - tailwind.config.ts (loaded through jiti, the loader
//     Tailwind itself uses) resolves every BoardUI key — the 14
//     c-colors, the 3 bui shadows, the bui radii + app radius,
//     the bui easing — to exactly the tokens.ts values, and the
//     legacy palette keys keep their pre-consolidation values;
//   - tailwind.config.ts source imports tokens.ts and carries
//     no BoardUI value literals of its own.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  applyBuiCssVars,
  computeBuiCssVars,
  readBuiTokens
} from "./generate-bui-css-vars.mjs";

let checks = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks += 1; };
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tokens = readBuiTokens(read("components/boardui/tokens.ts"));

// ---- the law values, byte-exact in the canonical home ----
const LAW = {
  blue: "#087BFF", navy: "#071E55", head: "#223354", bg: "#F2F6FC",
  card: "#FFFFFF", success: "#17A86B", orange: "#FF793D",
  purple: "#8957E5", warning: "#E94F67"
};
for (const [key, value] of Object.entries(LAW)) {
  eq(tokens.primitives[key], value, `tokens.ts buiPrimitives.${key} must be the law value ${value}`);
}

// ---- globals.css IS the generator's output ----
const css = read("app/globals.css");
eq(applyBuiCssVars(css, computeBuiCssVars(tokens)), css, "globals.css --bui-* values must equal the tokens.ts derivation (run scripts/generate-bui-css-vars.mjs --write)");

// ---- tailwind.config.ts resolves to the tokens, legacy intact ----
const require = createRequire(import.meta.url);
const jiti = require("jiti")(new URL("../tailwind.config.ts", import.meta.url).pathname);
const config = jiti(new URL("../tailwind.config.ts", import.meta.url).pathname).default;
const extend = config.theme.extend;

const C_COLORS = {
  chead: "head", cink: "ink", cgray: "gray", cgray2: "gray2",
  chair: "hairline", cchev: "chevron", cbg: "bg", cblue: "blue",
  cgreen: "success", cred: "warning", cnavy: "navy", csoft: "soft",
  corange: "orange", cpurple: "purple"
};
for (const [tailwindKey, primitiveKey] of Object.entries(C_COLORS)) {
  eq(extend.colors[tailwindKey], tokens.primitives[primitiveKey], `tailwind ${tailwindKey} must resolve to buiPrimitives.${primitiveKey}`);
}
eq(extend.boxShadow["bui-card"], tokens.shadow.card, "tailwind bui-card shadow = buiShadow.card");
eq(extend.boxShadow["bui-lift"], tokens.shadow.lift, "tailwind bui-lift shadow = buiShadow.lift");
eq(extend.boxShadow["bui-hero"], tokens.shadow.hero, "tailwind bui-hero shadow = buiShadow.hero");

const radius = readBuiTokens(read("components/boardui/tokens.ts"));
const radiusBlock = (() => {
  const src = read("components/boardui/tokens.ts");
  const start = src.indexOf("export const buiRadius = {");
  const block = src.slice(start, src.indexOf("}", start));
  const entries = {};
  for (const m of block.matchAll(/(\w+):\s*"([^"]*)"/g)) entries[m[1]] = m[2];
  return entries;
})();
eq(extend.borderRadius.app, radiusBlock.app, "tailwind app radius = buiRadius.app");
eq(extend.borderRadius["bui-card"], radiusBlock.card, "tailwind bui-card radius = buiRadius.card");
eq(extend.borderRadius["bui-panel"], radiusBlock.panel, "tailwind bui-panel radius = buiRadius.panel");
eq(extend.transitionTimingFunction.bui, tokens.motion.ease, "tailwind bui easing = buiMotion.ease");
void radius;

// legacy palette — pre-consolidation values, untouched by G11
eq(extend.colors.ink, "#102033", "legacy ink unchanged");
eq(extend.colors.lagoon, "#54D6C6", "legacy lagoon unchanged");
eq(extend.colors.sun, "#FFB84D", "legacy sun unchanged");
eq(extend.colors.coral, "#FF6B6B", "legacy coral unchanged");
eq(extend.colors.mist, "#F4F8FB", "legacy mist unchanged");
eq(extend.colors.cloud, "#E9F1F7", "legacy cloud unchanged");

// ---- the config derives, never copies ----
const configSource = read("tailwind.config.ts");
ok(configSource.includes('from "./components/boardui/tokens"'), "tailwind.config.ts must import the tokens module");
ok(!/c(?:head|ink|gray|gray2|hair|chev|bg|blue|green|red|navy|soft|orange|purple):\s*"/.test(configSource), "tailwind.config.ts must not carry c-* value literals");
ok(!/"bui-(?:card|lift|hero)":\s*"/.test(configSource), "tailwind.config.ts must not carry bui shadow literals");

console.log(`bui-token-drift checks: ${checks} PASS`);
