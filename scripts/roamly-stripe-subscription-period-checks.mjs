import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripeSubscriptionPeriodEnd } from "../lib/roamly/stripeSubscriptionPeriod.ts";

assert.equal(stripeSubscriptionPeriodEnd(1_800_000_000), "2027-01-15T08:00:00.000Z", "invoice Unix timestamps remain supported");
assert.equal(stripeSubscriptionPeriodEnd({ current_period_end: 1_800_000_000 }), "2027-01-15T08:00:00.000Z", "legacy subscription payloads remain supported");
assert.equal(
  stripeSubscriptionPeriodEnd({ items: { data: [{ current_period_end: 1_900_000_000 }, { current_period_end: 1_800_000_000 }] } }),
  "2027-01-15T08:00:00.000Z",
  "current Stripe item-level periods are read conservatively"
);
assert.equal(stripeSubscriptionPeriodEnd({ items: { data: [{ current_period_end: null }] } }), null);

const billing = await readFile(new URL("../lib/roamly/billing.ts", import.meta.url), "utf8");
assert.match(billing, /stripeSubscriptionPeriodEnd\(subscription\)/, "subscription webhook must parse current item-level billing periods");
console.log("Stripe subscription billing-period checks passed.");
