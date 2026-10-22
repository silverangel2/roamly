/*
 * Caller resolution for the Build 2 gate API routes (Phase 6).
 *
 * Two ways a phone legitimately identifies itself to the gate routes:
 *  1. A normal Supabase session (requireUser) — the usual case.
 *  2. The handoff phone-session binding cookie — a phone that scanned
 *     the desktop QR pass and was never signed in. The binding is
 *     scoped to (userId, tripId, deviceId); it authorizes gate reads
 *     and attestation writes for that binding only.
 *
 * Gate records are service-role tables (M1), so the store runs on the
 * admin client once identity is established; Gmail reads run on the
 * caller's session client when there is one, else the admin client.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/roamly/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGateStore, type GateStore } from "@/lib/roamly/gateService";
import {
  HANDOFF_COOKIE_NAME,
  verifyHandoffSessionCookie
} from "@/lib/roamly/handoffTokens";
import type { UtcInstant } from "@/lib/roamly/engine/time";

export interface GateCaller {
  userId: string;
  /** Present when the caller arrived via a handoff binding. */
  handoffTripId: string | null;
  handoffDeviceId: string | null;
  /** Client for source-of-truth reads (email_connections). */
  readClient: SupabaseClient;
  store: GateStore;
}

export async function resolveGateCaller(
  request: NextRequest
): Promise<{ ok: true; caller: GateCaller } | { ok: false; response: NextResponse }> {
  const admin = createSupabaseAdminClient();

  const auth = await requireUser().catch(() => null);
  if (auth && auth.ok) {
    const storeClient = admin ?? auth.supabase;
    return {
      ok: true,
      caller: {
        userId: auth.user.id,
        handoffTripId: null,
        handoffDeviceId: null,
        readClient: auth.supabase,
        store: createSupabaseGateStore(storeClient)
      }
    };
  }

  const cookieValue = request.cookies.get(HANDOFF_COOKIE_NAME)?.value;
  const binding = verifyHandoffSessionCookie(cookieValue, {
    now: new Date().toISOString() as UtcInstant
  });
  if (binding && admin) {
    return {
      ok: true,
      caller: {
        userId: binding.userId,
        handoffTripId: binding.tripId,
        handoffDeviceId: binding.deviceId,
        readClient: admin,
        store: createSupabaseGateStore(admin)
      }
    };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error: "AUTH_REQUIRED", message: "Please log in to continue." },
      { status: 401 }
    )
  };
}
