import assert from "node:assert/strict";
import fs from "node:fs";
import {
  clearPendingHotelProductChoice,
  getPendingHotelProductChoice,
  replacePendingHotelProductChoice,
  storageInputFromActiveChoiceResult
} from "../lib/roamly/hotelProductChoiceStorage.ts";

const moduleText = fs.readFileSync("lib/roamly/hotelProductChoiceStorage.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260913_roamly_pending_hotel_product_choices.sql", "utf8");

const choice = {
  selectedHotelCandidateId: "hotel-a",
  provider: "booking_demand",
  providerPropertyId: "1001",
  providerProductId: "P2",
  chosenAt: "2026-09-13T12:00:00.000Z",
  choiceSource: "CUSTOMER_EXPLICIT",
  revalidatedAt: "2026-09-13T11:59:00.000Z",
  bookingContinuity: "UNVERIFIED",
  actionability: "INFORMATIONAL_ONLY"
};

const acknowledged = ["PRICE_CHANGED", "CANCELLATION_CHANGED"];
const input = { choice, acknowledgedMaterialChanges: acknowledged };

class FakeQuery {
  constructor(state) {
    this.state = state;
    this.result = { data: null, error: null };
  }
  select() { return this; }
  eq(_field, value) { this.tripId = value; return this; }
  maybeSingle() {
    this.result = { data: this.state.rows.get(this.tripId) || null, error: null };
    return this;
  }
  single() {
    this.result = { data: this.state.rows.get(this.tripId) || null, error: null };
    return this;
  }
  upsert(row) {
    this.tripId = row.trip_id;
    this.state.rows.set(row.trip_id, structuredClone(row));
    this.state.upserts += 1;
    this.result = { data: this.state.rows.get(row.trip_id), error: null };
    return this;
  }
  delete() { this.deleting = true; return this; }
  then(resolve, reject) {
    if (this.deleting) {
      this.state.rows.delete(this.tripId);
      this.state.deletes += 1;
    }
    return Promise.resolve(this.result).then(resolve, reject);
  }
}

const fakeState = { rows: new Map(), upserts: 0, deletes: 0 };
const fakeSupabase = { from: () => new FakeQuery(fakeState) };
const before = structuredClone(input);
const stored = await replacePendingHotelProductChoice(fakeSupabase, "trip-a", input);
assert.equal(stored.error, null);
assert.equal(stored.choice.choice.providerProductId, "P2");
assert.equal(stored.choice.tripId, "trip-a");
assert.deepEqual(input, before);
assert.equal(fakeState.rows.size, 1);
assert.equal(fakeState.upserts, 1);
assert.equal(fakeState.rows.get("trip-a").provider_product_id, "P2");
assert.equal(Object.hasOwn(fakeState.rows.get("trip-a"), "price_amount"), false);

const replacement = structuredClone(input);
replacement.choice = { ...replacement.choice, providerProductId: "P3" };
const replaced = await replacePendingHotelProductChoice(fakeSupabase, "trip-a", replacement);
assert.equal(replaced.choice.choice.providerProductId, "P3");
assert.equal(fakeState.rows.size, 1);
assert.equal((await getPendingHotelProductChoice(fakeSupabase, "trip-a")).choice.choice.providerProductId, "P3");
await replacePendingHotelProductChoice(fakeSupabase, "trip-b", input);
assert.equal(fakeState.rows.size, 2);
await clearPendingHotelProductChoice(fakeSupabase, "trip-a");
assert.equal(fakeState.rows.has("trip-a"), false);
assert.equal(fakeState.rows.has("trip-b"), true);

assert.equal(storageInputFromActiveChoiceResult({ status: "INVALID_CHOICE", choice: null, reasonCodes: [], materialChanges: [], bookingContinuity: "UNVERIFIED" }), null);

assert.match(moduleText, /\.upsert\(row, \{ onConflict: "trip_id" \}\)/);
assert.match(moduleText, /\.from\("roamly_pending_hotel_product_choices"\)/);
assert.match(moduleText, /\.delete\(\)/);
assert.match(moduleText, /provider_property_id/);
assert.match(moduleText, /selected_hotel_candidate_id/);
assert.match(moduleText, /provider_product_id/);
assert.match(moduleText, /revalidated_at/);
assert.match(moduleText, /chosen_at/);
assert.match(moduleText, /acknowledged_material_changes/);
for (const forbidden of ["price_amount", "final_price", "booking_url", "deep_link", "raw_provider", "order_token", "payment_token", "Date.now", "fetch", "roamly_trips", "roamly_price_discoveries", "roamly_bookings", "trip_bookings"]) assert.doesNotMatch(moduleText, new RegExp(forbidden, "i"));

assert.match(migration, /trip_id uuid primary key references public\.roamly_trips\(id\) on delete cascade/);
assert.match(migration, /create table public\.roamly_pending_hotel_product_choices/);
assert.doesNotMatch(migration, /create table if not exists public\.roamly_pending_hotel_product_choices/);
assert.match(migration, /acknowledged_material_changes text\[\]/);
assert.match(migration, /provider = 'booking_demand'/);
assert.match(migration, /trip_id uuid primary key references public\.roamly_trips\(id\) on delete cascade/);
assert.match(migration, /for select to authenticated/);
assert.match(migration, /for all to authenticated/);
assert.match(migration, /using \([\s\S]*roamly_trips\.user_id = auth\.uid\(\)/);
assert.match(migration, /with check \([\s\S]*roamly_trips\.user_id = auth\.uid\(\)/);
assert.match(migration, /for all to authenticated/);
assert.doesNotMatch(migration, /to anon[\s\S]{0,80}(insert|update|delete)/i);
assert.doesNotMatch(migration, /create index[^\n]*pending_hotel_product_choices[^\n]*trip_id/i);
assert.doesNotMatch(migration, /grant all privileges on public\.roamly_pending_hotel_product_choices to anon/i);
assert.doesNotMatch(migration, /alter table public\.roamly_price_discoveries/i);
assert.doesNotMatch(migration, /alter table public\.roamly_bookings/i);
assert.doesNotMatch(migration, /create table if not exists public\.trip_bookings/i);
assert.doesNotMatch(migration, /create table[^\n]*hotel_booking|booking_status|order_token|payment_token/i);
assert.equal(choice.providerProductId, "P2");
assert.equal(choice.providerPropertyId, "1001");
assert.deepEqual(input.acknowledgedMaterialChanges, acknowledged);

console.log("PASS: hotel product choice storage primitive checks (schema, one-row upsert, narrow read/clear, safe surface, ownership RLS)");
