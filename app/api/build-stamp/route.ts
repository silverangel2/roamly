import { NextResponse } from "next/server";

/**
 * GET /api/build-stamp — self-report of the deployed build.
 *
 * No auth, no secrets: it exposes only the app name and the deployed
 * commit SHA (the Vercel system env var, present at runtime on Vercel;
 * null on local/dev). Purpose: lets the Deploy Doctor keeper lane — and
 * external verification — confirm WHICH build is actually serving
 * production after a merge. The keeper reads its own process.env
 * directly; this endpoint is the outside world's read of the same fact.
 *
 * Residency note: the stamp is read-only introspection of the app
 * itself. Nothing is written, nothing is configured, nothing leaves
 * Roamly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "roamly",
    buildSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
