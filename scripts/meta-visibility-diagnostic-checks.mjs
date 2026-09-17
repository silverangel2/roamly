import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const route = readFileSync("app/api/admin/social/meta-diagnostics/route.ts", "utf8");
const helper = readFileSync("lib/roamly/metaVisibilityDiagnostic.ts", "utf8");
const publisher = readFileSync("lib/roamly/socialAutomation.ts", "utf8");
const ui = readFileSync("components/admin/social/MetaVisibilityDiagnostic.tsx", "utf8");

assert.match(route, /requireRoamlyAdmin/);
assert.match(route, /export async function GET/);
assert.match(route, /export async function POST/);
assert.match(route, /GET-only diagnostic/);
assert.match(helper, /method: "GET"/);
assert.doesNotMatch(helper, /method: "POST"|method: "PUT"|method: "PATCH"|method: "DELETE"/);
assert.match(helper, /safeMessage/);
assert.doesNotMatch(route, /access_token|Authorization|ROAMLY_META_ACCESS_TOKEN/);
assert.doesNotMatch(ui, /access_token|Authorization|ROAMLY_META_ACCESS_TOKEN/);
assert.match(helper, /video_reels|permalink_url|is_reel|media_type/);
assert.match(helper, /path: `\$\{input\.pageId\}\/video_reels`/);
assert.doesNotMatch(helper, /fields: "[^"]*status[^"]*"/);
assert.doesNotMatch(publisher, /fields: "[^"]*status[^"]*"/);
assert.doesNotMatch(helper, /path: objectId/);
assert.doesNotMatch(publisher, /\`\$\{videoId\}\`/);
assert.match(publisher, /findPublishedReelInPageCollection/);
assert.match(publisher, /publishedVideoId/);
assert.match(helper, /NOT_EXPOSED_BY_META_API/);
console.log("PASS: Roamly Meta visibility diagnostic is admin-only, GET-only, and secret-safe by source contract");
