import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const store = read("lib/roamly/findsPromoStore.ts");
const route = read("app/api/admin/roamly/finds-promo/route.ts");
const page = read("app/admin/finds-promo/page.tsx");
const controls = read("components/admin/FindsPromoControls.tsx");
const findsPage = read("app/finds/page.tsx");

assert.match(store, /FINDS_PROMO_SETTING_KEY/);
assert.match(store, /roamly_admin_settings/);
assert.match(store, /safeExternalUrl/);
assert.match(store, /raw\.enabled !== false/);
assert.match(store, /startsAt/);
assert.match(store, /endsAt/);
assert.match(route, /requireRoamlyAdmin/);
assert.match(route, /normalizeFindsPromoInput/);
assert.match(route, /saveFindsPromo/);
assert.match(page, /FindsPromoControls/);
assert.match(controls, /Save Finds promo/);
assert.match(findsPage, /getActiveFindsPromo/);
assert.doesNotMatch(controls, /dangerouslySetInnerHTML/);
assert.doesNotMatch(route, /process\.env\.[A-Z0-9_]+/);

console.log("Roamly admin-controlled Finds promo checks passed.");
