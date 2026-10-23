import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { readGmailGateView } from "@/lib/roamly/gateService";
import { getRoamlySetupState, setupMemoryFromUser } from "@/lib/roamly/setupState";

/*
 * Records a setup step as completed — once, remembered forever
 * (owner design, 2026-10-23). Each step is recorded only on evidence
 * the server can stand behind:
 *
 *  - gmail:    the email_connections row is in a connected state
 *              (readGmailGateView is the source of truth).
 *  - app:      the client reports a real standalone detection
 *              (display-mode standalone / iOS home-screen launch).
 *              Nothing else is accepted — install is never faked.
 *  - location: a fresh location fix landed through the real location
 *              pipeline moments ago (last_seen_at), proving the
 *              browser grant exists; the grant is then recorded in
 *              roamly_location_settings.last_permission_state.
 *
 * The memory lives on the account (user_metadata.roamly_setup), never
 * on a trip.
 */

const STEPS = new Set(["gmail", "app", "location"]);

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const step = typeof body.step === "string" ? body.step : "";
  if (!STEPS.has(step)) {
    return NextResponse.json({ ok: false, error: "Unknown setup step." }, { status: 400 });
  }

  if (step === "gmail") {
    const view = await readGmailGateView(auth.supabase, auth.user.id).catch(() => null);
    if (!view || (view.state !== "CONNECTED" && view.state !== "RECONCILIATION_ARMED")) {
      return NextResponse.json(
        { ok: false, error: "Gmail is not connected yet." },
        { status: 409 }
      );
    }
  }

  if (step === "app") {
    if (body.evidence !== "standalone") {
      return NextResponse.json(
        { ok: false, error: "Install is recorded only when Roamly is opened from the home screen or its app window." },
        { status: 409 }
      );
    }
  }

  if (step === "location") {
    const { data: settings } = await auth.supabase
      .from("roamly_location_settings")
      .select("last_permission_state,last_seen_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const row = settings as { last_permission_state?: string | null; last_seen_at?: string | null } | null;
    const freshFix =
      row?.last_seen_at != null &&
      Date.now() - new Date(String(row.last_seen_at)).getTime() < 10 * 60_000;
    if (row?.last_permission_state !== "granted" && !freshFix) {
      return NextResponse.json(
        { ok: false, error: "No fresh location fix confirms the grant yet." },
        { status: 409 }
      );
    }
    if (row?.last_permission_state !== "granted") {
      const { error } = await auth.supabase.from("roamly_location_settings").upsert(
        { user_id: auth.user.id, last_permission_state: "granted" },
        { onConflict: "user_id" }
      );
      if (error) {
        return NextResponse.json({ ok: false, error: "Could not record the location grant." }, { status: 500 });
      }
    }
  }

  const memory = setupMemoryFromUser(auth.user);
  const { error: updateError } = await auth.supabase.auth.updateUser({
    data: { roamly_setup: { ...memory, [step]: true } }
  });
  if (updateError) {
    return NextResponse.json(
      { ok: false, error: "Could not save the setup step." },
      { status: 500 }
    );
  }

  const { data: refreshed } = await auth.supabase.auth.getUser();
  const state = await getRoamlySetupState(auth.supabase, refreshed?.user || auth.user);
  return NextResponse.json({ ok: true, state });
}
