import assert from "node:assert/strict";
import {
  addCalendarDays,
  clockToMinutes,
  diffCalendarDays,
  formatInstant,
  instantToLocal,
  isLocalDate,
  isUtcInstant,
  isValidTimeZone,
  localDayLengthMinutes,
  localToInstant,
  localToInstantString,
  minutesToClock,
  normalizePlanTime,
  parseInstant,
  utcOffsetMinutesAt,
  weekdayOf
} from "@/lib/roamly/engine/time.ts";

// Phase 1 (DESIGN-PRODUCTION.md §2.1): THE canonical time adapter.
// These checks pin the adapter's documented policies: shadow
// minutes-after-midnight semantics, DST gap shift-forward, fall-back
// first-occurrence default, skipped-date throw, civil-date math that
// never touches milliseconds-per-day.

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
function deepEq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
}
function throws(fn, pattern, label) {
  count += 1;
  assert.throws(fn, pattern, label);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

/* --- Shadow minutes/clock parity (util.fmt semantics) -------------- */
eq(minutesToClock(0), "00:00", "midnight");
eq(minutesToClock(59), "00:59", "minute padding");
eq(minutesToClock(60), "01:00", "hour rollover");
eq(minutesToClock(940), "15:40", "part2 fixture flight departure 15:40 = 940");
eq(minutesToClock(1439), "23:59", "last minute of day");
eq(minutesToClock(1500), "25:00", "after-midnight end keeps shadow fmt (>23h)");
eq(clockToMinutes("15:40"), 940, "clock -> minutes");
eq(clockToMinutes("00:00"), 0, "clock midnight");
throws(() => clockToMinutes("9:99"), /invalid clock/, "bad clock rejected");

/* --- Civil-date arithmetic (no ms-per-day anywhere) ---------------- */
eq(addCalendarDays("2026-02-28", 1), "2026-03-01", "non-leap February");
eq(addCalendarDays("2024-02-28", 1), "2024-02-29", "leap February");
eq(addCalendarDays("2026-12-31", 1), "2027-01-01", "year rollover");
eq(addCalendarDays("2026-03-01", -1), "2026-02-28", "negative step");
eq(diffCalendarDays("2026-10-23", "2026-10-30"), 7, "diff forward");
eq(diffCalendarDays("2026-10-30", "2026-10-23"), -7, "diff backward");
eq(diffCalendarDays("2026-10-23", "2026-10-23"), 0, "diff same day");
eq(weekdayOf("1970-01-01"), 4, "epoch was a Thursday");
eq(weekdayOf("2026-10-21"), 3, "2026-10-21 is a Wednesday");
deepEq(normalizePlanTime("2026-10-23", 1500), { date: "2026-10-24", minutes: 60 }, "rollover past midnight");
deepEq(normalizePlanTime("2026-10-23", -30), { date: "2026-10-22", minutes: 1410 }, "negative minutes roll back a day");
deepEq(normalizePlanTime("2026-10-23", 940), { date: "2026-10-23", minutes: 940 }, "in-range unchanged");

/* --- Guards --------------------------------------------------------- */
ok(isLocalDate("2026-10-23"), "valid date");
ok(!isLocalDate("2026-02-30"), "Feb 30 does not exist");
ok(!isLocalDate("23-10-2026"), "wrong shape rejected");
ok(isUtcInstant("2026-10-23T18:40:00.000Z"), "valid instant");
ok(!isUtcInstant("2026-10-23 18:40"), "naive datetime rejected");
ok(isValidTimeZone("America/Moncton"), "IANA zone valid");
ok(!isValidTimeZone("America/Nowhere"), "bogus zone rejected");
eq(formatInstant(parseInstant("2026-10-23T18:40:00.000Z")), "2026-10-23T18:40:00.000Z", "instant parse/format round-trip");

/* --- Plain conversions, no DST involved ----------------------------- */
eq(localToInstant("2026-01-15", 720, "America/Moncton"), Date.UTC(2026, 0, 15, 16, 0), "Moncton winter noon = 16:00Z (AST, UTC-4)");
eq(localToInstant("2026-07-15", 720, "America/Moncton"), Date.UTC(2026, 6, 15, 15, 0), "Moncton summer noon = 15:00Z (ADT, UTC-3)");
eq(utcOffsetMinutesAt(Date.UTC(2026, 0, 15, 12), "America/Moncton"), -240, "AST offset");
eq(utcOffsetMinutesAt(Date.UTC(2026, 6, 15, 12), "America/Moncton"), -180, "ADT offset");
eq(localToInstant("2026-07-15", 540, "Asia/Tokyo"), Date.UTC(2026, 6, 15, 0, 0), "Tokyo 09:00 = 00:00Z");
eq(localToInstant("2026-07-15", 540, "UTC"), Date.UTC(2026, 6, 15, 9, 0), "UTC identity");
deepEq(
  instantToLocal(Date.UTC(2026, 0, 15, 16, 0), "America/Moncton"),
  { date: "2026-01-15", minutes: 720, clock: "12:00", offsetMinutes: -240 },
  "instant -> local parts"
);
eq(
  localToInstantString("2026-10-23", 940, "America/Halifax"),
  "2026-10-23T18:40:00.000Z",
  "part2 scenario: AC 665 departs Halifax 15:40 ADT = 18:40Z"
);

/* --- DST spring forward: America/Moncton 2026-03-08 (02:00 -> 03:00) */
eq(localDayLengthMinutes("2026-03-08", "America/Moncton"), 1380, "spring day is 23 hours");
eq(localDayLengthMinutes("2026-03-09", "America/Moncton"), 1440, "day after is normal");
eq(localToInstant("2026-03-08", 90, "America/Moncton"), Date.UTC(2026, 2, 8, 5, 30), "01:30 AST = 05:30Z");
eq(localToInstant("2026-03-08", 210, "America/Moncton"), Date.UTC(2026, 2, 8, 6, 30), "03:30 ADT = 06:30Z");
const gapResult = localToInstant("2026-03-08", 150, "America/Moncton"); // 02:30 does not exist
eq(gapResult, Date.UTC(2026, 2, 8, 6, 30), "gap policy: 02:30 shifts forward to 03:30 ADT");
eq(instantToLocal(gapResult, "America/Moncton").minutes, 210, "gap result reads back as 03:30 same date");
eq(instantToLocal(gapResult, "America/Moncton").date, "2026-03-08", "gap shift stays on the same date");

/* --- DST fall back: America/Moncton 2026-11-01 (02:00 -> 01:00) ----- */
eq(localDayLengthMinutes("2026-11-01", "America/Moncton"), 1500, "fall day is 25 hours");
eq(localToInstant("2026-11-01", 30, "America/Moncton"), Date.UTC(2026, 10, 1, 3, 30), "00:30 ADT = 03:30Z");
eq(localToInstant("2026-11-01", 90, "America/Moncton"), Date.UTC(2026, 10, 1, 4, 30), "ambiguous 01:30 defaults to FIRST occurrence (ADT)");
eq(localToInstant("2026-11-01", 90, "America/Moncton", { ambiguous: "second" }), Date.UTC(2026, 10, 1, 5, 30), "ambiguous 01:30 second occurrence (AST)");
eq(instantToLocal(Date.UTC(2026, 10, 1, 4, 30), "America/Moncton").minutes, 90, "first 01:30 reads back 01:30");
eq(instantToLocal(Date.UTC(2026, 10, 1, 5, 30), "America/Moncton").minutes, 90, "second 01:30 also reads back 01:30 (documented repeated hour)");
eq(localToInstant("2026-11-01", 150, "America/Moncton"), Date.UTC(2026, 10, 1, 6, 30), "02:30 AST only = 06:30Z");

/* --- Southern hemisphere: Australia/Sydney -------------------------- */
/* DST ends Sun 2026-04-05 03:00 AEDT -> 02:00 AEST; starts Sun 2026-10-04 02:00 -> 03:00. */
eq(localDayLengthMinutes("2026-04-05", "Australia/Sydney"), 1500, "Sydney fall-back day is 25 hours");
eq(localToInstant("2026-04-05", 150, "Australia/Sydney"), Date.UTC(2026, 3, 4, 15, 30), "Sydney ambiguous 02:30 first = AEDT (+11)");
eq(localToInstant("2026-04-05", 150, "Australia/Sydney", { ambiguous: "second" }), Date.UTC(2026, 3, 4, 16, 30), "Sydney ambiguous 02:30 second = AEST (+10)");
eq(localDayLengthMinutes("2026-10-04", "Australia/Sydney"), 1380, "Sydney spring-forward day is 23 hours");
eq(localToInstant("2026-10-04", 150, "Australia/Sydney"), Date.UTC(2026, 9, 3, 16, 30), "Sydney gap 02:30 shifts to 03:30 AEDT");

/* --- Date line ------------------------------------------------------- */
deepEq(
  (({ date, minutes }) => ({ date, minutes }))(instantToLocal(Date.UTC(2026, 0, 1, 10, 0), "Pacific/Kiritimati")),
  { date: "2026-01-02", minutes: 0 },
  "Kiritimati (UTC+14): 10:00Z Jan 1 is already Jan 2"
);
eq(instantToLocal(Date.UTC(2026, 0, 1, 10, 0), "America/New_York").date, "2026-01-01", "same instant is still Jan 1 in New York");
eq(instantToLocal(Date.UTC(2026, 0, 1, 10, 0), "America/New_York").minutes, 300, "New York reads 05:00");

/* --- Skipped civil date: Pacific/Apia skipped 2011-12-30 ------------ */
throws(() => localToInstant("2011-12-30", 600, "Pacific/Apia"), /nonexistent local date/, "Apia 2011-12-30 never existed — throws, never silently remaps");
eq(instantToLocal(localToInstant("2011-12-29", 600, "Pacific/Apia"), "Pacific/Apia").date, "2011-12-29", "day before the skip round-trips");
eq(instantToLocal(localToInstant("2011-12-31", 600, "Pacific/Apia"), "Pacific/Apia").date, "2011-12-31", "day after the skip round-trips");

/* --- Round-trip sweep ------------------------------------------------ */
const sweepZones = [
  "America/Moncton",
  "America/Halifax",
  "Europe/London",
  "Australia/Sydney",
  "Pacific/Kiritimati",
  "Asia/Tokyo",
  "UTC"
];
const sweepDates = [
  "2026-01-15",
  "2026-03-08", // Moncton spring forward
  "2026-04-05", // Sydney fall back
  "2026-07-15",
  "2026-10-04", // Sydney spring forward
  "2026-11-01", // Moncton fall back
  "2026-12-31"
];
const sweepMinutes = [0, 390, 720, 1439]; // avoids every zone's 02:00-03:00 gap/overlap hour
for (const tz of sweepZones) {
  for (const date of sweepDates) {
    for (const minutes of sweepMinutes) {
      const back = instantToLocal(localToInstant(date, minutes, tz), tz);
      count += 1;
      assert.deepEqual(
        { date: back.date, minutes: back.minutes },
        { date, minutes },
        `round-trip ${tz} ${date} ${minutes}`
      );
    }
  }
}

console.log(`roamly wiring time checks: ${count}/${count} PASS`);
