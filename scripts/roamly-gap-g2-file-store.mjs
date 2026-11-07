// GAP-CLOSURE WAVE 3 — G2: file-backed EngineGenerationStore.
//
// Implements the exact EngineGenerationStore contract
// (lib/roamly/engine/generate.ts) that the kf2 suite's in-memory
// store implements, but persists every write to a JSON file on
// disk, so the store survives a SIGKILL of the driver process and
// can be resumed by a different process. Semantics mirror the kf2
// memory store one-for-one:
//   - trip rows carry metadata { generation, zeroEngine } plus the
//     status projections the Supabase store writes;
//   - persistState is a CAS on the row's updated_at revision
//     (throws on conflict), claim is the same CAS returning null;
//   - persistItinerary keeps ONE row per trip (final stamps
//     source "zero-engine");
//   - writePrediction is immutable-first-wins ({ written: false }
//     for a duplicate predictionId).
// Every mutation is written through synchronously (write temp +
// rename) BEFORE the method returns — the store is the process
// boundary, exactly the property the kf2 fabrication relied on,
// except here the boundary is a real file and the kill is real.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const clone = (v) => JSON.parse(JSON.stringify(v));

export class FileEngineStore {
  constructor(filePath) {
    this.filePath = filePath;
    if (!existsSync(filePath)) {
      this.flush({ rev: 0, trips: {}, itineraries: {}, predictions: {} });
    }
  }

  read() {
    return JSON.parse(readFileSync(this.filePath, "utf8"));
  }

  flush(data) {
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.filePath);
  }

  statusFor(state) {
    return state.status === "complete"
      ? "generated"
      : state.status === "failed" || state.status === "partially_failed"
        ? "draft"
        : "generating";
  }

  writeRow(data, trip, state, run) {
    data.rev += 1;
    const row = data.trips[trip.id];
    const metadata = {
      ...(row ? row.metadata : {}),
      generation: clone(state),
      zeroEngine: clone(run)
    };
    const next = {
      id: trip.id,
      user_id: trip.user_id,
      metadata,
      status: this.statusFor(state),
      itinerary_status: this.statusFor(state),
      itinerary_generated_at: row ? row.itinerary_generated_at : null,
      updated_at: `rev-${data.rev}`
    };
    data.trips[trip.id] = next;
    return clone(next);
  }

  seedTrip(tripId, userId) {
    const data = this.read();
    data.rev += 1;
    data.trips[tripId] = {
      id: tripId,
      user_id: userId,
      metadata: {},
      status: "generating",
      itinerary_status: "generating",
      itinerary_generated_at: null,
      updated_at: `rev-${data.rev}`
    };
    this.flush(data);
  }

  async loadTrip(tripId, userId) {
    const data = this.read();
    const row = data.trips[tripId];
    if (!row || (userId && row.user_id !== userId)) throw new Error(`trip ${tripId} not found`);
    return clone(row);
  }

  async persistState(trip, state, run) {
    const data = this.read();
    const row = data.trips[trip.id];
    if (!row || row.updated_at !== trip.updated_at) throw new Error("CAS conflict on persistState");
    const next = this.writeRow(data, trip, state, run);
    this.flush(data);
    return next;
  }

  async claim(trip, state, run) {
    const data = this.read();
    const row = data.trips[trip.id];
    if (!row || row.updated_at !== trip.updated_at) return null;
    const next = this.writeRow(data, trip, state, run);
    this.flush(data);
    return next;
  }

  async persistItinerary(trip, itinerary, final) {
    const data = this.read();
    data.itineraries[trip.id] = {
      trip_id: trip.id,
      user_id: trip.user_id,
      full_json: clone(itinerary),
      source: final ? "zero-engine" : null,
      final
    };
    this.flush(data);
  }

  async writePrediction(record) {
    const data = this.read();
    if (data.predictions[record.predictionId]) return { written: false };
    data.predictions[record.predictionId] = clone(record);
    this.flush(data);
    return { written: true };
  }

  async markFreeItineraryUsed() {
    return { ok: true };
  }

  async lockItinerary() {
    return {};
  }
}
