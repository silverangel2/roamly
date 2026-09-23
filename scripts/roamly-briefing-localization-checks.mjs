import assert from "node:assert/strict";
import { buildPreTrip7DayBriefingContent } from "../lib/roamly/preTrip7DayBriefingContent.ts";
import { buildPreTrip1DayBriefingContent } from "../lib/roamly/preTrip1DayBriefingContent.ts";
import { buildDailyTripBriefingContent } from "../lib/roamly/dailyTripBriefingContent.ts";
import { buildTravelDayBriefingContent } from "../lib/roamly/travelDayBriefingContent.ts";
import { companionBriefingMessage, localizeActivityNotification } from "../lib/roamly/briefingMessages.mjs";

const common = { destination: "Lisbon", startDate: "2026-10-15", endDate: "2026-10-20", timezone: "Europe/Lisbon", tripStart: new Date("2026-10-15T10:00:00Z"), tripPath: "/trip/demo" };
const week = buildPreTrip7DayBriefingContent({ ...common, confirmedBookings: [], gmailStatus: "connected", locale: "fr" });
assert.match(week.subject, /Lisbon/);
assert.match(week.subject, /semaine/);
assert.match(week.body, /réservation confirmée/);
assert.match(week.ctaLabel, /voyage/);

const tomorrow = buildPreTrip1DayBriefingContent({ ...common, bookings: [], firstActivity: null, gmailStatus: null, liveCompanionIncluded: false, locale: "es" });
assert.match(tomorrow.subject, /mañana/);
assert.match(tomorrow.eyebrow, /Mañana/);
assert.match(tomorrow.ctaLabel, /mañana/);

const daily = buildDailyTripBriefingContent({ ...common, dayKey: "2026-10-16", bookings: [], activities: [], now: new Date("2026-10-16T08:00:00Z"), liveCompanionIncluded: false, locale: "ja" });
assert.match(daily.subject, /Lisbon/);
assert.match(daily.eyebrow, /今日/);
assert.match(daily.ctaLabel, /今日/);

const travel = buildTravelDayBriefingContent({ ...common, bookings: [], firstActivity: null, gmailStatus: null, liveCompanionIncluded: false, locale: "zh" });
assert.match(travel.subject, /Lisbon/);
assert.match(travel.eyebrow, /出行日/);
assert.match(travel.ctaLabel, /行程/);

const nearby = localizeActivityNotification("fr", "nearby_activity", "You're nearby: Louvre", "You're close to your next planned activity. Open Roamly when you're ready.");
assert.equal(nearby.title, "À proximité : Louvre");
assert.match(nearby.body, /prochaine activité/);
const startingSoon = localizeActivityNotification("ja", "next_activity", "Starting soon: TeamLab", "📍 Toyosu · starts in 15 min. Tap to open directions.", { locationLabel: "Toyosu", countdownMinutes: 15 });
assert.equal(startingSoon.title, "まもなく開始：TeamLab");
assert.match(startingSoon.body, /あと15分/);
const startingNow = localizeActivityNotification("es", "activity_start", "Now: Museum visit", "Your scheduled activity starts now.");
assert.equal(startingNow.title, "Ahora: Museum visit");
assert.match(startingNow.body, /empieza ahora/);
assert.equal(companionBriefingMessage("fr", "dailyTitle", { destination: "Lisbonne" }), "Aujourd’hui à Lisbonne");
assert.match(companionBriefingMessage("ja", "finalEnd"), /チェックアウト/);

console.log("Scheduled and Companion briefing localization checks passed.");
