import assert from "node:assert/strict";
import {
  MAX_COMPANION_EVENT_EMAIL_ATTEMPTS,
  companionEventEmailAllowed,
  companionEventEmailAttempts,
  companionEventEmailSent
} from "../lib/roamly/pushServer.ts";

// Focused simulation of the email decisions inside
// sendScheduledTripNotifications (lib/roamly/pushServer.ts), using the real
// shipped helpers for every decision. The miniature mirrors the dispatcher
// after the Defect 5 fix (owner verdict 2026-10-23: one reminder = one
// email): due events are claimed in scheduled_for order; a dispatch emails
// only when companionEventEmailAllowed passes — which requires that the
// event has never delivered an email (no metadata.emailSentAt); an attempted
// send claims the trip's slot for the rest of the run whether it delivers
// or fails; a DELIVERED send stamps emailSentAt and the event never emails
// again; a FAILED send only persists emailAttempts and may be retried on a
// later run, bounded by MAX_COMPANION_EVENT_EMAIL_ATTEMPTS total attempts;
// a sibling passed over because of the same-trip collapse is marked
// metadata.emailCollapsed. Push acceptance still ends the event.

function simulate({ stageCount, pushAccepted, runs, runIntervalMin = 15, emailFailures = 0 }) {
  const tripKey = "user-1:trip-1";
  const events = Array.from({ length: stageCount }, (_, i) => ({
    id: `event-${i}`,
    seq: i,
    scheduledFor: -10080 + i * 1440, // stage events, all past-due at t=0
    status: "scheduled",
    metadata: {}
  }));
  let emails = 0; // delivered emails
  let sendAttempts = 0; // every send invocation, delivered or failed
  let failuresLeft = emailFailures;
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
      const emailSent = companionEventEmailSent(event.metadata);
      const collapsed = event.metadata.emailCollapsed === true;
      const tripAlreadyEmailed = emailedTrips.has(tripKey);
      const allowed = companionEventEmailAllowed({ attempts, emailSent, collapsed, tripAlreadyEmailed });
      let pendingMetadata = null;
      if (allowed) {
        sendAttempts += 1;
        emailedTrips.add(tripKey); // any emailResult claims the trip slot for the run
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          pendingMetadata = { ...event.metadata, emailAttempts: attempts + 1 };
        } else {
          emails += 1;
          runEmails += 1;
          pendingMetadata = { ...event.metadata, emailAttempts: attempts + 1, emailSentAt: `run-${run}` };
        }
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
  return { emails, sendAttempts, emailsPerRun, events };
}

// Helper truth table.
assert.equal(MAX_COMPANION_EVENT_EMAIL_ATTEMPTS, 3);
assert.equal(companionEventEmailAttempts(null), 0);
assert.equal(companionEventEmailAttempts({}), 0);
assert.equal(companionEventEmailAttempts({ emailAttempts: 2 }), 2);
assert.equal(companionEventEmailAttempts({ emailAttempts: "2" }), 0);
assert.equal(companionEventEmailSent(null), false);
assert.equal(companionEventEmailSent({}), false);
assert.equal(companionEventEmailSent({ emailSentAt: "2026-10-23T14:58:00.000Z" }), true);
assert.equal(companionEventEmailSent({ emailSentAt: "" }), false);
assert.equal(companionEventEmailSent({ emailSentAt: 42 }), false);
assert.equal(companionEventEmailAllowed({ attempts: 0, emailSent: false, collapsed: false, tripAlreadyEmailed: false }), true);
assert.equal(companionEventEmailAllowed({ attempts: 2, emailSent: false, collapsed: false, tripAlreadyEmailed: false }), true,
  "failed attempts below the cap may still retry — nothing was delivered yet");
assert.equal(companionEventEmailAllowed({ attempts: 3, emailSent: false, collapsed: false, tripAlreadyEmailed: false }), false,
  "the cap bounds total attempts");
assert.equal(companionEventEmailAllowed({ attempts: 0, emailSent: true, collapsed: false, tripAlreadyEmailed: false }), false,
  "DEFECT 5: an event that already delivered its one email never emails again");
assert.equal(companionEventEmailAllowed({ attempts: 1, emailSent: true, collapsed: false, tripAlreadyEmailed: false }), false);
assert.equal(companionEventEmailAllowed({ attempts: 0, emailSent: false, collapsed: true, tripAlreadyEmailed: false }), false);
assert.equal(companionEventEmailAllowed({ attempts: 0, emailSent: false, collapsed: false, tripAlreadyEmailed: true }), false);

// Scenario A — the Toronto pattern: a trip created near its start, all 7 stage
// events past-due at once, email-only user (push never accepted), queue runs
// every 15 minutes for 3 hours. Old behavior after PR #57: 3 emails (the
// first event's 1 + 2 "reminders"). Defect 5 behavior: exactly ONE email for
// the whole burst, then push-only retries.
const a = simulate({ stageCount: 7, pushAccepted: false, runs: 13 });
assert.equal(a.emailsPerRun[0], 1, "first run must collapse the burst to a single email");
assert.equal(a.emails, 1, "one delivered email total — never the old 3");
assert.equal(a.sendAttempts, 1, "the sender is never even invoked again after the delivery");
assert.ok(a.emailsPerRun.slice(1).every((n) => n === 0), "no emails after run 1");
assert.equal(a.events.filter((e) => e.metadata.emailCollapsed === true).length, 6, "all 6 sibling stage events collapsed");
assert.equal(a.events[0].metadata.emailAttempts, 1);
assert.equal(companionEventEmailSent(a.events[0].metadata), true, "the emailed event carries emailSentAt");

// Scenario B — push accepted (PWA user): everything completes in run 1 with
// exactly one email for the whole trip.
const b = simulate({ stageCount: 7, pushAccepted: true, runs: 13 });
assert.equal(b.emails, 1);
assert.ok(b.events.every((e) => e.status === "shown"));

// Scenario C — a single unaccepted event (the owner's Montreal
// one_week_before, 2026-10-23: three identical emails at 10:58 / 11:15 /
// 11:30 ADT under the old code). Now: one email on run 1, then the event
// keeps rescheduling for push and never emails again.
const c = simulate({ stageCount: 1, pushAccepted: false, runs: 40 });
assert.equal(c.emails, 1, "exactly one email, ever");
assert.equal(c.sendAttempts, 1);
assert.deepEqual(c.emailsPerRun.slice(0, 3), [1, 0, 0]);
assert.ok(c.emailsPerRun.slice(1).every((n) => n === 0), "no repeat emails on later runs");
assert.equal(c.events[0].status, "scheduled", "push retries continue after the one email");
assert.equal(c.events[0].metadata.emailAttempts, 1);
assert.equal(companionEventEmailSent(c.events[0].metadata), true);

// Scenario D — the first send FAILS (nothing delivered): the failure is
// retried on the next run, the retry delivers the event's one email, and
// no send is attempted after that. Total delivered stays exactly 1.
const d = simulate({ stageCount: 1, pushAccepted: false, runs: 10, emailFailures: 1 });
assert.equal(d.emails, 1, "a failed first send still ends with exactly one delivered email");
assert.equal(d.sendAttempts, 2, "one failed attempt + one delivered retry, then never again");
assert.equal(d.events[0].metadata.emailAttempts, 2);
assert.equal(companionEventEmailSent(d.events[0].metadata), true);
assert.equal(d.events[0].status, "scheduled", "push retries continue");

// Scenario E — sends keep failing: attempts stop at the cap and the event
// delivers nothing rather than emailing forever.
const e = simulate({ stageCount: 1, pushAccepted: false, runs: 10, emailFailures: 99 });
assert.equal(e.emails, 0, "no delivery, no email");
assert.equal(e.sendAttempts, MAX_COMPANION_EVENT_EMAIL_ATTEMPTS, "failed attempts are bounded by the cap");
assert.equal(companionEventEmailSent(e.events[0].metadata), false);
assert.equal(e.events[0].status, "scheduled", "push retries continue even after email attempts are exhausted");

console.log("companion email discipline checks passed");
console.log(`  scenario A (7 past-due stages, push never accepted, 3h): ${a.emails} email delivered, ${a.sendAttempts} send attempt (run 1: ${a.emailsPerRun[0]})`);
console.log(`  scenario B (7 past-due stages, push accepted): ${b.emails} email`);
console.log(`  scenario C (1 unaccepted event, 40 runs — the Montreal pattern): ${c.emails} email, event still rescheduling for push`);
console.log(`  scenario D (first send fails, then succeeds): ${d.emails} email delivered across ${d.sendAttempts} attempts`);
console.log(`  scenario E (sends always fail): ${e.emails} emails, attempts capped at ${e.sendAttempts}`);
