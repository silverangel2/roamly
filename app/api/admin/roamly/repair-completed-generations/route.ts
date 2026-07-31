import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueTableMissing, reconcileCompletedGenerationJobs } from "@/lib/roamly/generationQueue";
import { recoverCompletedStoredGenerations } from "@/lib/roamly/generationFinalization";

export async function POST(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("confirm") !== "repair-completed-generations") {
    return NextResponse.json(
      { ok: false, error: "CONFIRMATION_REQUIRED" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_MISSING" },
      { status: 500 }
    );
  }

  const result = await reconcileCompletedGenerationJobs({ supabase, limit: 50 });
  if (!result.ok && !queueTableMissing(result.error)) {
    return NextResponse.json(
      { ok: false, step: "reconcile_completed_generation_jobs", error: result.error },
      { status: 500 }
    );
  }

  const recovered = await recoverCompletedStoredGenerations({ supabase, limit: 50 });
  if (!recovered.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: "recover_completed_stored_generations",
        error: recovered.error,
        queue: result
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    repairedCount: (result.ok ? result.repairedCount || 0 : 0) + recovered.repairedCount,
    repaired: [...(result.ok ? result.repaired : []), ...recovered.repaired],
    queue: result,
    recovery: recovered
  });
}
