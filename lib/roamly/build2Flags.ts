/*
 * Build 2 feature flags (DESIGN-PRODUCTION.md §2.6).
 *
 * All Build 2 flags default OFF. A phase changes no traveler-visible
 * behavior until its flag turns on, and every flag turns on first for
 * the tester lane. Flag parsing matches the Phase 5 zero-engine law:
 * the value must be one of {1, true, on, yes} (case-insensitive);
 * anything else — including an unset variable — is OFF.
 *
 * The umbrella flag ROAMLY_BUILD2_ENABLED defaults every sub-flag to
 * it: a sub-flag is on when its own variable is truthy OR the umbrella
 * is truthy. There is deliberately no "explicit off beats umbrella"
 * reading — deployments enable exactly the lanes they mean to.
 */

type EnvLike = Record<string, string | undefined>;

function flagOn(raw: string | undefined): boolean {
  const value = (raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function build2Enabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_ENABLED);
}

export function build2GatesEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_GATES_ENABLED) || build2Enabled(env);
}

export function build2CompanionEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_COMPANION_ENABLED) || build2Enabled(env);
}

export function build2ReconciliationSilentEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED) || build2Enabled(env);
}

export function build2UpdaterEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_UPDATER_ENABLED) || build2Enabled(env);
}

export function build2PostTripEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_POSTTRIP_ENABLED) || build2Enabled(env);
}

export function build2LifecycleEnabled(env: EnvLike = process.env): boolean {
  return flagOn(env.ROAMLY_BUILD2_LIFECYCLE_ENABLED) || build2Enabled(env);
}
