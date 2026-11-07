// GAP-CLOSURE WAVE 3 — test-only stand-in for
// @/lib/roamly/itineraryGenerationEmail. Captures every generation
// email the worker/finalization graph "sends" into
// globalThis.__capturedGenerationEmails instead of delivering it.
// getGenerationEmailStatus replicates the real function's metadata
// read (it is a pure function of trip metadata in production too).
function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function getString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getGenerationEmailStatus(metadata, expectedTripId) {
  const root = getRecord(metadata);
  const state = getRecord(root?.generationEmail);
  const stateTripId = getString(state?.tripId);
  const scopedTripId = getString(expectedTripId);
  if (scopedTripId && stateTripId && stateTripId !== scopedTripId) {
    return { tripId: scopedTripId, email_me_when_ready: true };
  }
  return {
    ...(state || {}),
    tripId: stateTripId || scopedTripId || null,
    email_me_when_ready: state?.email_me_when_ready !== false
  };
}

export async function sendStagedGenerationEmail({ tripId, kind }) {
  globalThis.__capturedGenerationEmails.push({ tripId, kind, at: new Date().toISOString() });
  return { ok: true, status: "captured", provider: "gap-capture" };
}

export async function finalizeStagedGenerationNotification({ tripId, kind }) {
  let resolvedKind = kind || null;
  if (!resolvedKind) {
    const db = globalThis.__roamlyFakeSupabase;
    const trip = (db?.tables?.roamly_trips || []).find((row) => row.id === tripId);
    const status = getRecord(getRecord(trip?.metadata)?.generation)?.status;
    if (status === "complete") resolvedKind = "completion";
    else if (status === "failed" || status === "partially_failed") resolvedKind = "failure";
  }
  if (!resolvedKind) return { ok: true, status: "skipped", error: "Generation is not terminal." };
  return sendStagedGenerationEmail({ tripId, kind: resolvedKind });
}

export async function sendPendingStagedGenerationEmail(tripId) {
  return finalizeStagedGenerationNotification({ tripId });
}

export function renderItineraryGenerationEmail() {
  return { subject: "", html: "", text: "" };
}
export function renderSampleItineraryGenerationEmail() {
  return { subject: "", html: "", text: "" };
}
export async function resolveTripOwnerEmail() {
  return { email: null, source: null };
}
