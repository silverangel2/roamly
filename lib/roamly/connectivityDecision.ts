import type { TripGeography } from "@/lib/roamly/tripGeography";

export type ConnectivityFact = "YES" | "NO" | "UNKNOWN";
export type CoverageStatus = "ALL_DESTINATIONS" | "PARTIAL" | "NONE" | "UNKNOWN";
export type ConnectivityDecisionState =
  | "NOT_NEEDED"
  | "CURRENT_PLAN_LIKELY_SUFFICIENT"
  | "ALTERNATIVE_CONNECTIVITY_WORTH_EVALUATING"
  | "ESIM_POTENTIALLY_SUITABLE"
  | "ESIM_NOT_USABLE"
  | "INSUFFICIENT_INFORMATION";

export type ConnectivityDecisionReason =
  | "DOMESTIC_TRIP"
  | "INTERNATIONAL_CONNECTIVITY_RELEVANT"
  | "MULTI_COUNTRY_COVERAGE_REQUIRED"
  | "CURRENT_PLAN_COVERS_ALL_DESTINATIONS"
  | "CURRENT_PLAN_PARTIAL_COVERAGE"
  | "CURRENT_PLAN_NO_COVERAGE"
  | "ROAMING_STATUS_UNKNOWN"
  | "DATA_ALLOWANCE_UNKNOWN"
  | "ESIM_SUPPORTED"
  | "ESIM_UNSUPPORTED"
  | "ESIM_SUPPORT_UNKNOWN"
  | "DEVICE_UNLOCKED"
  | "DEVICE_LOCKED"
  | "DEVICE_UNLOCK_STATUS_UNKNOWN"
  | "VOICE_REQUIRED"
  | "SMS_REQUIRED"
  | "HOTSPOT_REQUIRED"
  | "INSUFFICIENT_CONNECTIVITY_FACTS";

export type ConnectivityNeeds = {
  expectedDataUse?: string | null;
  callsNeeded?: ConnectivityFact;
  smsNeeded?: ConnectivityFact;
  hotspotNeeded?: ConnectivityFact;
  continuousConnectivityImportance?: ConnectivityFact;
};

export type ConnectivityPlanFacts = {
  destinationCoverage?: CoverageStatus;
  coveredCountryCodes?: string[] | null;
  roamingIncluded?: ConnectivityFact;
  dataAllowanceAdequate?: ConnectivityFact;
  dataAllowanceKnown?: ConnectivityFact;
};

export type ConnectivityDecisionInput = {
  tripGeography: TripGeography;
  device?: { esimSupport?: ConnectivityFact; unlocked?: ConnectivityFact } | null;
  currentPlan?: ConnectivityPlanFacts | null;
  travelerNeeds?: ConnectivityNeeds | null;
  tripDurationDays?: number | null;
};

export type ConnectivityDecision = {
  state: ConnectivityDecisionState;
  esimSuitability: ConnectivityFact;
  coverageStatus: CoverageStatus;
  destinationCountryCodes: string[];
  tripDurationDays: number | null;
  travelerNeeds: ConnectivityNeeds;
  reasons: ConnectivityDecisionReason[];
  commercialProvider: null;
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function fact(value: unknown): ConnectivityFact {
  return value === "YES" || value === "NO" ? value : "UNKNOWN";
}

function normalizeCodes(values?: string[] | null) {
  return unique((values || []).filter((value): value is string => typeof value === "string").map((value) => value.trim().toUpperCase()));
}

function normalizedCoverage(input: ConnectivityDecisionInput) {
  const requested = input.tripGeography.destinationCountryCodes;
  const plan = input.currentPlan || {};
  const covered = normalizeCodes(plan.coveredCountryCodes);
  if (covered.length && requested.length) {
    const count = requested.filter((code) => covered.includes(code)).length;
    if (count === requested.length) return "ALL_DESTINATIONS" as const;
    if (count === 0) return "NONE" as const;
    return "PARTIAL" as const;
  }
  if (plan.destinationCoverage === "ALL_DESTINATIONS") return "UNKNOWN";
  return plan.destinationCoverage || "UNKNOWN";
}

function addRequirementReasons(needs: ConnectivityNeeds, reasons: ConnectivityDecisionReason[]) {
  if (needs.callsNeeded === "YES") reasons.push("VOICE_REQUIRED");
  if (needs.smsNeeded === "YES") reasons.push("SMS_REQUIRED");
  if (needs.hotspotNeeded === "YES") reasons.push("HOTSPOT_REQUIRED");
}

export function decideConnectivity(input: ConnectivityDecisionInput): ConnectivityDecision {
  const geography = input.tripGeography;
  const needs = { ...(input.travelerNeeds || {}) };
  const reasons: ConnectivityDecisionReason[] = [];
  const destinationCountryCodes = [...geography.destinationCountryCodes];
  const coverageStatus = normalizedCoverage(input);
  const international = geography.scope === "INTERNATIONAL" || geography.scope === "MULTI_COUNTRY_INTERNATIONAL";
  const plan = input.currentPlan || {};
  const esimSupport = fact(input.device?.esimSupport);
  const unlocked = fact(input.device?.unlocked);
  const roamingIncluded = fact(plan.roamingIncluded);
  const allowanceAdequate = fact(plan.dataAllowanceAdequate);

  addRequirementReasons(needs, reasons);
  if (geography.scope === "UNKNOWN") {
    reasons.push("INSUFFICIENT_CONNECTIVITY_FACTS");
    return { state: "INSUFFICIENT_INFORMATION", esimSuitability: "UNKNOWN", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }
  if (!international) {
    reasons.push("DOMESTIC_TRIP");
    return { state: "NOT_NEEDED", esimSuitability: "NO", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }

  reasons.push("INTERNATIONAL_CONNECTIVITY_RELEVANT");
  if (geography.scope === "MULTI_COUNTRY_INTERNATIONAL") reasons.push("MULTI_COUNTRY_COVERAGE_REQUIRED");

  const fullCoverage = coverageStatus === "ALL_DESTINATIONS" && roamingIncluded === "YES" && allowanceAdequate === "YES";
  if (fullCoverage) {
    reasons.push("CURRENT_PLAN_COVERS_ALL_DESTINATIONS");
    return { state: "CURRENT_PLAN_LIKELY_SUFFICIENT", esimSuitability: "NO", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }

  if (coverageStatus === "PARTIAL") reasons.push("CURRENT_PLAN_PARTIAL_COVERAGE");
  else if (coverageStatus === "NONE") reasons.push("CURRENT_PLAN_NO_COVERAGE");
  else if (roamingIncluded === "UNKNOWN" || allowanceAdequate === "UNKNOWN") reasons.push(roamingIncluded === "UNKNOWN" ? "ROAMING_STATUS_UNKNOWN" : "DATA_ALLOWANCE_UNKNOWN");
  else if (coverageStatus === "ALL_DESTINATIONS" && roamingIncluded === "YES") reasons.push("DATA_ALLOWANCE_UNKNOWN");

  const alternativeRelevant = coverageStatus === "PARTIAL" || coverageStatus === "NONE" || roamingIncluded === "NO" || allowanceAdequate === "NO";
  if (!alternativeRelevant) {
    return { state: "INSUFFICIENT_INFORMATION", esimSuitability: "UNKNOWN", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique([...reasons, "INSUFFICIENT_CONNECTIVITY_FACTS"]) as ConnectivityDecisionReason[], commercialProvider: null };
  }

  if (esimSupport === "NO") {
    reasons.push("ESIM_UNSUPPORTED");
    return { state: "ESIM_NOT_USABLE", esimSuitability: "NO", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }
  if (unlocked === "NO") {
    reasons.push("DEVICE_LOCKED");
    return { state: "ESIM_NOT_USABLE", esimSuitability: "NO", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }
  if (esimSupport === "UNKNOWN") reasons.push("ESIM_SUPPORT_UNKNOWN");
  if (unlocked === "UNKNOWN") reasons.push("DEVICE_UNLOCK_STATUS_UNKNOWN");
  if (esimSupport === "YES") reasons.push("ESIM_SUPPORTED");
  if (unlocked === "YES") reasons.push("DEVICE_UNLOCKED");
  if (esimSupport === "YES" && unlocked === "YES") {
    return { state: "ESIM_POTENTIALLY_SUITABLE", esimSuitability: "YES", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
  }
  return { state: "ALTERNATIVE_CONNECTIVITY_WORTH_EVALUATING", esimSuitability: "UNKNOWN", coverageStatus, destinationCountryCodes, tripDurationDays: input.tripDurationDays ?? null, travelerNeeds: needs, reasons: unique(reasons) as ConnectivityDecisionReason[], commercialProvider: null };
}
