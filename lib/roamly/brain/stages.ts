export const ROAMLY_BRAIN_VERSION = "roamly-brain-v1";

export type BrainRetryClass = "deterministic" | "provider_transient" | "ai_structured_output" | "notification";
export type BrainProviderRequirement = "none" | "openai" | "maps" | "market_transport" | "market_accommodation" | "activities" | "email";
export type BrainEvidenceRequirement =
  | "trip_payload"
  | "traveler_preferences"
  | "provider_sources"
  | "market_results"
  | "decision_scores"
  | "validation_findings"
  | "assembled_itinerary";

export type BrainChangeType =
  | "travel_dates"
  | "traveler_preferences"
  | "transport"
  | "hotel"
  | "activity"
  | "budget"
  | "pace"
  | "destination";

export type BrainJsonSchema = {
  type: "object";
  required: string[];
  properties: Record<string, string>;
};

export type BrainStageDefinition = {
  type: string;
  sequence: number;
  label: string;
  version: string;
  dependencies: string[];
  retryClass: BrainRetryClass;
  providerRequirements: BrainProviderRequirement[];
  evidenceRequirements: BrainEvidenceRequirement[];
  invalidatedBy: BrainChangeType[];
  inputSchema: BrainJsonSchema;
  outputSchema: BrainJsonSchema;
};

function schema(required: string[], properties: Record<string, string>): BrainJsonSchema {
  return { type: "object", required, properties };
}

export const ROAMLY_BRAIN_STAGES = [
  {
    type: "traveler_profile",
    sequence: 1,
    label: "Learning your preferences",
    version: "1.0.0",
    dependencies: [],
    retryClass: "deterministic",
    providerRequirements: ["none"],
    evidenceRequirements: ["trip_payload"],
    invalidatedBy: ["traveler_preferences"],
    inputSchema: schema(["tripId", "userId"], { tripId: "string", userId: "string", payload: "object" }),
    outputSchema: schema(["profile", "preferenceInfluence"], { profile: "object", preferenceInfluence: "array" })
  },
  {
    type: "trip_requirements",
    sequence: 2,
    label: "Understanding your trip",
    version: "1.0.0",
    dependencies: ["traveler_profile"],
    retryClass: "deterministic",
    providerRequirements: ["none"],
    evidenceRequirements: ["trip_payload", "traveler_preferences"],
    invalidatedBy: ["travel_dates", "traveler_preferences", "budget", "pace", "destination"],
    inputSchema: schema(["payload", "traveler_profile"], { payload: "object", traveler_profile: "object" }),
    outputSchema: schema(["requirements", "constraints"], { requirements: "object", constraints: "array" })
  },
  {
    type: "destination_research",
    sequence: 3,
    label: "Researching your destination",
    version: "1.0.0",
    dependencies: ["trip_requirements"],
    retryClass: "provider_transient",
    providerRequirements: ["activities", "maps"],
    evidenceRequirements: ["provider_sources"],
    invalidatedBy: ["travel_dates", "destination", "traveler_preferences"],
    inputSchema: schema(["requirements"], { requirements: "object" }),
    outputSchema: schema(["destinationFacts", "activityEvidence"], { destinationFacts: "object", activityEvidence: "array" })
  },
  {
    type: "transport_search",
    sequence: 4,
    label: "Comparing transportation",
    version: "1.0.0",
    dependencies: ["trip_requirements"],
    retryClass: "provider_transient",
    providerRequirements: ["market_transport", "maps"],
    evidenceRequirements: ["provider_sources", "market_results"],
    invalidatedBy: ["travel_dates", "transport", "traveler_preferences", "budget", "destination"],
    inputSchema: schema(["requirements"], { requirements: "object" }),
    outputSchema: schema(["candidates", "unavailableProviders"], { candidates: "array", unavailableProviders: "array" })
  },
  {
    type: "transport_decision",
    sequence: 5,
    label: "Choosing the best way to travel",
    version: "1.0.0",
    dependencies: ["transport_search", "traveler_profile"],
    retryClass: "deterministic",
    providerRequirements: ["none"],
    evidenceRequirements: ["decision_scores", "market_results", "traveler_preferences"],
    invalidatedBy: ["travel_dates", "transport", "traveler_preferences", "budget", "destination"],
    inputSchema: schema(["transport_search", "traveler_profile"], { transport_search: "object", traveler_profile: "object" }),
    outputSchema: schema(["recommendation", "alternatives", "scoreBreakdown"], {
      recommendation: "object",
      alternatives: "array",
      scoreBreakdown: "object"
    })
  },
  {
    type: "destination_structure",
    sequence: 6,
    label: "Structuring your destination",
    version: "1.0.0",
    dependencies: ["destination_research", "transport_decision"],
    retryClass: "ai_structured_output",
    providerRequirements: ["openai"],
    evidenceRequirements: ["provider_sources"],
    invalidatedBy: ["travel_dates", "destination", "transport", "traveler_preferences", "pace"],
    inputSchema: schema(["destination_research", "transport_decision"], {
      destination_research: "object",
      transport_decision: "object"
    }),
    outputSchema: schema(["areas", "activityClusters"], { areas: "array", activityClusters: "array" })
  },
  {
    type: "accommodation_area_selection",
    sequence: 7,
    label: "Finding the best area to stay",
    version: "1.0.0",
    dependencies: ["destination_structure", "transport_decision", "traveler_profile"],
    retryClass: "deterministic",
    providerRequirements: ["maps"],
    evidenceRequirements: ["decision_scores", "traveler_preferences"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "traveler_preferences", "pace", "destination"],
    inputSchema: schema(["destination_structure", "transport_decision", "traveler_profile"], {
      destination_structure: "object",
      transport_decision: "object",
      traveler_profile: "object"
    }),
    outputSchema: schema(["selectedArea", "areaAlternatives", "scoreBreakdown"], {
      selectedArea: "object",
      areaAlternatives: "array",
      scoreBreakdown: "object"
    })
  },
  {
    type: "accommodation_search",
    sequence: 8,
    label: "Comparing accommodations",
    version: "1.0.0",
    dependencies: ["accommodation_area_selection", "trip_requirements"],
    retryClass: "provider_transient",
    providerRequirements: ["market_accommodation"],
    evidenceRequirements: ["provider_sources", "market_results"],
    invalidatedBy: ["travel_dates", "hotel", "traveler_preferences", "budget", "destination"],
    inputSchema: schema(["selectedArea", "requirements"], { selectedArea: "object", requirements: "object" }),
    outputSchema: schema(["candidates", "unavailableProviders"], { candidates: "array", unavailableProviders: "array" })
  },
  {
    type: "accommodation_decision",
    sequence: 9,
    label: "Choosing where to stay",
    version: "1.0.0",
    dependencies: ["accommodation_search", "accommodation_area_selection", "traveler_profile"],
    retryClass: "deterministic",
    providerRequirements: ["none"],
    evidenceRequirements: ["decision_scores", "market_results", "traveler_preferences"],
    invalidatedBy: ["travel_dates", "hotel", "traveler_preferences", "budget", "destination"],
    inputSchema: schema(["accommodation_search", "accommodation_area_selection", "traveler_profile"], {
      accommodation_search: "object",
      accommodation_area_selection: "object",
      traveler_profile: "object"
    }),
    outputSchema: schema(["recommendation", "alternatives", "scoreBreakdown"], {
      recommendation: "object",
      alternatives: "array",
      scoreBreakdown: "object"
    })
  },
  {
    type: "daily_itinerary_generation",
    sequence: 10,
    label: "Building your itinerary",
    version: "1.0.0",
    dependencies: ["destination_structure", "transport_decision", "accommodation_decision", "traveler_profile"],
    retryClass: "ai_structured_output",
    providerRequirements: ["openai", "maps", "activities"],
    evidenceRequirements: ["provider_sources", "traveler_preferences"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "traveler_preferences", "budget", "pace", "destination"],
    inputSchema: schema(["destination_structure", "transport_decision", "accommodation_decision"], {
      destination_structure: "object",
      transport_decision: "object",
      accommodation_decision: "object"
    }),
    outputSchema: schema(["days", "sourceEvidence"], { days: "array", sourceEvidence: "array" })
  },
  {
    type: "itinerary_logistics_validation",
    sequence: 11,
    label: "Checking travel times",
    version: "1.0.0",
    dependencies: ["daily_itinerary_generation", "transport_decision", "accommodation_decision"],
    retryClass: "deterministic",
    providerRequirements: ["maps"],
    evidenceRequirements: ["validation_findings"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "pace", "destination"],
    inputSchema: schema(["daily_itinerary_generation"], { daily_itinerary_generation: "object" }),
    outputSchema: schema(["findings", "repairs"], { findings: "array", repairs: "array" })
  },
  {
    type: "budget_validation",
    sequence: 12,
    label: "Checking your budget",
    version: "1.0.0",
    dependencies: ["daily_itinerary_generation", "transport_decision", "accommodation_decision"],
    retryClass: "deterministic",
    providerRequirements: ["none"],
    evidenceRequirements: ["validation_findings", "market_results"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "budget"],
    inputSchema: schema(["daily_itinerary_generation", "transport_decision", "accommodation_decision"], {
      daily_itinerary_generation: "object",
      transport_decision: "object",
      accommodation_decision: "object"
    }),
    outputSchema: schema(["findings", "estimatedTotal"], { findings: "array", estimatedTotal: "object" })
  },
  {
    type: "schedule_validation",
    sequence: 13,
    label: "Checking your schedule",
    version: "1.0.0",
    dependencies: ["daily_itinerary_generation", "itinerary_logistics_validation"],
    retryClass: "deterministic",
    providerRequirements: ["activities"],
    evidenceRequirements: ["validation_findings", "provider_sources"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "pace", "destination"],
    inputSchema: schema(["daily_itinerary_generation", "itinerary_logistics_validation"], {
      daily_itinerary_generation: "object",
      itinerary_logistics_validation: "object"
    }),
    outputSchema: schema(["findings", "repairs"], { findings: "array", repairs: "array" })
  },
  {
    type: "backup_plan_generation",
    sequence: 14,
    label: "Creating backup plans",
    version: "1.0.0",
    dependencies: ["daily_itinerary_generation", "schedule_validation"],
    retryClass: "ai_structured_output",
    providerRequirements: ["openai", "activities"],
    evidenceRequirements: ["provider_sources"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "traveler_preferences", "pace", "destination"],
    inputSchema: schema(["daily_itinerary_generation", "schedule_validation"], {
      daily_itinerary_generation: "object",
      schedule_validation: "object"
    }),
    outputSchema: schema(["backupPlans"], { backupPlans: "array" })
  },
  {
    type: "final_assembly",
    sequence: 15,
    label: "Finalizing your trip",
    version: "1.0.0",
    dependencies: [
      "traveler_profile",
      "transport_decision",
      "accommodation_decision",
      "daily_itinerary_generation",
      "itinerary_logistics_validation",
      "budget_validation",
      "schedule_validation",
      "backup_plan_generation"
    ],
    retryClass: "ai_structured_output",
    providerRequirements: ["openai"],
    evidenceRequirements: ["assembled_itinerary", "decision_scores", "validation_findings"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "traveler_preferences", "budget", "pace", "destination"],
    inputSchema: schema(["completedLayers"], { completedLayers: "object" }),
    outputSchema: schema(["itinerary", "version", "sourceTimestamps"], {
      itinerary: "object",
      version: "string",
      sourceTimestamps: "array"
    })
  },
  {
    type: "completion_notification",
    sequence: 16,
    label: "Completed",
    version: "1.0.0",
    dependencies: ["final_assembly"],
    retryClass: "notification",
    providerRequirements: ["email"],
    evidenceRequirements: ["assembled_itinerary"],
    invalidatedBy: ["travel_dates", "hotel", "transport", "activity", "traveler_preferences", "budget", "pace", "destination"],
    inputSchema: schema(["final_assembly"], { final_assembly: "object" }),
    outputSchema: schema(["notification"], { notification: "object" })
  }
] as const satisfies readonly BrainStageDefinition[];

export type RoamlyBrainStageType = (typeof ROAMLY_BRAIN_STAGES)[number]["type"];

export const BRAIN_STAGE_BY_TYPE = Object.fromEntries(ROAMLY_BRAIN_STAGES.map((stage) => [stage.type, stage])) as Record<
  RoamlyBrainStageType,
  (typeof ROAMLY_BRAIN_STAGES)[number]
>;

export function getBrainStage(type: string) {
  return BRAIN_STAGE_BY_TYPE[type as RoamlyBrainStageType] || null;
}

export function stageLabel(stageType?: string | null) {
  return getBrainStage(stageType || "")?.label || "Preparing your trip";
}

export function stageSequence(stageType: string) {
  return getBrainStage(stageType)?.sequence || 0;
}

export function downstreamStages(stageType: string) {
  const start = stageSequence(stageType);
  if (!start) return [];
  return ROAMLY_BRAIN_STAGES.filter((stage) => stage.sequence > start).map((stage) => stage.type);
}

export function stagesInvalidatedBy(changeType: BrainChangeType) {
  return ROAMLY_BRAIN_STAGES.filter((stage) => (stage.invalidatedBy as readonly BrainChangeType[]).includes(changeType)).map(
    (stage) => stage.type
  );
}

export function firstInvalidatedSequence(changeType: BrainChangeType) {
  const stages = stagesInvalidatedBy(changeType);
  if (!stages.length) return null;
  return Math.min(...stages.map(stageSequence).filter(Boolean));
}

export function dependentStagesForRegeneration(stageType: string) {
  const stage = getBrainStage(stageType);
  if (!stage) return [];
  return ROAMLY_BRAIN_STAGES.filter((candidate) => candidate.sequence > stage.sequence).filter((candidate) => {
    const queue = [...candidate.dependencies];
    const visited = new Set<string>();
    while (queue.length) {
      const dependency = queue.shift() || "";
      if (dependency === stage.type) return true;
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      queue.push(...(getBrainStage(dependency)?.dependencies || []));
    }
    return false;
  }).map((candidate) => candidate.type);
}

export function validateSchemaShape(schemaToCheck: BrainJsonSchema, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false as const, error: "Expected an object." };
  }
  const record = value as Record<string, unknown>;
  const missing = schemaToCheck.required.filter((key) => record[key] === undefined || record[key] === null);
  if (missing.length) return { ok: false as const, error: `Missing required field(s): ${missing.join(", ")}` };
  return { ok: true as const };
}
