// BoardUI finish checks (2026-11-10, hard-apply batch 10 — motion +
// email finish). Three items, each pinned as built:
//
//   (1) BuiSheet retint — the shared sheet primitive's scrim and
//       shadows were green-tinted rgba (10,28,21 / 8,44,32) from a
//       pre-token palette; they are now the navy recipe
//       rgba(7,30,85,·) (#071E55, cnavy) at identical alphas and
//       geometry. Both consumers stay put: gate sheets ride the
//       default scrim; the share sheet keeps its own ink/55 blur
//       override, untouched.
//   (2) Primitive verdicts — BuiFlipCard is REMOVED (zero importers;
//       every place-card surface in the product navigates on tap,
//       and the flip's own contract forbids interactive faces, so
//       adopting it meant replacing navigation with a toggle).
//       AnimatedIcons is trimmed to what real surfaces use: send
//       (share), unlock (activation), play/pause — the last WIRED
//       this batch into the home hero's rotation control, which
//       previously swapped two Lucide pictures, the precise habit
//       the owner's "icons MOVE, never swap" law bans. The
//       download / theme / search-close morphs are removed: no
//       download state machine, no theme toggle (light-only
//       product), and no search⇄close icon toggle exists.
//   (3) Email design layer — sent mail is CODE-driven
//       (renderRoamlyEmailShell + body builders); the
//       roamly_email_templates table has zero code references and
//       seeds nothing. The shell header is now the brand navy band
//       (white text wordmark — the logo PNG is primary-blue on
//       transparent and cannot sit on navy) and every legacy colour
//       across the six email files maps to a BoardUI token value.
//       Copy, links and merge fields are byte-invariant — proven
//       for this batch by golden renders + colour-stripped source
//       diffs (batch evidence), and pinned here by the verbatim
//       plain-text render, the ordered href list, and the copy
//       literals of the route-local builders.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderRoamlyEmailShell,
  renderSupportAutoReplyTemplate,
  ROAMLY_EMAIL_FOOTER_COPY,
  ROAMLY_AFFILIATE_DISCLOSURE
} from "../lib/roamly/emailTemplates.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  assert.ok(cond, msg);
}
function eq(actual, expected, msg) {
  checks += 1;
  assert.equal(actual, expected, msg);
}

/* ---------------- (1) BuiSheet retint ---------------- */
const sheet = read("components/boardui/Sheet.tsx");
ok(sheet.includes("bg-[rgba(7,30,85,0.34)]"), "1a: sheet scrim is the navy recipe rgba(7,30,85,0.34)");
ok(sheet.includes("shadow-[0_-12px_34px_rgba(7,30,85,0.22)]"), "1b: sheet panel shadow is navy rgba(7,30,85,0.22)");
ok(sheet.includes("lg:shadow-[-12px_0_34px_rgba(7,30,85,0.22)]"), "1c: desktop drawer shadow is navy rgba(7,30,85,0.22)");
ok(!sheet.includes("10,28,21") && !sheet.includes("8,44,32"), "1d: no green-tinted rgba remains in the sheet primitive");
const gates = read("components/roamly/gateViews.tsx");
ok(gates.includes("BuiSheet"), "1e: gate sheets still ride BuiSheet (default scrim consumer)");
const share = read("components/trip/TripShareActions.tsx");
ok(share.includes("BuiSheet") && share.includes('backdropClassName="bg-ink/55 backdrop-blur-sm"'), "1f: share sheet keeps its own ink/55 blur override, untouched by the retint");

/* ---------------- (2) primitive verdicts ---------------- */
ok(!fs.existsSync(path.join(root, "components/boardui/FlipCard.tsx")), "2a: BuiFlipCard is removed from the design system");

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}
const allSources = [...walk("app"), ...walk("components"), ...walk("lib")].map(read).join("\n");
ok(!allSources.includes("FlipCard"), "2b: no source anywhere references FlipCard");
ok(
  !allSources.includes("BuiDownloadIcon") && !allSources.includes("BuiThemeIcon") && !allSources.includes("BuiSearchXIcon"),
  "2c: the removed morphs (download/theme/search-close) are referenced nowhere"
);

const icons = read("components/boardui/AnimatedIcons.tsx");
const exportedIcons = [...icons.matchAll(/export function (Bui\w+Icon)/g)].map((m) => m[1]).sort();
eq(
  JSON.stringify(exportedIcons),
  JSON.stringify(["BuiPlayPauseIcon", "BuiSendIcon", "BuiUnlockIcon"]),
  "2d: AnimatedIcons exports exactly the three wired morphs"
);

const hero = read("components/roamly/DynamicDestinationHero.tsx");
ok(hero.includes('import { BuiPlayPauseIcon } from "@/components/boardui/AnimatedIcons"'), "2e: hero imports the play/pause morph");
ok(hero.includes("<BuiPlayPauseIcon playing={rotationPaused}"), "2f: hero rotation control renders the morph on the pause state");
ok(!hero.includes("<Pause") && !hero.includes("<Play"), "2g: hero no longer swaps Lucide Play/Pause pictures");
ok(hero.includes("[&_svg]:h-3 [&_svg]:w-3"), "2h: hero pins the morph to the original 12px control size");

const activate = read("components/trip/ActivateTripButton.tsx");
ok(activate.includes("BuiUnlockIcon"), "2i: unlock morph still wired on trip activation");
ok(share.includes("BuiSendIcon"), "2j: send morph still wired on trip share");

/* ---------------- (3) email design layer ---------------- */
const shell = read("lib/roamly/emailTemplates.ts");
ok(shell.includes('bgcolor="#071E55"'), "3a: email shell header is the brand navy band");
ok(shell.includes(">Roamly</a>"), "3b: navy band carries the white text wordmark, linked as before");
ok(!shell.includes("#D9E2EE"), "3c: legacy border colour #D9E2EE is gone from the shell");
ok(shell.includes('bgcolor="#087BFF"'), "3d: CTA stays the primary token #087BFF");
ok(shell.includes("background:#F2F6FC"), "3e: page ground stays the soft token #F2F6FC");
eq(
  ROAMLY_EMAIL_FOOTER_COPY,
  "Roamly helps travelers plan smarter trips with AI-powered itineraries, budget checks, booking organization, and Live Trip Companion.",
  "3f: footer copy byte-identical"
);
eq(
  ROAMLY_AFFILIATE_DISCLOSURE,
  "Roamly may earn a commission from some booking links. Recommendations are ranked according to your trip needs, not commission.",
  "3g: affiliate disclosure byte-identical"
);

const legacyByFile = {
  "lib/roamly/email.ts": ["#475467"],
  "lib/roamly/itineraryGenerationEmail.ts": ["#42526a", "#102033", "#526176"],
  "app/api/contact/route.ts": ["#42526a"],
  "app/api/cron/roamly-post-trip-ask/route.ts": ["#101828", "#e4e7ec", "#f9fafb"],
  "app/api/trips/[id]/email/route.ts": ["#0f8f9c", "#0aa6a6", "#54d6c6", "#132033", "#102033", "#526176", "#7a8798", "#dce8f2", "#e5edf3", "#f7fcff", "rgba(31,45,61"]
};
for (const [file, hexes] of Object.entries(legacyByFile)) {
  const src = read(file);
  for (const hex of hexes) {
    ok(!src.toLowerCase().includes(hex.toLowerCase()), `3h: ${file} no longer carries legacy ${hex}`);
  }
}
const tripEmail = read("app/api/trips/[id]/email/route.ts");
ok(tripEmail.includes("#087BFF") && tripEmail.includes("#071E55") && tripEmail.includes("#DCE5F0"), "3i: itinerary email rides primary + navy + hairline tokens");
ok(tripEmail.includes('href="${escapeHtml(tripUrl)}"') && tripEmail.includes('href="${escapeHtml(ROAMLY_PUBLIC_DOMAIN)}"'), "3j: itinerary email link constructions unchanged");
ok(tripEmail.includes("ROAMLY_EMAIL_FOOTER_COPY") && tripEmail.includes("manageNotificationPreferences"), "3k: itinerary email footer + preferences wiring unchanged");
const postTripAsk = read("app/api/cron/roamly-post-trip-ask/route.ts");
ok(postTripAsk.includes("background:#F2F6FC") && postTripAsk.includes("renderRoamlyEmailShell"), "3l: post-trip ask cards ride the soft token inside the shell");

/* Render-level pins: the plain text and the ordered hrefs of a
 * full-featured shell render are byte-identical to the pre-restyle
 * goldens (batch evidence golden-before.json). */
const rendered = renderRoamlyEmailShell({
  subject: "Your Rome trip is ready",
  preheader: "Five days, all planned.",
  eyebrow: "Itinerary ready",
  title: "Your Rome trip is ready",
  intro: "Ciao! Your itinerary is ready to review.\n\nEvery day is planned around your stay near Trastevere.",
  summaryItems: [
    { label: "Destination", value: "Rome, Italy" },
    { label: "Dates", value: "May 4 – May 8" },
    { label: "Travellers", value: 2 }
  ],
  ctaLabel: "View your itinerary",
  ctaUrl: "/trip/abc-123",
  supportEmail: "support@roamlyhq.com",
  managePreferencesUrl: "/account#notifications",
  managePreferencesLabel: "Manage notification preferences",
  includeAffiliateDisclosure: true
});
const hrefs = [...rendered.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
eq(
  JSON.stringify(hrefs),
  JSON.stringify([
    "https://roamlyhq.com/",
    "https://roamlyhq.com/trip/abc-123",
    "https://roamlyhq.com/account#notifications",
    "mailto:support@roamlyhq.com",
    "https://roamlyhq.com/"
  ]),
  "3m: shell render hrefs byte-identical to the pre-restyle golden"
);
ok(rendered.html.includes('bgcolor="#071E55"'), "3n: shell render carries the navy band");

const autoReply = renderSupportAutoReplyTemplate({ name: "Junel", supportEmail: "support@roamlyhq.com" });
eq(
  autoReply.text,
  "We received your Roamly message\n\nHi Junel,\n\nThanks for contacting Roamly. We received your message and will review it as soon as possible.\n\nIf your question is about a trip, itinerary, booking, payment, or Live Companion, please reply with any extra details or screenshots.\n\nOpen Roamly: https://roamlyhq.com/\n\nRoamly helps travelers plan smarter trips with AI-powered itineraries, budget checks, booking organization, and Live Trip Companion.\n\nNeed help? Reply to this email or contact support@roamlyhq.com.\n\nhttps://roamlyhq.com",
  "3o: support auto-reply plain text byte-identical to the pre-restyle golden"
);

console.log(`boardui-finish checks passed (${checks} checks)`);
