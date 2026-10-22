/*
 * Build 2 Live Companion — panel view models (DESIGN-PRODUCTION.md
 * Phase 7; shadow source: part2-travel-days-2026-10-21/src/
 * live-companion.mjs, owner-accepted compact v2 + BUILD2-SPEC §4/§4.1).
 *
 * This module is a pure VIEW over the existing companion state
 * pipeline (lib/roamly/liveCompanion.ts state + the day's activities)
 * and the append-only M2 ledger (lib/roamly/companionLedger.ts). It
 * owns no state and performs no I/O: the same functions run on the
 * server (initial render), on the client (optimistic re-derivation,
 * offline), and in the Phase 7 harness.
 *
 * Owner law carried here (Junel, 2026-10-21 18:45 ADT):
 *  - A notification is a VIEW of ledger state, never the state
 *    itself. No tap consumes the item.
 *  - DIRECTIONS_VIEWED is non-terminal: it marks the item viewed;
 *    Check in and Skip stay actionable.
 *  - Check-in COLLAPSES the card to a slim "Checked in · <place>"
 *    line with Undo. The line stays during the visit, then goes
 *    STALE after the visit window, then EXPIRES from the panel.
 *    The ledger record is permanent through every transition.
 *  - Skip collapses the same slim way (+ Undo) and writes the TASTE
 *    signal. SKIP is never MISSED: MISSED is circumstance, carries
 *    no taste signal, and stays a continuity re-homing candidate.
 *  - Scale law (§4.2): push <= 110px tall / 358px wide, pinned strip
 *    <= 112px, compact rows <= 88px. Map choices live behind ONE
 *    Directions control that opens a chooser — never button rows.
 *  - Map truth: Citymapper is recommended only where it operates
 *    AND the item is a transit move; Google is the default
 *    recommendation everywhere else; Citymapper is never shown as
 *    available without coverage evidence.
 *  - Voice: human personal-assistant. Leave-by is voiced before it
 *    is urgent ("Leave by 15:12 — about 18 minutes to get there,
 *    with 10 minutes to spare.").
 */

import { minutesToClock, type LocalDate, type PlanMinutes } from "./engine/time";
import type {
  CompanionItemState,
  CompanionLedgerEntryDTO,
  LedgerClassification,
  MapChoiceDTO
} from "./engine/types";
import { directionLinksForActivity, type LiveCompanionActivity } from "./liveCompanion";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** One day item the panel can show, in trip-local plan minutes. */
export interface PanelActivityInput {
  id: string; // production activity id — the ledger's activityRef
  kind: string; // itinerary kind/category (attraction, food, flight, ...)
  name: string;
  place: string;
  address: string | null;
  date: LocalDate;
  startMin: PlanMinutes;
  endMin: PlanMinutes;
  boardingMin: PlanMinutes | null;
  /** Production activity status (planned | nearby | active |
   *  checked_in | completed | skipped | missed). The ledger outranks
   *  it for lived state; it only closes a visit (dwell) and mirrors
   *  pre-Build-2 actions taken outside the panel. */
  status: string;
  prepaid: boolean;
  bookingRef: string | null;
  /** Known travel minutes to reach the item — the same inputs
   *  companionShiftTiming computes from (route duration when a live
   *  route exists). Null = unknown; no leave-by is fabricated. */
  travelMin: number | null;
  mapMode: "transit" | "place";
  latitude: number | null;
  longitude: number | null;
  /** Short booking provenance label, e.g. "from your Air Canada
   *  email, Tue 09:12" (BUILD2-SPEC addition D), or null. */
  provenanceLabel: string | null;
  /** Trip-local minute the traveler completed the item, when the
   *  production record carries it (dwell close-out). */
  completedAtMin: PlanMinutes | null;
}

/** A loud collision alert (BUILD2-SPEC addition A). */
export interface PanelAlertInput {
  id: string;
  itemId: string | null;
  headline: string;
  message: string;
  provenanceLabel: string | null;
}

export interface CompanionPanelInput {
  tripId: string;
  destination: string;
  date: LocalDate;
  timezone: string;
  nowMin: PlanMinutes;
  activities: PanelActivityInput[];
  ledgerEntries: CompanionLedgerEntryDTO[];
  alerts: PanelAlertInput[];
  /** Coverage EVIDENCE for Citymapper in this destination. False is
   *  the honest default — never assumed. */
  citymapperCoverage: boolean;
  /** Leave-by buffer minutes (party profile); default 10. */
  bufferMin?: number;
  /** Where the traveler is leaving from, for the leave-by voice. */
  currentPlace?: string | null;
}

/* ------------------------------------------------------------------ */
/* Small shared facts                                                  */
/* ------------------------------------------------------------------ */

export const ROAMLY_ICON_PATH = "/icon-512.png";
export const STALE_WINDOW_MIN = 30;
export const CHECK_IN_OPENS_BEFORE_MIN = 60;
export const LEAVE_BY_SURFACE_BEFORE_MIN = 30;

/* The shadow's panel kinds, plus production's generic "activity"
 * and "transfer". Stays and rests are deliberately NOT panel stops:
 * they are day anchors and surface in the pass essentials instead. */
const PANEL_KINDS: ReadonlySet<string> = new Set([
  "flight",
  "attraction",
  "food",
  "cruise",
  "gallery",
  "museum",
  "park",
  "theatre",
  "tour",
  "transfer",
  "activity"
]);

export function isPanelKind(kind: string): boolean {
  return PANEL_KINDS.has(kind);
}

export function panelDateLabel(date: LocalDate): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

/* ------------------------------------------------------------------ */
/* Map choices (behind ONE Directions control)                         */
/* ------------------------------------------------------------------ */

export interface MapOptionView extends MapChoiceDTO {
  url: string | null;
  note: string;
}

export interface DirectionsControl {
  label: "Directions";
  opensChooser: true;
  options: MapOptionView[];
}

export function mapChoicesFor(
  activity: PanelActivityInput,
  opts: { citymapperCoverage: boolean }
): MapChoiceDTO[] {
  const transit = activity.mapMode === "transit" || activity.kind === "transfer";
  const citymapperRecommended = Boolean(opts.citymapperCoverage && transit);
  const choices: MapChoiceDTO[] = [
    {
      provider: "citymapper",
      available: Boolean(opts.citymapperCoverage),
      recommended: citymapperRecommended,
      label: "Citymapper"
    },
    {
      provider: "google",
      available: true,
      recommended: !citymapperRecommended,
      label: "Google Maps"
    },
    {
      provider: "apple",
      available: true,
      recommended: false,
      label: "Apple Maps"
    }
  ];
  return choices.sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

export function mapOptionsFor(
  activity: PanelActivityInput,
  opts: { citymapperCoverage: boolean }
): MapOptionView[] {
  const choices = mapChoicesFor(activity, opts);
  const transit = activity.mapMode === "transit" || activity.kind === "transfer";
  const links = directionLinksForActivity(
    {
      id: activity.id,
      title: activity.name,
      placeName: activity.place,
      address: activity.address,
      latitude: activity.latitude,
      longitude: activity.longitude
    } satisfies LiveCompanionActivity,
    transit ? "transit" : "driving"
  );
  return choices.map((choice) => {
    const url =
      choice.provider === "google"
        ? links.google
        : choice.provider === "apple"
          ? links.apple
          : links.citymapper;
    const note =
      choice.provider === "citymapper"
        ? opts.citymapperCoverage
          ? transit
            ? "Preferred for transportation here"
            : "Available here"
          : "Not available here"
        : choice.provider === "google"
          ? choice.recommended
            ? "Best option here"
            : "Also available"
          : "Also available";
    return { ...choice, url: choice.available ? url : null, note };
  });
}

export function directionsControlFor(
  activity: PanelActivityInput,
  opts: { citymapperCoverage: boolean }
): DirectionsControl {
  return { label: "Directions", opensChooser: true, options: mapOptionsFor(activity, opts) };
}

/* ------------------------------------------------------------------ */
/* Leave-by anticipation (BUILD2-SPEC addition B)                      */
/* ------------------------------------------------------------------ */

export interface LeaveByView {
  leaveByMin: PlanMinutes;
  leaveByLabel: string;
  travelMin: number;
  bufferMin: number;
  from: string;
  /** Full personal-assistant voice (detail + push body). */
  voice: string;
  /** Short form for the strip/row scale. */
  shortLine: string;
}

export function computeLeaveBy(
  activity: PanelActivityInput,
  context: { bufferMin?: number; currentPlace?: string | null } = {}
): LeaveByView | null {
  if (activity.travelMin === null || !Number.isFinite(activity.travelMin) || activity.travelMin < 0) {
    return null;
  }
  const bufferMin = context.bufferMin ?? 10;
  const leaveByMin = activity.startMin - activity.travelMin - bufferMin;
  const leaveByLabel = minutesToClock(leaveByMin);
  return {
    leaveByMin,
    leaveByLabel,
    travelMin: activity.travelMin,
    bufferMin,
    from: context.currentPlace || "your current place",
    voice: `Leave by ${leaveByLabel} — about ${activity.travelMin} minutes to get there, with ${bufferMin} minutes to spare.`,
    shortLine: `Leave by ${leaveByLabel} · ${activity.travelMin} min away · ${bufferMin} min spare`
  };
}

/* ------------------------------------------------------------------ */
/* Lived state — the ledger fold                                       */
/* ------------------------------------------------------------------ */

/** The learning signal a lived outcome carries (BUILD2-SPEC §1.5 +
 *  addition C). SKIP feeds taste; MISSED never does. */
export interface LivedSignal {
  classification: "CHECK_IN" | "SKIP" | "MISSED" | "DIRECTIONS_VIEWED";
  terminal: boolean;
  feedsPredictWeights: boolean;
  rehomeCandidate: boolean;
  meaning: string;
}

export type LivedKind =
  | "none"
  | "directions-viewed"
  | "checked-in"
  | "skipped"
  | "missed"
  | "completed";

export interface ItemLivedState {
  kind: LivedKind;
  /** Non-annulled, non-marker ledger entries for the item, in order. */
  effectiveEntries: CompanionLedgerEntryDTO[];
  checkedInMinute: PlanMinutes | null;
  /** Derived, never stored: minutes from check-in to the visit's
   *  close (completion, or the end of the item's window once it has
   *  passed). Null while the visit is open or never began. */
  dwellMinutes: number | null;
  directionsViewed: boolean;
  signal: LivedSignal | null;
  /** The entry an Undo would annul (append-only: Undo adds a marker
   *  entry linking here; it never edits or deletes this row). */
  undoTargetEntryId: string | null;
}

const CHECK_IN_SIGNAL: LivedSignal = {
  classification: "CHECK_IN",
  terminal: false,
  feedsPredictWeights: true,
  rehomeCandidate: false,
  meaning: "traveler reached the place; dwell evidence starts"
};
const SKIP_SIGNAL: LivedSignal = {
  classification: "SKIP",
  terminal: false,
  feedsPredictWeights: true,
  rehomeCandidate: false,
  meaning: "traveler choice; teaches taste"
};
const MISSED_SIGNAL: LivedSignal = {
  classification: "MISSED",
  terminal: false,
  feedsPredictWeights: false,
  rehomeCandidate: true,
  meaning: "circumstance, not traveler taste"
};
const DIRECTIONS_SIGNAL: LivedSignal = {
  classification: "DIRECTIONS_VIEWED",
  terminal: false,
  feedsPredictWeights: false,
  rehomeCandidate: false,
  meaning: "a map was opened; the lived state did not change and Check in / Skip remain actionable"
};

/** Entry ids annulled by an Undo marker (append-only annulment: the
 *  marker links to its target; neither row is ever edited). */
export function annulledEntryIds(
  entries: readonly CompanionLedgerEntryDTO[]
): ReadonlySet<string> {
  const annulled = new Set<string>();
  for (const entry of entries) {
    if (entry.undoOfEntryId) annulled.add(entry.undoOfEntryId);
  }
  return annulled;
}

/** The entry an Undo would annul for one item right now: the latest
 *  effective CHECKED_IN or SKIPPED row (a MISSED row clears it —
 *  circumstance is not the traveler's to undo). Shared by the view
 *  fold and the ledger service so both resolve Undo identically. */
export function undoTargetForEntries(
  entries: readonly CompanionLedgerEntryDTO[],
  activityRef: string
): CompanionLedgerEntryDTO | null {
  const annulled = annulledEntryIds(entries);
  const effective = entries
    .filter(
      (entry) =>
        entry.activityRef === activityRef &&
        !entry.undoOfEntryId &&
        !annulled.has(entry.entryId)
    )
    .slice()
    .sort(
      (a, b) =>
        a.atMinuteOfTrip - b.atMinuteOfTrip || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)
    );
  let target: CompanionLedgerEntryDTO | null = null;
  for (const entry of effective) {
    if (entry.classification === "CHECKED_IN" || entry.classification === "SKIPPED") {
      target = entry;
    } else if (entry.classification === "MISSED") {
      target = null;
    }
  }
  return target;
}

/**
 * Fold one item's append-only ledger rows into its lived state.
 * An entry whose id appears as another entry's undoOfEntryId is
 * annulled; the undo marker itself contributes nothing. Production
 * status mirrors pre-panel actions: a recorded checked_in/completed
 * status with no ledger row is honored as the lived state (the
 * ledger then starts from the traveler's next panel action).
 */
export function deriveItemLivedState(
  entries: readonly CompanionLedgerEntryDTO[],
  activity: PanelActivityInput,
  nowMin: PlanMinutes
): ItemLivedState {
  const mine = entries
    .filter((entry) => entry.activityRef === activity.id)
    .slice()
    .sort(
      (a, b) =>
        a.atMinuteOfTrip - b.atMinuteOfTrip || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)
    );
  const annulled = annulledEntryIds(mine);
  const effective = mine.filter(
    (entry) => !entry.undoOfEntryId && !annulled.has(entry.entryId)
  );

  let kind: LivedKind = "none";
  let checkedInMinute: PlanMinutes | null = null;
  let directionsViewed = false;
  let signal: LivedSignal | null = null;
  let undoTargetEntryId: string | null = null;

  for (const entry of effective) {
    const classification: LedgerClassification = entry.classification;
    if (classification === "DIRECTIONS_VIEWED") {
      directionsViewed = true;
      if (kind === "none") {
        kind = "directions-viewed";
        signal = DIRECTIONS_SIGNAL;
      }
    } else if (classification === "CHECKED_IN") {
      kind = "checked-in";
      checkedInMinute = entry.atMinuteOfTrip;
      signal = CHECK_IN_SIGNAL;
      undoTargetEntryId = entry.entryId;
    } else if (classification === "SKIPPED") {
      kind = "skipped";
      signal = SKIP_SIGNAL;
      undoTargetEntryId = entry.entryId;
    } else if (classification === "MISSED") {
      kind = "missed";
      signal = MISSED_SIGNAL;
      undoTargetEntryId = null;
    }
  }

  // Mirror production status when the ledger has not spoken yet
  // (actions taken through the pre-Build-2 surfaces).
  if (kind === "none" || kind === "directions-viewed") {
    if (activity.status === "checked_in") {
      kind = "checked-in";
      signal = CHECK_IN_SIGNAL;
    } else if (activity.status === "completed") {
      kind = "completed";
      signal = CHECK_IN_SIGNAL;
    } else if (activity.status === "skipped") {
      kind = "skipped";
      signal = SKIP_SIGNAL;
    } else if (activity.status === "missed") {
      kind = "missed";
      signal = MISSED_SIGNAL;
    }
  }
  if (kind === "checked-in" && activity.status === "completed") {
    kind = "completed";
  }

  let dwellMinutes: number | null = null;
  if (checkedInMinute !== null) {
    if (activity.completedAtMin !== null) {
      dwellMinutes = Math.max(0, activity.completedAtMin - checkedInMinute);
    } else if (nowMin > activity.endMin) {
      dwellMinutes = Math.max(0, activity.endMin - checkedInMinute);
    }
  }

  return {
    kind,
    effectiveEntries: effective,
    checkedInMinute,
    dwellMinutes,
    directionsViewed,
    signal,
    undoTargetEntryId
  };
}

/** Panel lifecycle for a lived item (BUILD2-SPEC §4 + §4.1). Stale
 *  and expired are DERIVED here — nothing is written, nothing is
 *  deleted; the ledger always retains the record. */
export function evaluateItemLifecycle(
  lived: ItemLivedState,
  activity: PanelActivityInput,
  nowMin: PlanMinutes
): { state: CompanionItemState; panelVisible: boolean; reason: string | null } {
  if (lived.kind === "checked-in" || lived.kind === "completed") {
    if (nowMin > activity.endMin + STALE_WINDOW_MIN) {
      return {
        state: "expired",
        panelVisible: false,
        reason:
          "checked-in activity ended and passed the stale window; removed from the panel, retained in the ledger"
      };
    }
    if (nowMin > activity.endMin) {
      return {
        state: "stale",
        panelVisible: true,
        reason: "checked-in activity time has passed; shown stale briefly before expiry"
      };
    }
    return { state: "checked-in", panelVisible: true, reason: null };
  }
  if (lived.kind === "skipped") {
    return { state: "skipped", panelVisible: true, reason: null };
  }
  if (lived.kind === "missed") {
    return { state: "missed", panelVisible: true, reason: null };
  }
  if (activity.endMin < nowMin) {
    // Untouched and over: the panel simply moves on (shadow rule).
    return { state: "upcoming", panelVisible: false, reason: null };
  }
  return { state: "upcoming", panelVisible: true, reason: null };
}

export type PanelAction = "directions" | "check-in" | "skip" | "undo" | "details";

export function availableActionsFor(
  lived: ItemLivedState,
  activity: PanelActivityInput
): PanelAction[] {
  if (lived.kind === "checked-in") return ["undo", "details"];
  if (lived.kind === "completed") return ["details"];
  if (lived.kind === "skipped") return ["undo", "details"];
  if (lived.kind === "missed") return ["details"];
  if (activity.kind === "flight") return ["details"];
  return ["directions", "check-in", "skip", "details"];
}

/* ------------------------------------------------------------------ */
/* Activity detail (the tap-through)                                   */
/* ------------------------------------------------------------------ */

export interface ActivityDetailView {
  id: string;
  itemId: string;
  headline: string;
  fields: {
    name: string;
    place: string;
    address: string | null;
    date: LocalDate;
    dateLabel: string;
    startLabel: string;
    endLabel: string;
    boardingLabel: string | null;
    status: string;
    bookingRef: string | null;
    prepaid: boolean;
    provenanceLabel: string;
  };
  leaveBy: LeaveByView | null;
  mapOptions: MapOptionView[];
  actions: PanelAction[];
  offlineReady: true;
}

export function buildActivityDetail(
  activity: PanelActivityInput,
  input: CompanionPanelInput,
  lived: ItemLivedState
): ActivityDetailView {
  return {
    id: `detail-${activity.id}`,
    itemId: activity.id,
    headline: `Hey, your next destination is ${activity.place}.`,
    fields: {
      name: activity.name,
      place: activity.place,
      address: activity.address,
      date: activity.date,
      dateLabel: panelDateLabel(activity.date),
      startLabel: minutesToClock(activity.startMin),
      endLabel: minutesToClock(activity.endMin),
      boardingLabel: activity.boardingMin !== null ? minutesToClock(activity.boardingMin) : null,
      status: activity.status,
      bookingRef: activity.bookingRef,
      prepaid: activity.prepaid,
      provenanceLabel: activity.provenanceLabel || "from your Roamly plan"
    },
    leaveBy: computeLeaveBy(activity, {
      bufferMin: input.bufferMin,
      currentPlace: input.currentPlace
    }),
    mapOptions: mapOptionsFor(activity, { citymapperCoverage: input.citymapperCoverage }),
    actions: availableActionsFor(lived, activity),
    offlineReady: true
  };
}

/* ------------------------------------------------------------------ */
/* The panel (notification views over ledger state)                    */
/* ------------------------------------------------------------------ */

export type PanelNotificationState = CompanionItemState | "collision";

export interface PanelNotificationView {
  id: string;
  itemId: string | null;
  state: PanelNotificationState;
  priority: "loud" | "important" | "routine";
  headline: string;
  body: string;
  timeLabel: string;
  place: string | null;
  actions: PanelAction[];
  checkInOpensMin: PlanMinutes | null;
  leaveBy: LeaveByView | null;
  mapChoices: MapChoiceDTO[];
  lived: ItemLivedState | null;
  detail: ActivityDetailView | null;
  panelVisible: boolean;
}

export interface CompanionPanelView {
  panelType: "persistent-live-companion-panel";
  tripId: string;
  destination: string;
  date: LocalDate;
  dateLabel: string;
  nowLabel: string;
  active: PanelNotificationView[];
  activeCount: number;
  offlineReady: true;
  floodRule: string;
}

export function buildCompanionPanel(input: CompanionPanelInput): CompanionPanelView {
  const notifications: PanelNotificationView[] = [];

  for (const alert of input.alerts) {
    notifications.push({
      id: alert.id,
      itemId: alert.itemId,
      state: "collision",
      priority: "loud",
      headline: alert.headline,
      body: alert.message,
      timeLabel: "",
      place: null,
      actions: ["details"],
      checkInOpensMin: null,
      leaveBy: null,
      mapChoices: [],
      lived: null,
      detail: null,
      panelVisible: true
    });
  }

  const dayItems = input.activities
    .filter((activity) => activity.date === input.date && isPanelKind(activity.kind))
    .slice()
    .sort((a, b) => a.startMin - b.startMin);
  const nextItem = dayItems.find((activity) => {
    if (activity.endMin < input.nowMin) return false;
    const lived = deriveItemLivedState(input.ledgerEntries, activity, input.nowMin);
    return lived.kind === "none" || lived.kind === "directions-viewed";
  });

  for (const activity of dayItems) {
    const lived = deriveItemLivedState(input.ledgerEntries, activity, input.nowMin);
    const lifecycle = evaluateItemLifecycle(lived, activity, input.nowMin);
    if (!lifecycle.panelVisible) continue;
    const detail = buildActivityDetail(activity, input, lived);

    if (lived.kind !== "none" && lived.kind !== "directions-viewed") {
      notifications.push({
        id: `note-${activity.id}`,
        itemId: activity.id,
        state: lifecycle.state,
        priority: "routine",
        headline: `${activity.name} — ${lifecycle.state}.`,
        body: lifecycle.reason || "Kept in your trip record.",
        timeLabel: "",
        place: activity.place,
        actions: availableActionsFor(lived, activity),
        checkInOpensMin: null,
        leaveBy: null,
        mapChoices: mapChoicesFor(activity, { citymapperCoverage: input.citymapperCoverage }),
        lived,
        detail,
        panelVisible: true
      });
      continue;
    }

    const leaveBy = computeLeaveBy(activity, {
      bufferMin: input.bufferMin,
      currentPlace: input.currentPlace
    });
    const isNext = Boolean(nextItem && activity.id === nextItem.id);
    const state: CompanionItemState =
      input.nowMin >= activity.startMin
        ? "current"
        : leaveBy && input.nowMin >= leaveBy.leaveByMin - LEAVE_BY_SURFACE_BEFORE_MIN
          ? "leave-by"
          : "upcoming";
    // Body copy adds information the time label does not already
    // carry — a human assistant does not repeat the hours.
    const body =
      state === "leave-by" && leaveBy
        ? leaveBy.voice
        : activity.prepaid
          ? `Prepaid${activity.boardingMin !== null ? ` — boarding at ${minutesToClock(activity.boardingMin)}` : ""}. We'll remind you when it's time to head over.`
          : activity.provenanceLabel
            ? `Booked — ${activity.provenanceLabel}.`
            : `Starts at ${minutesToClock(activity.startMin)}.`;
    notifications.push({
      id: `note-${activity.id}`,
      itemId: activity.id,
      state,
      priority: state === "leave-by" ? "important" : "routine",
      headline: isNext ? `Hey, your next destination is ${activity.place}.` : activity.name,
      body,
      timeLabel:
        activity.boardingMin !== null
          ? `Boarding ${minutesToClock(activity.boardingMin)} · departs ${minutesToClock(activity.startMin)}`
          : `${minutesToClock(activity.startMin)}–${minutesToClock(activity.endMin)}`,
      place: activity.place,
      actions: availableActionsFor(lived, activity),
      checkInOpensMin:
        activity.kind === "flight" ? null : activity.startMin - CHECK_IN_OPENS_BEFORE_MIN,
      leaveBy,
      mapChoices: mapChoicesFor(activity, { citymapperCoverage: input.citymapperCoverage }),
      lived,
      detail,
      panelVisible: true
    });
  }

  notifications.sort(
    (a, b) => (a.state === "collision" ? -1 : 0) - (b.state === "collision" ? -1 : 0)
  );

  return {
    panelType: "persistent-live-companion-panel",
    tripId: input.tripId,
    destination: input.destination,
    date: input.date,
    dateLabel: panelDateLabel(input.date),
    nowLabel: minutesToClock(input.nowMin),
    active: notifications,
    activeCount: notifications.length,
    offlineReady: true,
    floodRule:
      "Checked-in items go stale after their end time and expire from this panel after the stale window; the ledger keeps the record."
  };
}

/* ------------------------------------------------------------------ */
/* Compact surfaces (owner scale law, §4.2)                            */
/* ------------------------------------------------------------------ */

export interface CheckInControl {
  mode: "available" | "opens-at";
  label: string;
  opensMin: PlanMinutes | null;
  destructive: false;
}

export interface CompactPushView {
  brand: "Roamly";
  iconPath: string;
  ageLabel: "now";
  headline: string;
  practicalLine: string;
  actions: { id: "check-in" | "skip" | "details"; label: string }[];
  itemId: string | null;
}

export interface CompactStripView {
  stateLabel: string;
  name: string;
  leaveByLine: string;
  directions: DirectionsControl | null;
  checkIn: CheckInControl | null;
  skip: { label: "Skip"; destructive: false } | null;
  itemId: string | null;
}

export interface CompactRowView {
  id: string;
  itemId: string | null;
  state: PanelNotificationState;
  /** "slim" = the collapsed one-line confirmation (Checked in /
   *  Skipped); "row" = the full compact row. */
  mode: "row" | "slim";
  line: string | null;
  name: string;
  timeLabel: string;
  statusLine: string;
  directions: DirectionsControl | null;
  checkIn: CheckInControl | null;
  skip: { label: "Skip"; destructive: false } | null;
  affordances: PanelAction[];
  dwellMinutes: number | null;
  detailId: string | null;
}

export interface CompactSurfaces {
  push: CompactPushView | null;
  strip: CompactStripView | null;
  rows: CompactRowView[];
  scale: {
    push: { widthPx: 358; maxHeightPx: 110 };
    strip: { maxHeightPx: 112 };
    row: { maxHeightPx: 88 };
  };
}

function compactStatusLine(notification: PanelNotificationView): string {
  if (notification.state === "leave-by" && notification.leaveBy) {
    return notification.leaveBy.shortLine;
  }
  if (notification.state === "collision") return notification.body;
  const firstSentence = String(notification.body || "").split(". ")[0].replace(/\.$/, "");
  return firstSentence || notification.timeLabel || "";
}

export function buildCompactCompanionSurfaces(
  panel: CompanionPanelView,
  input: CompanionPanelInput
): CompactSurfaces {
  const activityById = new Map(input.activities.map((activity) => [activity.id, activity]));
  const active = panel.active.filter((notification) => notification.panelVisible !== false);
  const next =
    active.find((notification) =>
      ["leave-by", "current", "upcoming"].includes(notification.state)
    ) ||
    active[0] ||
    null;

  const checkInControlFor = (notification: PanelNotificationView): CheckInControl | null => {
    if (!notification.actions.includes("check-in")) return null;
    if (
      notification.checkInOpensMin !== null &&
      notification.checkInOpensMin > input.nowMin
    ) {
      return {
        mode: "opens-at",
        label: `Check-in opens ${minutesToClock(notification.checkInOpensMin)}`,
        opensMin: notification.checkInOpensMin,
        destructive: false
      };
    }
    return { mode: "available", label: "Check in", opensMin: null, destructive: false };
  };

  const directionsFor = (notification: PanelNotificationView): DirectionsControl | null => {
    if (!notification.itemId || notification.mapChoices.length === 0) return null;
    const activity = activityById.get(notification.itemId);
    if (!activity) return null;
    return directionsControlFor(activity, { citymapperCoverage: input.citymapperCoverage });
  };

  const rows: CompactRowView[] = active.map((notification) => {
    const slim =
      notification.state === "checked-in" ||
      notification.state === "stale" ||
      notification.state === "skipped";
    const place = notification.place || notification.headline;
    return {
      id: notification.id,
      itemId: notification.itemId,
      state: notification.state,
      mode: slim ? "slim" : "row",
      line: slim
        ? notification.state === "skipped"
          ? `Skipped · ${place}`
          : `Checked in · ${place}`
        : null,
      name: notification.place || notification.headline,
      timeLabel: notification.timeLabel || "",
      statusLine: compactStatusLine(notification),
      directions: slim ? null : directionsFor(notification),
      checkIn: slim ? null : checkInControlFor(notification),
      skip:
        !slim && notification.actions.includes("skip")
          ? { label: "Skip", destructive: false }
          : null,
      affordances: notification.actions,
      dwellMinutes: notification.lived?.dwellMinutes ?? null,
      detailId: notification.detail?.id || null
    };
  });

  const nextRow = next ? rows.find((row) => row.id === next.id) || null : null;
  const startLabel = next?.timeLabel
    ? next.timeLabel.split("·")[0].split("–")[0].trim()
    : "";

  return {
    push: next
      ? {
          brand: "Roamly",
          iconPath: ROAMLY_ICON_PATH,
          ageLabel: "now",
          headline: next.headline,
          practicalLine: next.leaveBy
            ? `Leave by ${next.leaveBy.leaveByLabel} · ${next.leaveBy.travelMin} min away · starts ${startLabel}`
            : next.timeLabel || "",
          actions: [
            ...(next.actions.includes("check-in")
              ? [{ id: "check-in" as const, label: "Check in" }]
              : []),
            ...(next.actions.includes("skip") ? [{ id: "skip" as const, label: "Skip" }] : []),
            { id: "details" as const, label: "Details" }
          ],
          itemId: next.itemId
        }
      : null,
    strip: next
      ? {
          stateLabel: `${String(next.state).replace("-", " ").toUpperCase()} · ${next.timeLabel || ""}`,
          name: next.place || next.headline,
          leaveByLine: next.leaveBy ? next.leaveBy.shortLine : compactStatusLine(next),
          directions: nextRow?.directions || null,
          checkIn: nextRow?.checkIn || null,
          skip: nextRow?.skip || null,
          itemId: next.itemId
        }
      : null,
    rows,
    scale: {
      push: { widthPx: 358, maxHeightPx: 110 },
      strip: { maxHeightPx: 112 },
      row: { maxHeightPx: 88 }
    }
  };
}

/** The per-item collapsed presentation (shadow compactPanelPresentation
 *  parity — used by the panel rows and the proof). */
export function compactItemPresentation(
  lived: ItemLivedState,
  activity: PanelActivityInput,
  nowMin: PlanMinutes
): {
  mode: "collapsed-confirmation" | "full-row";
  line: string;
  affordances: PanelAction[];
  lifecycleState: CompanionItemState;
  panelVisible: boolean;
  retainedInLedger: true;
} {
  const place = activity.place || activity.name;
  const lifecycle = evaluateItemLifecycle(lived, activity, nowMin);
  if (lived.kind === "checked-in" || lived.kind === "completed") {
    return {
      mode: "collapsed-confirmation",
      line: `Checked in · ${place}`,
      affordances: lifecycle.panelVisible && lived.kind === "checked-in" ? ["undo"] : [],
      lifecycleState: lifecycle.state,
      panelVisible: lifecycle.panelVisible,
      retainedInLedger: true
    };
  }
  if (lived.kind === "skipped") {
    return {
      mode: "collapsed-confirmation",
      line: `Skipped · ${place}`,
      affordances: ["undo"],
      lifecycleState: "skipped",
      panelVisible: true,
      retainedInLedger: true
    };
  }
  return {
    mode: "full-row",
    line: place,
    affordances: availableActionsFor(lived, activity),
    lifecycleState: lived.directionsViewed ? "upcoming" : "upcoming",
    panelVisible: lifecycle.panelVisible,
    retainedInLedger: true
  };
}

/* ------------------------------------------------------------------ */
/* Wallet pass view (the on-screen day pass; companionPass.ts builds   */
/* the platform payloads from this same view).                         */
/* ------------------------------------------------------------------ */

export interface WalletPassView {
  brand: "Roamly";
  logoPath: string;
  passTypeLabel: "Roamly Day Pass";
  travelerName: string | null;
  partyLabel: string | null;
  destination: string;
  date: LocalDate;
  dateLabel: string;
  headline: string;
  nextActivity: {
    id: string;
    name: string;
    place: string;
    startLabel: string;
    endLabel: string;
    bookingRef: string | null;
  } | null;
  essentials: {
    hotelName: string | null;
    hotelCheckInLabel: string | null;
    flightLabel: string | null;
    flightBookingRef: string | null;
  };
  offline: {
    ready: true;
    cachedAt: string | null;
    scope: string;
    pendingSyncActions: number;
    rule: string;
  };
}

export function buildWalletPassView(params: {
  destination: string;
  date: LocalDate;
  travelerName: string | null;
  partyLabel: string | null;
  activities: PanelActivityInput[];
  hotelName: string | null;
  hotelCheckInLabel: string | null;
  nowMin: PlanMinutes;
  cachedAt: string | null;
  pendingSyncActions: number;
}): WalletPassView {
  const dayItems = params.activities
    .filter((activity) => activity.date === params.date && isPanelKind(activity.kind))
    .slice()
    .sort((a, b) => a.startMin - b.startMin);
  const next =
    dayItems.find((activity) => activity.endMin >= params.nowMin) || dayItems[0] || null;
  const flight = dayItems.find((activity) => activity.kind === "flight") || null;
  return {
    brand: "Roamly",
    logoPath: ROAMLY_ICON_PATH,
    passTypeLabel: "Roamly Day Pass",
    travelerName: params.travelerName,
    partyLabel: params.partyLabel,
    destination: params.destination,
    date: params.date,
    dateLabel: panelDateLabel(params.date),
    headline: next
      ? `Hey, your next destination is ${next.place}.`
      : "Hey, your day is all set.",
    nextActivity: next
      ? {
          id: next.id,
          name: next.name,
          place: next.place,
          startLabel: minutesToClock(next.startMin),
          endLabel: minutesToClock(next.endMin),
          bookingRef: next.bookingRef
        }
      : null,
    essentials: {
      hotelName: params.hotelName,
      hotelCheckInLabel: params.hotelCheckInLabel,
      flightLabel: flight ? flight.name : null,
      flightBookingRef: flight ? flight.bookingRef : null
    },
    offline: {
      ready: true,
      cachedAt: params.cachedAt,
      scope: "Day pass, today's plan, booking references, provenance, and map choices",
      pendingSyncActions: params.pendingSyncActions,
      rule: "The day works with no signal; offline actions keep their original timestamps and sync later."
    }
  };
}

/* ------------------------------------------------------------------ */
/* Production-record adapter                                           */
/* ------------------------------------------------------------------ */

export interface ActivityRecordLike {
  id: string;
  title: string;
  status: string;
  time_label?: string | null;
  location_name?: string | null;
  category?: string | null;
  map_query?: string | null;
}

/** Tolerant trip-local time-label parse ("15:40–16:45", "3:40 PM -
 *  4:45 PM", "Boarding 20:15 · departs 20:30"). Returns null when the
 *  label carries no clock — untimed items never enter the panel's
 *  timed geometry (named adapter limit; exact instants arrive with
 *  the Phase 9 updater/bookings seam). */
export function parseTimeLabelToMinutes(label: string | null | undefined): {
  startMin: PlanMinutes;
  endMin: PlanMinutes;
  boardingMin: PlanMinutes | null;
} | null {
  if (!label) return null;
  const tokens: PlanMinutes[] = [];
  const pattern = /(\d{1,2}):(\d{2})\s*(AM|PM)?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(label)) !== null) {
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = (match[3] || "").toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    tokens.push(hours * 60 + minutes);
  }
  if (tokens.length === 0) return null;
  const hasBoarding = /boarding/i.test(label);
  if (hasBoarding && tokens.length >= 2) {
    return { boardingMin: tokens[0], startMin: tokens[1], endMin: tokens[2] ?? tokens[1] + 60 };
  }
  return {
    boardingMin: null,
    startMin: tokens[0],
    endMin: tokens[1] ?? tokens[0] + 60
  };
}

export function panelActivityFromRecord(
  record: ActivityRecordLike,
  ctx: { date: LocalDate }
): PanelActivityInput | null {
  const times = parseTimeLabelToMinutes(record.time_label);
  if (!times) return null;
  const category = (record.category || "").toLowerCase();
  const kind =
    category.includes("food") || category.includes("restaurant") || category.includes("dining")
      ? "food"
      : category.includes("flight")
        ? "flight"
        : category.includes("cruise")
          ? "cruise"
          : category.includes("museum")
            ? "museum"
            : category.includes("gallery")
              ? "gallery"
              : category.includes("park")
                ? "park"
                : category.includes("tour")
                  ? "tour"
                  : category.includes("transfer")
                    ? "transfer"
                    : category.includes("hotel")
                      ? "hotel"
                      : "activity";
  return {
    id: record.id,
    kind,
    name: record.title,
    place: record.location_name || record.map_query || record.title,
    address: null,
    date: ctx.date,
    startMin: times.startMin,
    endMin: times.endMin,
    boardingMin: times.boardingMin,
    status: record.status,
    prepaid: false,
    bookingRef: null,
    travelMin: null,
    mapMode: "place",
    latitude: null,
    longitude: null,
    provenanceLabel: null,
    completedAtMin: null
  };
}
