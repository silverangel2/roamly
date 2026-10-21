export const runtime = "nodejs";
// 300s (was 90s): the background generation chain armed by this route runs
// inside after() under this cap, and a hard kill at the old 90s cap is the
// prime suspect for drivers dying mid-stage. The cap is a ceiling, not a
// reservation — the request itself still returns as soon as generation is
// queued, and the chain stops when the trip is terminal or busy.
export const maxDuration = 300;

export { POST } from "@/lib/roamly/tripGenerationRoute";
