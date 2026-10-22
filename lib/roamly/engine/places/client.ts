import { systemFetcher, type Fetcher } from "@/lib/roamly/engine/packs/collectors";
import {
  PLACES_DETAILS_FIELD_MASK,
  PLACES_TEXT_SEARCH_FIELD_MASK,
  type PlacesRawDetails,
  type PlacesTextSearchRequest,
  type PlacesTextSearchResponse
} from "@/lib/roamly/engine/places/types";

/*
 * The Places client boundary (DESIGN §2.5, Pattern B).
 *
 * Everything above this file — the enrichment service, the cost
 * guard, the distance gate — speaks to a PlacesClient, never to the
 * wire. Production injects HttpPlacesClient with Roamly's OWN
 * server-side key; proofs inject recorded/fake clients. The key is
 * a constructor argument, read from the environment ONLY by
 * placesClientFromEnv: it is never logged, never persisted, and
 * never written into a pack or a ledger record. ABSENT KEY = no
 * client = the provider is OFF and the engine behaves exactly as
 * the OSM-only build (the shadow's discipline, preserved).
 */

export interface PlacesClient {
  /** Provenance label stamped onto the records this client
   *  produces ("google" for the live provider). */
  readonly sourceLabel: string;
  textSearch(request: PlacesTextSearchRequest): Promise<PlacesTextSearchResponse>;
  placeDetails(placeId: string): Promise<PlacesRawDetails>;
}

export class PlacesProviderError extends Error {
  /** HTTP status when the provider answered with an error;
   *  null for transport failures (timeout, DNS, abort). */
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "PlacesProviderError";
    this.status = status;
  }
}

export interface PlacesHttpPolicy {
  /** Bounded per-call timeout (AbortController) — an enrichment
   *  call never hangs a job: a timeout surfaces as an error, and
   *  the ledger moves the reservation to RECONCILIATION (the call
   *  may have reached Google; it is never blindly retried). */
  attemptTimeoutMs: number;
}

export const DEFAULT_PLACES_HTTP_POLICY: PlacesHttpPolicy = { attemptTimeoutMs: 10_000 };

const PLACES_BASE_URL = "https://places.googleapis.com/v1";

export class HttpPlacesClient implements PlacesClient {
  readonly sourceLabel = "google";
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly policy: PlacesHttpPolicy;

  constructor(apiKey: string, fetcher: Fetcher = systemFetcher, policy: PlacesHttpPolicy = DEFAULT_PLACES_HTTP_POLICY) {
    if (!apiKey) throw new PlacesProviderError("HttpPlacesClient requires an API key (absent key = provider off, no client)", null);
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.policy = policy;
  }

  private async call<T>(url: string, init: { method?: string; headers: Record<string, string>; body?: string }): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The timeout is a RACE, not only an abort: the signal cancels a
    // well-behaved fetch's socket, and the race guarantees the bound
    // even against a transport that ignores signals — an enrichment
    // call must never hang its job.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new PlacesProviderError(`Places call exceeded the ${this.policy.attemptTimeoutMs} ms bound`, null));
      }, this.policy.attemptTimeoutMs);
    });
    const work = (async (): Promise<T> => {
      const res = await this.fetcher(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new PlacesProviderError(`Places API answered HTTP ${res.status}`, res.status);
      }
      return JSON.parse(text) as T;
    })();
    try {
      return await Promise.race([work, timeout]);
    } catch (err) {
      if (err instanceof PlacesProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new PlacesProviderError(`Places call failed before a usable response: ${message}`, null);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async textSearch(request: PlacesTextSearchRequest): Promise<PlacesTextSearchResponse> {
    return this.call<PlacesTextSearchResponse>(`${PLACES_BASE_URL}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": PLACES_TEXT_SEARCH_FIELD_MASK
      },
      body: JSON.stringify(request)
    });
  }

  async placeDetails(placeId: string): Promise<PlacesRawDetails> {
    return this.call<PlacesRawDetails>(`${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": PLACES_DETAILS_FIELD_MASK
      }
    });
  }
}

/** Build the production client from the environment — the ONLY
 *  place the key is read. Returns null when GOOGLE_PLACES_API_KEY
 *  is absent: provider OFF, OSM-only, engine identical (design
 *  rollback posture). The owner pastes the key into Vercel
 *  (Production) himself; nothing here can see the agent-side
 *  connector's key, by construction. */
export function placesClientFromEnv(env: Record<string, string | undefined>): PlacesClient | null {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  return new HttpPlacesClient(key);
}
