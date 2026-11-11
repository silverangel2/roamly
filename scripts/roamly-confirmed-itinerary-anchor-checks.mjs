import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { isConfirmedItineraryBookingAnchor } from "../lib/roamly/confirmedItineraryAnchor.ts";

/* Behavioural core: the anchor decision itself. An item is a
 * confirmed anchor ONLY when real booking evidence backs it —
 * never from the item's own labels. */
const evidence = [{ title: "LX Factory Food Tour", booking_status: "confirmed" }];
assert.equal(isConfirmedItineraryBookingAnchor("lx-factory food tour", evidence), true, "punctuation and case differences still match a real confirmed booking");
assert.equal(isConfirmedItineraryBookingAnchor("Oceanarium tickets", evidence), false, "AI suggestions cannot become confirmed from item_type alone");
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", booking_status: "recommended" }]), false);
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", booking_status: "confirmed", superseded_by_booking_id: "new-booking" }]), false);
assert.equal(isConfirmedItineraryBookingAnchor("LX Factory Food Tour", [{ title: "LX Factory Food Tour", traveler_confirmed: true }]), true);
assert.equal(isConfirmedItineraryBookingAnchor("", evidence), false);

/* Wiring half — Stage 4 rewrite (2026-11-10). The original pins
 * demanded the authority call inside app/trip/[id]/page.tsx, the
 * file that owned the timeline when the check was written. The
 * timeline build has since moved into the components/trip render
 * path (batch 1 redesign / composition batch), so the pin failed
 * on a healthy tree — the protection was intact, its address was
 * stale. The invariant is the behaviour, not the address:
 *
 *   1. SOMEWHERE in the trip render path (app/trip + components/
 *      trip), an item's confirmed authority is decided by calling
 *      isConfirmedItineraryBookingAnchor(title, confirmedBookings)
 *      — the timeline must consult actual booking evidence.
 *   2. NOWHERE in app/ or components/ may the role/type label
 *      shortcut (`role === "protected_anchor" || type ===
 *      "booking"`) confer confirmed status on its own. (This
 *      scope is BROADER than the original page-only pin.)
 *   3. The trip page still hands the confirmed-booking snapshots
 *      to BOTH the screen timeline and the print timeline — the
 *      data-flow contract the render path consumes.
 *
 * The builder itself (components/trip/ItineraryDayPlan.tsx) is
 * .tsx with a component import graph this node harness cannot
 * load, so the wiring is asserted at the source level while the
 * decision's behaviour is asserted directly above. If the render
 * path ever stops consulting the evidence function, pin 1 fails;
 * if a label shortcut reappears anywhere, pin 2 fails. */
async function collectSources(url) {
  const entries = await readdir(url, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
    if (entry.isDirectory()) out.push(...(await collectSources(child)));
    else if (/\.tsx?$/.test(entry.name)) out.push(await readFile(child, "utf8"));
  }
  return out;
}

const renderPathSources = [
  ...(await collectSources(new URL("../app/trip/", import.meta.url))),
  ...(await collectSources(new URL("../components/trip/", import.meta.url)))
].join("\n");
assert.match(
  renderPathSources,
  /const authority = isConfirmedItineraryBookingAnchor\(title, confirmedBookings\)/,
  "timeline confirmation must use actual booking evidence"
);

const appAndComponentSources = [
  ...(await collectSources(new URL("../app/", import.meta.url))),
  ...(await collectSources(new URL("../components/", import.meta.url)))
].join("\n");
assert.doesNotMatch(
  appAndComponentSources,
  /role === "protected_anchor" \|\| type === "booking"/,
  "AI-generated role/type labels must not independently confer confirmed status"
);

const page = await readFile(new URL("../app/trip/[id]/page.tsx", import.meta.url), "utf8");
assert.match(page, /confirmedBookings=\{confirmedBookingSnapshot as Array<Record<string, unknown>>\}/, "screen timeline receives confirmed snapshots");
assert.match(page, /confirmedBookings=\{confirmedBookings\}/, "print timeline receives confirmed snapshots");
console.log("Roamly confirmed itinerary anchor checks passed.");
