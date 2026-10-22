import { haversineKm } from "@/lib/roamly/engine/util";
import type { EngineCandidate, EnginePack } from "@/lib/roamly/engine/util";

/*
 * anchors — hotel anchor scoring + the transport estimate service
 * (Phase 2 port of the shadow zero-engine's anchors.mjs).
 *
 * scoreStays is a HELPER (production design): it ranks candidate
 * stays by their surroundings in the pack, never by price (open data
 * carries none). It informs anchor choice when no booking exists —
 * the production day anchor is normally the traveler's BOOKED stay,
 * which the solver accepts as a pinned anchor (solver.ts
 * SolveSpec.pinnedStay); scoreStays never overrides a booking.
 *
 * transportArgument is REDESIGNED (PORTABILITY verdict: REDESIGN —
 * the shadow baked one route, one party, one date context, and its
 * prices into the module). `estimateTransport` is a parameterized
 * transport-estimate service: every number arrives as a labeled
 * assumption from the caller, both proposals are scored with the
 * owner's all-in cost rule (effective cost = money + hours ×
 * value-of-time × travelers), every assumption stays labeled
 * ESTIMATED in the output, and when the effective costs are close
 * BOTH options are emitted for the traveler to choose.
 */

export interface ScoredStay extends EngineCandidate {
  walkableSights: number;
  walkableFood: number;
  distCenterKm: number;
  quietProxy: number;
  anchorScore: number;
}

export function scoreStays(pack: EnginePack): ScoredStay[] {
  const sights = pack.sights || [];
  const foods = pack.foods || [];
  const scored = (pack.stays || []).map((stay) => {
    const walkableSights = sights.filter((s) => haversineKm(stay.pos, s.pos) <= 0.8).length;
    const walkableFood = foods.filter((f) => haversineKm(stay.pos, f.pos) <= 0.5).length;
    const distCenterKm = haversineKm(stay.pos, pack.center);
    // Quiet PROXY (labeled as such): fewer late-night food venues
    // close by.
    const venuesWithin200m = foods.filter((f) => haversineKm(stay.pos, f.pos) <= 0.2).length;
    const quietProxy = Math.max(0, 10 - venuesWithin200m);
    const score = walkableSights * 3 + walkableFood * 1.5 - distCenterKm * 2 + quietProxy * 0.3;
    return {
      ...stay,
      walkableSights,
      walkableFood,
      distCenterKm: +distCenterKm.toFixed(2),
      quietProxy,
      anchorScore: +score.toFixed(1)
    };
  }).sort((a, b) => b.anchorScore - a.anchorScore || a.name.localeCompare(b.name));
  return scored;
}

/* ------------------------------------------------------------------ */
/* Transport estimate service (REDESIGNED — parameterized)             */
/* ------------------------------------------------------------------ */

export interface TransportAssumption {
  value: number;
  basis: string;
}

export interface TransportEstimateInput {
  /** Display labels for the scenario line, e.g. "Saint John, NB". */
  originLabel: string;
  destinationLabel: string;
  tripDays: number;
  currency?: string; // default "CAD" (the money symbol in prose is $)
  roadDistanceKm: TransportAssumption;
  driveHoursDoorToDoor: TransportAssumption;
  fuelPer100Km: TransportAssumption;
  fuelPricePerL: TransportAssumption;
  parkingPerDay: TransportAssumption;
  parkingDays: TransportAssumption;
  flightFarePerPerson: TransportAssumption;
  flightHoursDoorToDoor: TransportAssumption;
  airportTransfersTotal: TransportAssumption;
  travelers: TransportAssumption;
  valueOfTimePerHourPerPerson: TransportAssumption;
}

export interface TransportOptionEstimate {
  money: number;
  hours: number;
  effectiveCost: number;
  case: string;
}

export interface TransportEstimate {
  scenario: string;
  assumptions: Record<string, TransportAssumption>;
  drive: TransportOptionEstimate;
  flight: TransportOptionEstimate;
  guardianRule: string;
  verdict: string;
  bothOptionsEmitted: boolean;
  arrivalDayConsolidation: { flight: string; drive: string };
}

/**
 * The drive-vs-flight scored argument, as a parameterized service.
 * Every number is a caller-supplied assumption and is labeled in the
 * output. Effective cost = all-in money + (hours × value-of-time ×
 * travelers); if the effective costs are within 20%, BOTH options
 * are emitted for the traveler to choose.
 */
export function estimateTransport(input: TransportEstimateInput): TransportEstimate {
  const A: Record<string, TransportAssumption> = {
    roadDistanceKm: input.roadDistanceKm,
    driveHoursDoorToDoor: input.driveHoursDoorToDoor,
    fuelPer100Km: input.fuelPer100Km,
    fuelPricePerL: input.fuelPricePerL,
    parkingPerDay: input.parkingPerDay,
    parkingDays: input.parkingDays,
    flightFarePerPerson: input.flightFarePerPerson,
    flightHoursDoorToDoor: input.flightHoursDoorToDoor,
    airportTransfersTotal: input.airportTransfersTotal,
    travelers: input.travelers,
    valueOfTimePerHourPerPerson: input.valueOfTimePerHourPerPerson
  };
  const travelers = A.travelers.value;
  const valueOfTime = A.valueOfTimePerHourPerPerson.value;
  const fuelTotal = (A.roadDistanceKm.value / 100) * A.fuelPer100Km.value * A.fuelPricePerL.value;
  const driveMoney = fuelTotal + A.parkingPerDay.value * A.parkingDays.value;
  const flightMoney = A.flightFarePerPerson.value * travelers + A.airportTransfersTotal.value;
  const driveEffective = driveMoney + A.driveHoursDoorToDoor.value * valueOfTime * travelers;
  const flightEffective = flightMoney + A.flightHoursDoorToDoor.value * valueOfTime * travelers;
  const gap = Math.abs(driveEffective - flightEffective);
  const close = gap <= 0.2 * Math.max(driveEffective, flightEffective);
  const moneyGap = Math.abs(flightMoney - driveMoney);
  const hoursSaved = A.driveHoursDoorToDoor.value - A.flightHoursDoorToDoor.value;
  return {
    scenario: `${input.originLabel} -> ${input.destinationLabel} — flight vs drive, ${travelers} travelers, ${input.tripDays}-day trip`,
    assumptions: A,
    drive: {
      money: +driveMoney.toFixed(2),
      hours: A.driveHoursDoorToDoor.value,
      effectiveCost: +driveEffective.toFixed(2),
      case:
        driveMoney <= flightMoney
          ? `Driving wins on money by $${moneyGap.toFixed(0)} — but it spends ${A.driveHoursDoorToDoor.value} hours of the trip on the road, each way framing the arrival day as a write-off.`
          : `Driving costs $${moneyGap.toFixed(0)} more than flying and spends ${A.driveHoursDoorToDoor.value} hours of the trip on the road, each way framing the arrival day as a write-off.`
    },
    flight: {
      money: +flightMoney.toFixed(2),
      hours: A.flightHoursDoorToDoor.value,
      effectiveCost: +flightEffective.toFixed(2),
      case:
        flightMoney >= driveMoney
          ? `Flying costs $${moneyGap.toFixed(0)} more but buys back ${hoursSaved.toFixed(1)} hours and arrives with energy left — on a tight budget with a long trip ahead, the drive is the justifiable argue-back.`
          : `Flying wins on money by $${moneyGap.toFixed(0)} and buys back ${hoursSaved.toFixed(1)} hours, arriving with energy left.`
    },
    guardianRule:
      "effective cost = all-in money + (hours x value-of-time x travelers); if effective costs are within 20%, BOTH options are emitted",
    verdict: close
      ? "CLOSE — both options emitted for the traveler to choose"
      : driveEffective < flightEffective
        ? "drive scores better on effective cost"
        : "flight scores better on effective cost",
    bothOptionsEmitted: close,
    arrivalDayConsolidation: {
      flight: `land ~${A.flightHoursDoorToDoor.value}h after leaving home -> transfer -> check-in -> only a gentle evening walk is honestly schedulable`,
      drive: `after ${A.driveHoursDoorToDoor.value}h on the road the arrival day holds nothing but check-in and food — the plan must not pretend otherwise`
    }
  };
}
