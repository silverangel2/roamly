// Roamly audit batch B07–B09 + PH06–PH07 checks.
// B07: one-time products reject recurring Stripe Prices (never a silent subscription).
// B08: async Checkout events fulfill (succeeded) or fail cleanly (failed), never silently.
// B09: affiliate conversions store a source_type the roamly_bookings CHECK allows,
//      with the conversion kind preserved in metadata.
// PH06: PHP prices must be tax-inclusive; PH07: diagnostics reports CAD + PHP sets.
// Env vars are set BEFORE the billing module loads (it reads config at import).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID = "price_1TpriyGt1u1jZHNUjeUYH3Nu";
process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID = "price_1TprjtGt1u1jZHNUFs2hRoiD";
process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID = "price_1TprkaGt1u1jZHNUO2V3Sjqt";
process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID_PHP = "price_1UU5MgGt1u1jZHNU8uK9m7EZ";
process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID_PHP = "price_1UU5NfGt1u1jZHNUBzO3Yijm";
process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID_PHP = "price_1UU5OOGt1u1jZHNU8ntfIV9Q";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const billing = await import("../lib/roamly/billing.ts");
const { validateStripePriceForPurchase, getStripeBillingDiagnostics, handleStripeWebhookEvent } = billing;
const { recordAffiliateConversion } = await import("../lib/roamly/affiliateTracking.ts");

const billingSource = readFileSync(new URL("../lib/roamly/billing.ts", import.meta.url), "utf8");
const affiliateSource = readFileSync(new URL("../lib/roamly/affiliateTracking.ts", import.meta.url), "utf8");

// ---------- B07 + PH06: price validation ----------
const PRODUCTS = [
  { type: "itinerary_unlock", cad: 499, php: 9900 },
  { type: "tracking_addon", cad: 399, php: 7900 },
  { type: "bundle", cad: 799, php: 14900 }
];
const cadTrip = { metadata: { planning: { destinationCountry: "Canada", destinationCity: "Montreal" } } };
const phTrip = { metadata: { planning: { destinationCountry: "Philippines", destinationCity: "Manila" } } };
function stubStripe(price) {
  return { prices: { retrieve: async () => ({ ...price, product: { id: "prod_x", active: true, name: "Test" } }) } };
}
function price(overrides) {
  return { id: "price_test", active: true, unit_amount: 499, currency: "cad", type: "one_time", tax_behavior: "exclusive", ...overrides };
}

for (const product of PRODUCTS) {
  // Recurring rejected for every product in both currencies.
  const cadRecurring = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.cad, currency: "cad", type: "recurring", recurring: { interval: "month" } })),
    product.type,
    cadTrip
  );
  assert.equal(cadRecurring.ok, false, `${product.type} CAD recurring must be rejected`);
  assert.equal(cadRecurring.error, "STRIPE_PRICE_RECURRING", `${product.type} CAD recurring error code`);
  const phpRecurring = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.php, currency: "php", type: "recurring", recurring: { interval: "month" }, tax_behavior: "inclusive" })),
    product.type,
    phTrip
  );
  assert.equal(phpRecurring.ok, false, `${product.type} PHP recurring must be rejected`);
  assert.equal(phpRecurring.error, "STRIPE_PRICE_RECURRING", `${product.type} PHP recurring error code`);

  // One-time still validates in both currencies.
  const cadOk = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.cad, currency: "cad", type: "one_time" })),
    product.type,
    cadTrip
  );
  assert.equal(cadOk.ok, true, `${product.type} CAD one-time must validate`);
  assert.equal(cadOk.mode, "payment", `${product.type} CAD mode is payment, never subscription`);
  const phpOk = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.php, currency: "php", type: "one_time", tax_behavior: "inclusive" })),
    product.type,
    phTrip
  );
  assert.equal(phpOk.ok, true, `${product.type} PHP one-time inclusive must validate`);

  // PH06: PHP tax-exclusive / unspecified must fail; CAD exclusive stays allowed
  // (no CAD tax requirement exists — only the PHP set is owner-set tax-inclusive).
  const phpExclusive = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.php, currency: "php", type: "one_time", tax_behavior: "exclusive" })),
    product.type,
    phTrip
  );
  assert.equal(phpExclusive.ok, false, `${product.type} PHP exclusive must be rejected`);
  assert.equal(phpExclusive.error, "STRIPE_PRICE_TAX_MISMATCH", `${product.type} PHP tax error code`);
  const phpUnspecified = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.php, currency: "php", type: "one_time", tax_behavior: "unspecified" })),
    product.type,
    phTrip
  );
  assert.equal(phpUnspecified.ok, false, `${product.type} PHP unspecified tax must be rejected`);
  const cadExclusive = await validateStripePriceForPurchase(
    stubStripe(price({ unit_amount: product.cad, currency: "cad", type: "one_time", tax_behavior: "exclusive" })),
    product.type,
    cadTrip
  );
  assert.equal(cadExclusive.ok, true, `${product.type} CAD exclusive keeps validating (no CAD tax rule)`);
}

// ---------- Fake Supabase (thenable query builder + webhook RPCs) ----------
class Q {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.op = "select";
    this.payload = null;
    this.singleMode = false;
    this.maybe = false;
  }
  select() { return this; }
  eq(c, v) { this.filters.push([c, v]); return this; }
  neq(c, v) { this.filters.push([c, ["neq", v]]); return this; }
  is(c, v) { this.filters.push([c, v]); return this; }
  in(c, vs) { this.filters.push([c, ["in", vs]]); return this; }
  contains() { return this; }
  order() { return this; }
  limit() { return this; }
  insert(p) { this.op = "insert"; this.payload = p; return this; }
  update(p) { this.op = "update"; this.payload = p; return this; }
  upsert(p) { this.op = "upsert"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.maybe = true; return this; }
  then(res, rej) { try { res(this.run()); } catch (e) { rej(e); } }
  match(row) {
    return this.filters.every(([c, v]) =>
      Array.isArray(v) && v[0] === "in" ? v[1].includes(row[c]) :
      Array.isArray(v) && v[0] === "neq" ? row[c] !== v[1] : row[c] === v);
  }
  run() {
    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    if (this.op === "select") {
      const found = rows.filter((r) => this.match(r));
      if (this.singleMode) return found.length ? { data: found[0], error: null } : { data: null, error: { message: "no row" } };
      if (this.maybe) return { data: found[0] || null, error: null };
      return { data: found, error: null };
    }
    if (this.op === "insert") {
      const row = { ...this.payload, id: this.payload.id || `fake-${this.table}-${rows.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      rows.push(row);
      this.db.writes.push({ table: this.table, op: "insert", row });
      return { data: this.singleMode || this.maybe ? row : [row], error: null };
    }
    if (this.op === "update") {
      const targets = rows.filter((r) => this.match(r));
      for (const r of targets) Object.assign(r, this.payload);
      this.db.writes.push({ table: this.table, op: "update", payload: this.payload, filters: this.filters, count: targets.length });
      return { data: targets, error: null };
    }
    if (this.op === "upsert") {
      const row = { ...this.payload, id: `fake-${this.table}-${rows.length + 1}` };
      rows.push(row);
      this.db.writes.push({ table: this.table, op: "upsert", row });
      return { data: [row], error: null };
    }
    return { data: null, error: null };
  }
}
function makeSupabase(seed) {
  const db = {
    tables: {
      roamly_trips: seed.trips || [],
      roamly_booking_referrals: seed.referrals || [],
      roamly_bookings: [],
      roamly_itinerary_purchases: [],
      roamly_trip_payments: [],
      roamly_app_events: [],
      roamly_trip_events: []
    },
    writes: []
  };
  return {
    db,
    from: (table) => new Q(db, table),
    rpc: async (name) => {
      if (name === "roamly_claim_stripe_webhook_event") {
        return { data: [{ claimed: true, claim_token: "tok-1", claim_status: "claimed", attempt_count: 1 }], error: null };
      }
      if (name === "roamly_complete_stripe_webhook_event" || name === "roamly_fail_stripe_webhook_event") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    }
  };
}
function checkoutSession(overrides) {
  return {
    id: "cs_test_1",
    status: "complete",
    payment_status: "paid",
    amount_total: 499,
    currency: "cad",
    payment_intent: "pi_test_1",
    subscription: null,
    customer: "cus_test",
    metadata: { trip_id: "trip-1", user_id: "user-1", purchase_type: "itinerary", checkoutKind: "itinerary_unlock" },
    ...overrides
  };
}
function stripeEvent(type, session) {
  return { id: `evt_${type}_${session.id}`, type, created: Math.floor(Date.now() / 1000), data: { object: session } };
}
function tripRow() {
  return {
    id: "trip-1",
    user_id: "user-1",
    itinerary_locked: false,
    itinerary_status: "draft",
    itinerary_generated_at: null,
    tracking_unlocked: false,
    live_companion_unlocked: false,
    metadata: { destinationCountry: "Canada" }
  };
}

// ---------- B08: async payment events ----------
{
  const fake = makeSupabase({ trips: [tripRow()] });
  const result = await handleStripeWebhookEvent(
    fake,
    stripeEvent("checkout.session.async_payment_succeeded", checkoutSession())
  );
  assert.equal(result.ok, true, "async_payment_succeeded must succeed");
  assert.equal(result.duplicate, false, "async_payment_succeeded is not a duplicate");
  const tripUpdate = fake.db.writes.find((w) => w.table === "roamly_trips" && w.op === "update");
  assert.equal(tripUpdate.payload.itinerary_payment_status, "paid", "async success unlocks the itinerary exactly like sync completion");
  assert.equal(tripUpdate.payload.itinerary_unlock_source, "paid");
  const purchaseUpsert = fake.db.writes.find((w) => w.table === "roamly_itinerary_purchases" && w.op === "upsert");
  assert.equal(purchaseUpsert.row.status, "paid", "async success writes a paid purchase ledger row");
  const paymentUpsert = fake.db.writes.find((w) => w.table === "roamly_trip_payments" && w.op === "upsert");
  assert.equal(paymentUpsert.row.status, "paid", "async success writes a paid payment ledger row");
  const tripEvent = fake.db.writes.find((w) => w.table === "roamly_trip_events" && w.row.event_type === "paid_itinerary_unlocked");
  assert.ok(tripEvent, "async success records the unlock trip event");
}
{
  const fake = makeSupabase({ trips: [tripRow()] });
  const result = await handleStripeWebhookEvent(
    fake,
    stripeEvent("checkout.session.async_payment_failed", checkoutSession({ payment_status: "unpaid" }))
  );
  assert.equal(result.ok, true, "async_payment_failed must be handled (not dropped, not an error)");
  assert.equal(result.duplicate, false);
  const purchaseFail = fake.db.writes.find((w) => w.table === "roamly_itinerary_purchases" && w.op === "update");
  assert.equal(purchaseFail.payload.status, "failed", "async failure marks the purchase failed");
  const paymentFail = fake.db.writes.find((w) => w.table === "roamly_trip_payments" && w.op === "update");
  assert.equal(paymentFail.payload.status, "failed", "async failure marks the payment failed");
  assert.equal(fake.db.writes.some((w) => w.table === "roamly_trips"), false, "async failure unlocks nothing");
  assert.equal(fake.db.writes.some((w) => w.table === "roamly_itinerary_purchases" && w.op === "upsert"), false, "async failure writes no paid purchase");
  const appEvent = fake.db.writes.find((w) => w.table === "roamly_app_events" && w.row.event_type === "checkout_async_payment_failed");
  assert.ok(appEvent, "async failure is observable via an app event");
}
{
  // Regression: synchronous completion still fulfills exactly as before.
  const fake = makeSupabase({ trips: [tripRow()] });
  const result = await handleStripeWebhookEvent(
    fake,
    stripeEvent("checkout.session.completed", checkoutSession())
  );
  assert.equal(result.ok, true, "checkout.session.completed still fulfills");
  const purchaseUpsert = fake.db.writes.find((w) => w.table === "roamly_itinerary_purchases" && w.op === "upsert");
  assert.equal(purchaseUpsert.row.status, "paid", "sync completion still writes a paid purchase");
}
{
  // Unknown events still fall through with no side effects.
  const fake = makeSupabase({ trips: [tripRow()] });
  const result = await handleStripeWebhookEvent(fake, stripeEvent("customer.created", checkoutSession()));
  assert.equal(result.ok, true, "unhandled event types still return ok");
  assert.equal(fake.db.writes.length, 0, "unhandled event types must not write");
}

// ---------- B09: affiliate conversion source vocabulary ----------
{
  const migration = readFileSync(
    new URL("../supabase/migrations/20260801_roamly_email_lookback_production.sql", import.meta.url),
    "utf8"
  );
  const checkList = migration.slice(
    migration.indexOf("roamly_bookings_source_type_check"),
    migration.indexOf(");", migration.indexOf("roamly_bookings_source_type_check"))
  );
  assert.match(checkList, /'affiliate'/, "DB constraint allows 'affiliate'");
  assert.doesNotMatch(checkList, /'affiliate_conversion'/, "DB constraint does NOT allow 'affiliate_conversion' (the audit defect)");
  assert.doesNotMatch(affiliateSource, /sourceType: "affiliate_conversion"/, "the affiliate writer no longer emits the disallowed value");

  const fake = makeSupabase({
    trips: [tripRow()],
    referrals: [{
      id: "click-1",
      user_id: "user-1",
      trip_id: "trip-1",
      provider: "stay22",
      commercial_partner: "stay22",
      recommendation_id: null,
      booking_type: "hotel",
      destination_url: "https://example.com/hotel",
      affiliate_url: "https://example.com/aff",
      provider_tracking_reference: "rc_test123",
      metadata: {}
    }]
  });
  const outcome = await recordAffiliateConversion({
    supabase: fake,
    input: {
      subId: "rc_test123",
      provider: "stay22",
      externalOrderId: "ORD-99",
      bookingType: "hotel",
      status: "confirmed",
      amount: 100,
      currency: "CAD",
      reliable: true,
      booking: { title: "Test Hotel Stay", startTime: "2026-11-10T15:00:00.000Z" }
    }
  });
  assert.equal(outcome.error, null, `affiliate conversion must save without error (got ${outcome.error})`);
  assert.ok(outcome.booking && outcome.booking.id, "affiliate conversion must return a saved booking");
  const bookingInsert = fake.db.writes.find((w) => w.table === "roamly_bookings" && w.op === "insert");
  assert.ok(bookingInsert, "affiliate conversion must insert a booking row");
  assert.equal(bookingInsert.row.source_type, "affiliate", "stored source_type must be a CHECK-allowed value");
  assert.ok(checkList.includes(`'${bookingInsert.row.source_type}'`), "stored source_type must be in the DB constraint list (read-back contract)");
  assert.equal(bookingInsert.row.metadata.affiliateConversion, true, "conversion kind must survive in metadata");
  assert.equal(bookingInsert.row.metadata.affiliateConversionId, "ORD-99", "conversion link must survive in metadata.affiliateConversionId");
}

// ---------- PH07: diagnostics reports both sets ----------
{
  const diagnostics = await getStripeBillingDiagnostics();
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_ITINERARY_PRICE_ID, true, "CAD itinerary flag present");
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_FEATURES_PRICE_ID, true, "CAD features flag present");
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID, true, "CAD bundle flag present");
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_ITINERARY_PRICE_ID_PHP, true, "PHP itinerary flag present (not CAD-defaulted)");
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_FEATURES_PRICE_ID_PHP, true, "PHP features flag present");
  assert.equal(diagnostics.configured.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID_PHP, true, "PHP bundle flag present");
  assert.deepEqual(diagnostics.prices, [], "without a Stripe key the price list stays empty");
  const diagnosticsBody = billingSource.slice(
    billingSource.indexOf("export async function getStripeBillingDiagnostics"),
    billingSource.indexOf("export async function getStripeBillingDiagnostics") + 4000
  );
  assert.match(diagnosticsBody, /ROAMLY_STRIPE_ITINERARY_PRICE_ID_PHP/, "diagnostics code references the PHP env set");
  assert.match(diagnosticsBody, /priceSet/, "diagnostics entries carry a priceSet (cad/php) field");
  assert.match(diagnosticsBody, /getPurchaseOption\(purchaseType, philippinesTrip\)/, "PHP diagnostics entries validate the PHP option, not the CAD default");
  assert.match(diagnosticsBody, /currencyMatches: validation\.price\.currency === option\.currency/, "currency match compares against the entry's own set currency");
}

console.log("B07–B09 + PH06–PH07 billing checks passed.");
