/** Browser draft ownership for the planner. Storage only — not the planner algorithm. */

export const PLAN_DRAFT_KEY = "roamly.plan.draft.v1";
export const GUEST_PLAN_DRAFT_KEY = "roamly.plan.draft.v1:guest";

export type PlanDraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function accountPlanDraftKey(userId: string) {
  return `${PLAN_DRAFT_KEY}:user:${userId}`;
}

export function draftOwnerId(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ownerUserId?: unknown };
    return typeof parsed.ownerUserId === "string" && parsed.ownerUserId.trim() ? parsed.ownerUserId.trim() : null;
  } catch {
    return null;
  }
}

/** Logout drops the shared key so the next guest cannot resume another account's draft. */
export function clearPlannerDraftOnLogout(localStorage: PlanDraftStorage, sessionStorage?: PlanDraftStorage) {
  localStorage.removeItem(PLAN_DRAFT_KEY);
  sessionStorage?.removeItem(GUEST_PLAN_DRAFT_KEY);
}

export function readRestorablePlanDraft(input: {
  userId: string | null;
  localStorage: PlanDraftStorage;
  sessionStorage: PlanDraftStorage;
}): { raw: string; source: "account" | "guest" | "legacy" } | null {
  if (input.userId) {
    const account = input.localStorage.getItem(accountPlanDraftKey(input.userId));
    if (account) return { raw: account, source: "account" };
    const legacy = input.localStorage.getItem(PLAN_DRAFT_KEY);
    const owner = draftOwnerId(legacy);
    if (legacy && (owner == null || owner === input.userId)) return { raw: legacy, source: "legacy" };
    return null;
  }

  const guest = input.sessionStorage.getItem(GUEST_PLAN_DRAFT_KEY);
  return guest ? { raw: guest, source: "guest" } : null;
}

export function writeOwnedPlanDraft(input: {
  userId: string | null;
  raw: string;
  localStorage: PlanDraftStorage;
  sessionStorage: PlanDraftStorage;
}) {
  if (input.userId) {
    input.localStorage.setItem(accountPlanDraftKey(input.userId), input.raw);
    input.localStorage.removeItem(PLAN_DRAFT_KEY);
    return;
  }
  input.sessionStorage.setItem(GUEST_PLAN_DRAFT_KEY, input.raw);
  input.localStorage.removeItem(PLAN_DRAFT_KEY);
}

export function clearOwnedPlanDraft(input: {
  userId: string | null;
  localStorage: PlanDraftStorage;
  sessionStorage: PlanDraftStorage;
}) {
  if (input.userId) input.localStorage.removeItem(accountPlanDraftKey(input.userId));
  input.sessionStorage.removeItem(GUEST_PLAN_DRAFT_KEY);
  input.localStorage.removeItem(PLAN_DRAFT_KEY);
}

export function browserPlanDraftStorages(): { localStorage: PlanDraftStorage; sessionStorage: PlanDraftStorage } | null {
  if (typeof window === "undefined") return null;
  return { localStorage: window.localStorage, sessionStorage: window.sessionStorage };
}
