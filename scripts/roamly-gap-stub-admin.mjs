// GAP-CLOSURE WAVE 3 — test-only stand-in for @/lib/supabase/admin.
// The suite installs its fake client on globalThis before importing
// the real worker graph; processGenerationQueue constructs its own
// admin client internally, so this redirect is the injection seam
// (template: roamly-e2e-fixes-2026-10-23/fix1/harness/stub-admin.mjs).
export function createSupabaseAdminClient() {
  return globalThis.__roamlyFakeSupabase ?? null;
}
