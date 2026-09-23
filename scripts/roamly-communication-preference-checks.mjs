import assert from "node:assert/strict";
import {
  communicationPreferenceForNotificationType,
  communicationPreferenceForPurpose,
  getCommunicationPreferenceState,
  getCompanionPreferencesForDelivery
} from "../lib/roamly/companionPreferences.ts";

assert.equal(communicationPreferenceForPurpose("daily_trip_briefing"), "dailyBriefingEnabled");
assert.equal(communicationPreferenceForPurpose("pretrip_7d"), "dailyBriefingEnabled");
assert.equal(communicationPreferenceForPurpose("booking_material_change"), "bookingNotificationsEnabled");
assert.equal(communicationPreferenceForPurpose("purchase_confirmation"), null);
assert.equal(communicationPreferenceForNotificationType("flight_cancelled"), "importantTravelAlertsEnabled");
assert.equal(communicationPreferenceForNotificationType("booking_changed"), "bookingNotificationsEnabled");
assert.equal(communicationPreferenceForNotificationType("check_in_reminder"), "checkInRemindersEnabled");
assert.equal(communicationPreferenceForNotificationType("daily_briefing"), "dailyBriefingEnabled");

function fakeDb(results) {
  let index = 0;
  return {
    from() {
      const current = results[index++];
      const query = {
        select() { return query; },
        eq() { return query; },
        is() { return query; },
        maybeSingle() { return Promise.resolve(current); }
      };
      return query;
    }
  };
}

const params = { userId: "traveler", tripId: "trip", supabase: null };
assert.equal(await getCompanionPreferencesForDelivery({ ...params, supabase: fakeDb([{ data: null, error: { message: "unavailable" } }]) }), null);
assert.equal(await getCompanionPreferencesForDelivery({ ...params, supabase: fakeDb([{ data: null, error: null }, { data: null, error: { message: "unavailable" } }]) }), null);
const defaults = await getCompanionPreferencesForDelivery({ ...params, supabase: fakeDb([{ data: null, error: null }, { data: null, error: null }]) });
assert.equal(defaults?.dailyBriefingEnabled, true);
assert.equal(defaults?.marketingEnabled, false);
const optedOut = await getCompanionPreferencesForDelivery({ ...params, supabase: fakeDb([{ data: { daily_briefing_enabled: false }, error: null }]) });
assert.equal(optedOut?.dailyBriefingEnabled, false);
assert.equal(await getCommunicationPreferenceState({ ...params, purpose: "daily_trip_briefing", supabase: fakeDb([{ data: null, error: { message: "unavailable" } }]) }), "unavailable");
assert.equal(await getCommunicationPreferenceState({ ...params, purpose: "daily_trip_briefing", supabase: fakeDb([{ data: { daily_briefing_enabled: false }, error: null }]) }), "disabled");
assert.equal(await getCommunicationPreferenceState({ ...params, purpose: "daily_trip_briefing", supabase: fakeDb([{ data: { daily_briefing_enabled: true }, error: null }]) }), "enabled");

console.log("Communication preference checks passed.");
