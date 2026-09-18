import assert from "node:assert/strict";
import { buildTravelerPersonalizationContext, hotelPersonalizationScore } from "../lib/roamly/travelerPersonalization.ts";

function check(name, condition) {
  assert.equal(condition, true, name);
  console.log(`PASS ${name}`);
}

const accepted = buildTravelerPersonalizationContext({
  personalization_enabled: true,
  confirmed_preferences: {
    preferred_travel_pace: "slower",
    accommodation_types: ["boutique"],
    passport_issuing_country: "CA"
  },
  inferred_preferences: {
    preferred_travel_pace: "packed",
    hotel_priorities: ["quiet area"]
  }
});

check("accepted preferences are included", accepted.accepted.preferred_travel_pace === "slower");
check("accepted preferences outrank same-key inferred values", accepted.inferred.preferred_travel_pace === undefined);
check("inferred preferences remain separate", accepted.inferred.hotel_priorities?.[0] === "quiet area");
check("sensitive profile fields are excluded", !Object.hasOwn(accepted.accepted, "passport_issuing_country"));
check("personalization opt-out disables memory", buildTravelerPersonalizationContext({ personalization_enabled: false, confirmed_preferences: { preferred_travel_pace: "slower" } }).enabled === false);
check("no memory remains valid", buildTravelerPersonalizationContext(null).enabled === false);
check("pending preferences are not accepted", buildTravelerPersonalizationContext({ personalization_enabled: true, confirmed_preferences: {} }).accepted.preferred_travel_pace === undefined);

const acceptedHotel = buildTravelerPersonalizationContext({ personalization_enabled: true, confirmed_preferences: { preferred_neighbourhood_style: "quiet" } });
const inferredHotel = buildTravelerPersonalizationContext({ personalization_enabled: true, confirmed_preferences: {}, inferred_preferences: { preferred_neighbourhood_style: "quiet" } });
const neutralHotel = "Central hotel with restaurant";
const quietHotel = "Quiet neighborhood boutique hotel";
check("accepted hotel preference changes soft score", hotelPersonalizationScore({ hotelText: quietHotel, personalization: acceptedHotel }).score > hotelPersonalizationScore({ hotelText: neutralHotel, personalization: acceptedHotel }).score);
check("personalization score cannot change eligibility", hotelPersonalizationScore({ hotelText: "Quiet neighborhood", personalization: acceptedHotel }).score === 6);
check("current accommodation preference suppresses conflicting memory", hotelPersonalizationScore({ hotelText: quietHotel, currentAccommodationPreference: "all-inclusive resort", personalization: acceptedHotel }).score === 0);
check("accepted outranks inferred", hotelPersonalizationScore({ hotelText: quietHotel, personalization: acceptedHotel }).score > hotelPersonalizationScore({ hotelText: quietHotel, personalization: inferredHotel }).score);
check("unknown hotel evidence gets no invented score", hotelPersonalizationScore({ hotelText: "", personalization: acceptedHotel }).score === 0);
check("disabled personalization has no ranking effect", hotelPersonalizationScore({ hotelText: quietHotel, personalization: buildTravelerPersonalizationContext({ personalization_enabled: false, confirmed_preferences: { preferred_neighbourhood_style: "quiet" } }) }).score === 0);
check("accepted hotel dislikes reduce soft score", hotelPersonalizationScore({ hotelText: "Hostel in a noisy area", personalization: buildTravelerPersonalizationContext({ personalization_enabled: true, confirmed_preferences: { dislikes: ["hostel"] } }) }).score === -6);

const sourceFiles = {
  staged: await (await import("node:fs/promises")).readFile("lib/roamly/stagedItineraryGeneration.ts", "utf8"),
  decision: await (await import("node:fs/promises")).readFile("lib/roamly/candidateDecisionCore.ts", "utf8"),
  feedback: await (await import("node:fs/promises")).readFile("lib/roamly/tripFeedback.ts", "utf8")
};

check("generation state snapshots personalization", sourceFiles.staged.includes("personalization: params.context.personalization"));
check("generation prompts state historical personalization", sourceFiles.staged.includes("Historical traveler personalization"));
check("current booking authority remains explicit", sourceFiles.staged.includes("Confirmed bookings are fixed anchors"));
check("memory does not create hard eligibility", sourceFiles.decision.includes("personalization?: TravelerPersonalizationContext") && !sourceFiles.decision.includes("matchesHardHotel(candidate, constraints.hotel || {}, personalization"));
check("feedback remains proposed", sourceFiles.feedback.includes('status: "proposed"'));

console.log("Traveler Preference Application V1 checks passed.");
