// scripts/roamly-stale-processing-sweep-checks.mjs
import assert from "node:assert/strict";
import {
  COMPANION_PROCESSING_STALE_MS,
  recoverStaleProcessingCompanionEvents,
} from "../lib/roamly/pushServer.ts";

function createFakeSupabase(rows, options = {}) {
  const { isErrorMode = false } = options;

  return {
    from(tableName) {
      let isUpdate = false;
      let updatePatch = null;
      let isSelect = false;
      const filters = [];
      let limitCount = null;

      const builder = {
        select(cols) {
          isSelect = true;
          return builder;
        },
        update(patch) {
          isUpdate = true;
          updatePatch = patch;
          return builder;
        },
        eq(col, val) {
          filters.push({ op: "eq", col, val });
          return builder;
        },
        lt(col, val) {
          filters.push({ op: "lt", col, val });
          return builder;
        },
        limit(n) {
          limitCount = n;
          return builder;
        },
        then(onFulfilled, onRejected) {
          return new Promise((resolve) => {
            if (isErrorMode && isSelect) {
              resolve({ data: null, error: { message: "fake db error" } });
              return;
            }

            if (isSelect) {
              let result = rows.filter((row) =>
                filters.every((f) => {
                  if (f.op === "eq") return row[f.col] === f.val;
                  if (f.op === "lt") return row[f.col] < f.val;
                  return true;
                })
              );
              if (limitCount !== null) {
                result = result.slice(0, limitCount);
              }
              const data = result.map((r) => ({ id: r.id, metadata: r.metadata }));
              resolve({ data, error: null });
              return;
            }

            if (isUpdate) {
              rows.forEach((row) => {
                const matches = filters.every((f) => {
                  if (f.op === "eq") return row[f.col] === f.val;
                  if (f.op === "lt") return row[f.col] < f.val;
                  return true;
                });
                if (matches) {
                  Object.assign(row, updatePatch);
                }
              });
              resolve({ data: null, error: null });
              return;
            }

            resolve({ data: null, error: null });
          }).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };
}

// Assert constant value
assert.equal(COMPANION_PROCESSING_STALE_MS, 60 * 60_000);
console.log("ok COMPANION_PROCESSING_STALE_MS constant is 1 hour");

const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
const fiveMinsAgo = new Date(Date.now() - 5 * 60_000).toISOString();

const lisbonMetadata = {
  emailDeliveryState: "provider_accepted",
  emailSentAt: "2026-11-19T02:25:14Z",
  pushAttempts: 154,
};
const lisbonMetadataDeepCopy = JSON.parse(JSON.stringify(lisbonMetadata));

const recentMetadata = {
  emailDeliveryState: "provider_accepted",
  emailSentAt: "2026-11-19T02:25:14Z",
  pushAttempts: 3,
};

const tbilisiMetadata = {
  pushAttempts: 296,
};
const tbilisiMetadataDeepCopy = JSON.parse(JSON.stringify(tbilisiMetadata));

const rows = [
  {
    id: "lisbon-event-1",
    trip_id: "lisbon-123",
    event_type: "currency_payment",
    status: "processing",
    scheduled_for: twoHoursAgo,
    metadata: lisbonMetadata,
  },
  {
    id: "recent-event-1",
    status: "processing",
    scheduled_for: fiveMinsAgo,
    metadata: recentMetadata,
  },
  {
    id: "tbilisi-event-1",
    event_type: "document_check",
    status: "scheduled",
    scheduled_for: twoHoursAgo,
    metadata: tbilisiMetadata,
  },
];

const fakeSupabase = createFakeSupabase(rows);

const mainResult = await recoverStaleProcessingCompanionEvents(fakeSupabase);

assert.equal(mainResult.failed, 0);

// (a) Lisbon row recovered
assert.equal(mainResult.recovered, 1);
assert.equal(rows[0].status, "scheduled");
console.log("ok (a) Lisbon row recovered to scheduled status");

// (b) Recent row left in processing
assert.equal(rows[1].status, "processing");
console.log("ok (b) recent processing row was not recovered");

// (c) Lisbon metadata unchanged
assert.deepEqual(rows[0].metadata, lisbonMetadataDeepCopy);
assert.equal(rows[0].metadata.emailDeliveryState, "provider_accepted");
assert.equal(rows[0].metadata.emailSentAt, "2026-11-19T02:25:14Z");
console.log("ok (c) Lisbon row metadata is byte-for-byte identical");

// (d) Tbilisi-shaped row unchanged
assert.equal(rows[2].status, "scheduled");
assert.deepEqual(rows[2].metadata, tbilisiMetadataDeepCopy);
console.log("ok (d) Tbilisi-shaped row status and metadata unchanged");

// (e) Error mode check
const errorFakeSupabase = createFakeSupabase(rows, { isErrorMode: true });
let errorResult;
try {
  errorResult = await recoverStaleProcessingCompanionEvents(errorFakeSupabase);
} catch (err) {
  assert.fail("recoverStaleProcessingCompanionEvents should not throw on database error");
}
assert.deepEqual(errorResult, { recovered: 0, failed: 0 });
console.log("ok (e) error mode returns { recovered: 0, failed: 0 } without throwing");

console.log("All stale-processing sweep checks passed.");
