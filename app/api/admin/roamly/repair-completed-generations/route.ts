import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type GenerationJob = {
  id: string;
  trip_id: string;
  user_id: string;
  status: string | null;
  completed_at: string | null;
  updated_at: string | null;
  error_message?: string | null;
  last_error_message?: string | null;
};

function isCompletedJob(job: GenerationJob) {
  return (
    job.status === "completed" ||
    job.error_message === "STAGED_GENERATION_COMPLETED" ||
    job.last_error_message === "STAGED_GENERATION_COMPLETED"
  );
}

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

  const { data: jobs, error: jobsError } = await supabase
    .from("roamly_trip_generation_jobs")
    .select("id,trip_id,user_id,status,completed_at,updated_at,error_message,last_error_message")
    .eq("status", "completed")
    .is("completed_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (jobsError) {
    return NextResponse.json(
      { ok: false, step: "read_jobs", error: jobsError.message },
      { status: 500 }
    );
  }

  const completedJobs = ((jobs || []) as GenerationJob[]).filter(isCompletedJob);
  const repaired: Array<{ jobId: string; tripId: string; completedAt: string }> = [];

  for (const job of completedJobs) {
    const completedAt = job.updated_at || new Date().toISOString();

    const { error: jobError } = await supabase
      .from("roamly_trip_generation_jobs")
      .update({
        completed_at: completedAt,
        updated_at: completedAt
      })
      .eq("id", job.id);

    if (jobError) {
      return NextResponse.json(
        { ok: false, step: "update_job", jobId: job.id, error: jobError.message },
        { status: 500 }
      );
    }

    const { error: tripError } = await supabase
      .from("roamly_trips")
      .update({
        status: "completed",
        itinerary_status: "completed",
        updated_at: completedAt
      })
      .eq("id", job.trip_id)
      .eq("user_id", job.user_id);

    if (tripError) {
      return NextResponse.json(
        { ok: false, step: "update_trip", tripId: job.trip_id, error: tripError.message },
        { status: 500 }
      );
    }

    repaired.push({
      jobId: job.id,
      tripId: job.trip_id,
      completedAt
    });
  }

  return NextResponse.json({
    ok: true,
    repairedCount: repaired.length,
    repaired
  });
}
