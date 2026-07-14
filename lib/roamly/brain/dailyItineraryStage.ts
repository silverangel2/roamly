import OpenAI from "openai";
import type { AccommodationDecision } from "@/lib/roamly/accommodationIntelligence";
import type { TransportationDecision } from "@/lib/roamly/transportationIntelligence";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type DailyEvidenceStatus = "verified_live" | "recently_retrieved" | "estimated" | "unknown";

export type DailyItineraryActivity = {
  title: string;
  location: string;
  start_time: string | null;
  end_time: string | null;
  estimated_cost: number | null;
  reservation_required: boolean;
  opening_hour_consideration: string | null;
  weather_consideration: string | null;
  accessibility_consideration: string | null;
  evidence_status: DailyEvidenceStatus;
  source: string | null;
};

export type DailyItineraryDay = {
  date: string;
  theme: string;
  morning: DailyItineraryActivity[];
  afternoon: DailyItineraryActivity[];
  evening: DailyItineraryActivity[];
  meals: DailyItineraryActivity[];
  activities: DailyItineraryActivity[];
  transport_segments: Array<{
    from: string;
    to: string;
    mode: string;
    estimated_minutes: number | null;
    evidence_status: DailyEvidenceStatus;
  }>;
  estimated_travel_time_minutes: number;
  estimated_cost: number | null;
  reservation_requirements: string[];
  opening_hour_considerations: string[];
  weather_considerations: string[];
  accessibility_considerations: string[];
  primary_plan: string;
  backup_plan: string;
  optional_flexible_activity: string;
  source_evidence: Array<{
    source: string;
    retrieved_at: string | null;
    evidence_status: DailyEvidenceStatus;
  }>;
};

export type DailyItineraryBatch = {
  batch_index: number;
  day_numbers: number[];
  days: DailyItineraryDay[];
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function addDays(date: string, offset: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

export function buildDailyItineraryBatches(payload: TripPlannerPayload, maxDaysPerBatch = 3) {
  const dayCount = Math.max(1, Math.round(payload.daysCount || 1));
  const size = Math.min(3, Math.max(1, Math.round(maxDaysPerBatch)));
  const batches: Array<{ batch_index: number; day_numbers: number[]; dates: string[] }> = [];
  for (let start = 1; start <= dayCount; start += size) {
    const day_numbers = Array.from({ length: Math.min(size, dayCount - start + 1) }, (_, index) => start + index);
    batches.push({
      batch_index: batches.length + 1,
      day_numbers,
      dates: day_numbers.map((dayNumber) => addDays(payload.startDate, dayNumber - 1)).filter(Boolean)
    });
  }
  return batches;
}

export function classifyEvidenceStatus(value: unknown): DailyEvidenceStatus {
  const text = String(value || "").toLowerCase();
  if (text.includes("live")) return "verified_live";
  if (text.includes("cached") || text.includes("recent")) return "recently_retrieved";
  if (text.includes("estimate") || text.includes("search_ready")) return "estimated";
  return "unknown";
}

function activityArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeActivity(value: unknown): DailyItineraryActivity {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    title: clean(record.title as string) || "Flexible activity",
    location: clean(record.location as string) || "To be confirmed",
    start_time: clean(record.start_time as string) || null,
    end_time: clean(record.end_time as string) || null,
    estimated_cost: typeof record.estimated_cost === "number" && Number.isFinite(record.estimated_cost) ? record.estimated_cost : null,
    reservation_required: record.reservation_required === true,
    opening_hour_consideration: clean(record.opening_hour_consideration as string) || null,
    weather_consideration: clean(record.weather_consideration as string) || null,
    accessibility_consideration: clean(record.accessibility_consideration as string) || null,
    evidence_status: classifyEvidenceStatus(record.evidence_status),
    source: clean(record.source as string) || null
  };
}

export function normalizeDailyItineraryDay(value: unknown): DailyItineraryDay | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!record) return null;
  const morning = activityArray(record.morning).map(normalizeActivity);
  const afternoon = activityArray(record.afternoon).map(normalizeActivity);
  const evening = activityArray(record.evening).map(normalizeActivity);
  const meals = activityArray(record.meals).map(normalizeActivity);
  const activities = activityArray(record.activities).map(normalizeActivity);
  const date = clean(record.date as string);
  const theme = clean(record.theme as string);
  if (!date || !theme) return null;
  return {
    date,
    theme,
    morning,
    afternoon,
    evening,
    meals,
    activities: activities.length ? activities : [...morning, ...afternoon, ...evening],
    transport_segments: activityArray(record.transport_segments).map((segment) => {
      const segmentRecord = segment && typeof segment === "object" && !Array.isArray(segment) ? (segment as Record<string, unknown>) : {};
      return {
        from: clean(segmentRecord.from as string) || "Start",
        to: clean(segmentRecord.to as string) || "End",
        mode: clean(segmentRecord.mode as string) || "walk/transit",
        estimated_minutes:
          typeof segmentRecord.estimated_minutes === "number" && Number.isFinite(segmentRecord.estimated_minutes)
            ? Math.max(0, Math.round(segmentRecord.estimated_minutes))
            : null,
        evidence_status: classifyEvidenceStatus(segmentRecord.evidence_status)
      };
    }),
    estimated_travel_time_minutes:
      typeof record.estimated_travel_time_minutes === "number" && Number.isFinite(record.estimated_travel_time_minutes)
        ? Math.max(0, Math.round(record.estimated_travel_time_minutes))
        : 0,
    estimated_cost: typeof record.estimated_cost === "number" && Number.isFinite(record.estimated_cost) ? record.estimated_cost : null,
    reservation_requirements: activityArray(record.reservation_requirements).filter((item): item is string => typeof item === "string"),
    opening_hour_considerations: activityArray(record.opening_hour_considerations).filter((item): item is string => typeof item === "string"),
    weather_considerations: activityArray(record.weather_considerations).filter((item): item is string => typeof item === "string"),
    accessibility_considerations: activityArray(record.accessibility_considerations).filter((item): item is string => typeof item === "string"),
    primary_plan: clean(record.primary_plan as string) || theme,
    backup_plan: clean(record.backup_plan as string) || "Use the nearest indoor backup if weather or timing changes.",
    optional_flexible_activity: clean(record.optional_flexible_activity as string) || "Leave flexible time open.",
    source_evidence: activityArray(record.source_evidence).map((source) => {
      const sourceRecord = source && typeof source === "object" && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
      return {
        source: clean(sourceRecord.source as string) || "planner evidence",
        retrieved_at: clean(sourceRecord.retrieved_at as string) || null,
        evidence_status: classifyEvidenceStatus(sourceRecord.evidence_status)
      };
    })
  };
}

export function validateDailyItineraryBatch(days: DailyItineraryDay[], expectedDates: string[]) {
  const errors: string[] = [];
  if (days.length !== expectedDates.length) errors.push("AI returned the wrong number of itinerary days.");
  for (const date of expectedDates) {
    if (!days.some((day) => day.date === date)) errors.push(`Missing itinerary day for ${date}.`);
  }
  for (const day of days) {
    if (!day.morning.length && !day.afternoon.length && !day.evening.length) errors.push(`${day.date} has no primary activities.`);
    if (!day.meals.length) errors.push(`${day.date} is missing meal planning.`);
    if (!day.backup_plan) errors.push(`${day.date} is missing a backup plan.`);
  }
  return { ok: errors.length === 0, errors };
}

function systemPrompt() {
  return [
    "You are Roamly Brain's daily itinerary planner.",
    "Return only strict JSON with a top-level days array.",
    "Use only supplied evidence for provider-backed facts like opening hours, prices, live availability, ratings, and weather.",
    "Mark facts as verified_live, recently_retrieved, estimated, or unknown.",
    "Respect arrival/departure limits, hotel/base location, pace, budget, meals, rest, geographic clustering, and accessibility notes when supplied."
  ].join("\n");
}

function userPrompt(input: {
  payload: TripPlannerPayload;
  dates: string[];
  transportation?: TransportationDecision | null;
  accommodation?: AccommodationDecision | null;
  evidence: Record<string, unknown>;
}) {
  return JSON.stringify({
    trip: input.payload,
    dates: input.dates,
    transportation: input.transportation,
    accommodation: input.accommodation,
    evidence: input.evidence,
    required_day_fields: [
      "date",
      "theme",
      "morning",
      "afternoon",
      "evening",
      "meals",
      "activities",
      "transport_segments",
      "estimated_travel_time_minutes",
      "estimated_cost",
      "reservation_requirements",
      "opening_hour_considerations",
      "weather_considerations",
      "accessibility_considerations",
      "primary_plan",
      "backup_plan",
      "optional_flexible_activity",
      "source_evidence"
    ]
  });
}

export async function generateDailyItineraryBatch(params: {
  payload: TripPlannerPayload;
  dates: string[];
  transportation?: TransportationDecision | null;
  accommodation?: AccommodationDecision | null;
  evidence?: Record<string, unknown>;
}) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { ok: false as const, error: "OPENAI_API_KEY_MISSING", days: [] as DailyItineraryDay[] };
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: userPrompt({
          payload: params.payload,
          dates: params.dates,
          transportation: params.transportation,
          accommodation: params.accommodation,
          evidence: params.evidence || {}
        })
      }
    ]
  });
  const content = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(content) as { days?: unknown[] };
  const days = activityArray(parsed.days).map(normalizeDailyItineraryDay).filter((day): day is DailyItineraryDay => Boolean(day));
  const validation = validateDailyItineraryBatch(days, params.dates);
  if (!validation.ok) return { ok: false as const, error: "INVALID_DAILY_ITINERARY_OUTPUT", validation, days };
  return { ok: true as const, days };
}
