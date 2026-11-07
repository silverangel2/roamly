/*
 * boundedFetch — the shared hardening pattern for outbound HTTP
 * (wiring audit 2026-11-07).
 *
 * The failure this exists to prevent: a network call whose
 * connection stalls — socket open, no bytes, no error — hangs the
 * caller FOREVER when the fetch carries no deadline. Measured on
 * the wiring-ship suite: a single PostgREST settings read through
 * a stock supabase-js client sat open for 400+ seconds (killed by
 * the harness timeout) because supabase-js installs no timeout of
 * its own, and the runtime's defaults did not rescue it through
 * the proxy agent. The same stall on a live path hangs a
 * generation job or a request in exactly the same way.
 *
 * The pattern: every outbound fetch gets an AbortController with
 * a bounded timer, chained with the caller's own signal when one
 * is supplied. Healthy-network behaviour is the caller's own
 * fetch, unchanged; the timer only ever fires on a stall, and
 * when it fires the call surfaces an AbortError that the caller's
 * existing error handling already knows how to degrade on.
 */

/** One fetch with a hard deadline. `init` passes through untouched
 *  apart from the chained abort signal (so Next's `next` fetch
 *  options keep working). */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: (RequestInit & { next?: unknown }) | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const initSignal =
    init && "signal" in init ? (init.signal as AbortSignal | null | undefined) : undefined;
  const inputSignal =
    typeof input === "object" && input !== null && "signal" in input
      ? ((input as { signal?: AbortSignal }).signal ?? undefined)
      : undefined;
  const callerSignal = initSignal ?? inputSignal;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

/** A fetch implementation with a per-call deadline, for clients
 *  that accept a fetch override (supabase-js `global.fetch`). */
export function createBoundedFetch(timeoutMs: number): typeof fetch {
  return (input, init) => fetchWithTimeout(input, init, timeoutMs);
}

/** PostgREST reads/writes in this app are small rows and bounded
 *  batches; 60 s is roughly two orders of magnitude over observed
 *  healthy latency and far inside the 300 s function budget — it
 *  exists only to convert an infinite stall into a surfaced
 *  error, never to cut a healthy call short. */
export const SUPABASE_FETCH_TIMEOUT_MS = 60_000;
