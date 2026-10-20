import assert from "node:assert/strict";
import {
  MAX_COMPANION_EVENT_EMAIL_ATTEMPTS,
  companionEventEmailAllowed,
  companionEventEmailAttempts
} from "../lib/roamly/pushServer.ts";

// Focused simulation of the email decisions inside
// sendScheduledTripNotifications (lib/roamly/pushServer.ts), using the real
// shipped helpers for every decision. The miniature mirrors the dispatcher:
// due events are claimed in scheduled_for order; a dispatch emails only when
// companionEventEmailAllowed passes; a sent email claims the trip's slot for
// the rest of the run; an unaccepted dispatch reschedules +10 minutes and
// persists emailAttempts (when it emailed) or emailCollapsed (when the
// same-trip collapse suppressed its email). Push acceptance ends the event.

function simulate({ stageCount, pushAccepted, runs, runIntervalMin = 15 }) {
  const tripKey = "user-1:trip-1";
  const events = Array.from({ length: stageCount }, (_, i) => ({
    id: `event-${i}`,
    seq: i,
    scheduledFor: -10080 + i * 1440, // stage events, all past-due at t=0
    status: "scheduled",
    metadata: {}
  }));
  let emails = 0;
  const emailsPerRun = [];

  for (let run = 0; run < runs; run += 1) {
    const now = run * runIntervalMin;
    const emailedTrips = new Set();
    let runEmails = 0;
    const due = events
      .filter((event) => event.status === "scheduled" && event.scheduledFor <= now)
      .sort((a, b) => a.scheduledFor - b.scheduledFor || a.seq - b.seq)
      .slice(0, 50);

    for (const event of due) {
      const attempts = companionEventEmailAttempts(event.metadata);
      const collapsed = event.metadata.emailCollapsed === true;
      const tripAlreadyEmailed = emailedTrips.has(tripKey);
      const allowed = companionEventEmailAllowed({ attempts, collapsed, tripAlreadyEmailed });
      let pendingMetadata = null;
      if (allowed) {
        emails += 1;
        runEmails += 1;
        emailedTrips.add(tripKey);
        pendingMetadata = { ...event.metadata, emailAttempts: attempts + 1 };
      } else if (tripAlreadyEmailed && !collapsed) {
        pendingMetadata = { ...event.metadata, emailCollapsed: true };
      }
      if (pushAccepted) {
        event.status = "shown";
      } else {
        event.scheduledFor = now + 10;
        if (pendingMetadata) event.metadata = pendingMetadata;
      }
    }
    emailsPerRun.push(runEmails);
  }
  return { emails, emailsPerRun, events };
}

// Helper truth table.
assert.equal(MAX_COMPANION_EVENT_EMAIL_ATTEMPTS, 3);
assert.equal(companionEventEmailAttempts(null), 0);
assert.equal(companionEventEmailAttempts({}), 0);
assert.equal(companionEventEmailAttempts({ emailAttempts: 2 }), 2);
assert.equal(companionEventEmailAttempts({ emailAttempts: "2" }), 0);
assert.equal(companionEventEmailAllowed({ attempts: 0, collapsed: false, tripAlreadyEmailed: false }), true);
assert.equal(companionEventEmailAllowed({ attempts: 2, collapsed: false, tripAlreadyEmailed: false }), true);
assert.equal(companionEventEmailAllowed({ attempts: 3, collapsed: false, tripAlreadyEmailed: false }), false);
assert.equal(companionEventEmailAllowed({ attempts: 0, collapsed: true, tripAlreadyEmailed: false }), false);
assert.equal(companionEventEmailAllowed({ attempts: 0, collapsed: false, tripAlreadyEmailed: true }), false);

// Scenario A — the Toronto pattern: a trip created near its start, all 7 stage
// events past-due at once, email-only user (push never accepted), queue runs
// every 15 minutes for 3 hours. Old behavior: ~7 emails in ~1.5-3 hours (one
// per event per tick, then unbounded retries). New behavior: bounded.
const a = simulate({ stageCount: 7, pushAccepted: false, runs: 13 });
assert.equal(a.emailsPerRun[0], 1, "first run must collapse the burst to a single email");
assert.ok(a.emails <= MAX_COMPANION_EVENT_EMAIL_ATTEMPTS, `expected <= 3 emails in 3h, got ${a.emails}`);
assert.equal(a.emails, 3, "first event sends 1 + 2 reminders, then stops; siblings collapsed");
assert.equal(a.events.filter((e) => e.metadata.emailCollapsed === true).length, 6, "all 6 sibling stage events collapsed");
assert.equal(a.events[0].metadata.emailAttempts, 3);

// Scenario B — push accepted (PWA user): everything completes in run 1 with
// exactly one email for the whole trip.
const b = simulate({ stageCount: 7, pushAccepted: true, runs: 13 });
assert.equal(b.emails, 1);
assert.ok(b.events.every((e) => e.status === "shown"));

// Scenario C — a single unaccepted event (the repeated "Document check"):
// emails stop at the cap while the event keeps rescheduling for push.
const c = simulate({ stageCount: 1, pushAccepted: false, runs: 40 });
assert.equal(c.emails, MAX_COMPANION_EVENT_EMAIL_ATTEMPTS);
assert.equal(c.events[0].status, "scheduled", "push retries continue after the email cap");
assert.equal(c.events[0].metadata.emailAttempts, MAX_COMPANION_EVENT_EMAIL_ATTEMPTS);
assert.deepEqual(c.emailsPerRun.slice(0, 3), [1, 1, 1]);
assert.ok(c.emailsPerRun.slice(3).every((n) => n === 0), "no emails after the cap");

console.log("companion email discipline checks passed");
console.log(`  scenario A (7 past-due stages, push never accepted, 3h): ${a.emails} emails (run 1: ${a.emailsPerRun[0]})`);
console.log(`  scenario B (7 past-due stages, push accepted): ${b.emails} email`);
console.log(`  scenario C (1 unaccepted event, 40 runs): ${c.emails} emails, event still rescheduling for push`);
