type BucketRecord = {
  id?: string;
  name?: string;
  public?: boolean;
};

type EnvLike = Record<string, string | undefined>;

type EnsurePublicBucketInput = {
  supabaseUrl: string;
  serviceKey: string;
  storageBucket: string;
  allowedMimeTypes: string[];
  fileSizeLimit: number;
  fetcher?: typeof fetch;
};

type PublicStorageUploadInput = EnsurePublicBucketInput & {
  objectPath: string;
  body: BodyInit;
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
  probeTimeoutMs?: number;
};

export type PublicUrlProbeResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

export const DEFAULT_ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET = "roamly-social-public";

const unsafePublicSocialBuckets = new Set(["roamly-private", "review-screenshots", "reviewintel-media"]);

function cleanSupabaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function defaultEnv(): EnvLike {
  return ((globalThis as { process?: { env?: EnvLike } }).process?.env || {}) as EnvLike;
}

function envFlagEnabled(env: EnvLike, name: string) {
  return ["1", "true", "yes", "on"].includes(String(env[name] || "").trim().toLowerCase());
}

function cleanBucketName(value?: string | null) {
  return String(value || "").trim();
}

export function publicSocialMediaStorageBucket(env: EnvLike = defaultEnv()) {
  const explicitRoamlyBucket = cleanBucketName(env.ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET);
  const explicitPublicBucket = cleanBucketName(env.SUPABASE_PUBLIC_SOCIAL_MEDIA_BUCKET);
  const legacySocialBucket = cleanBucketName(env.SUPABASE_SOCIAL_MEDIA_BUCKET);
  const storageBucket =
    explicitRoamlyBucket || explicitPublicBucket || legacySocialBucket || DEFAULT_ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET;
  const source = explicitRoamlyBucket
    ? "ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET"
    : explicitPublicBucket
      ? "SUPABASE_PUBLIC_SOCIAL_MEDIA_BUCKET"
      : legacySocialBucket
        ? "SUPABASE_SOCIAL_MEDIA_BUCKET"
        : "default";

  return { storageBucket, source };
}

export function assertSafePublicSocialMediaBucket(input: { storageBucket: string; env?: EnvLike }) {
  const storageBucket = cleanBucketName(input.storageBucket);
  const env = input.env || defaultEnv();

  if (!storageBucket) throw new Error("A public social media bucket is required.");
  if (unsafePublicSocialBuckets.has(storageBucket) && !envFlagEnabled(env, "ALLOW_SHARED_PUBLIC_SOCIAL_BUCKET")) {
    throw new Error(
      `${storageBucket} is reserved for private/shared media. Set ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET to a dedicated public bucket for Facebook-fetchable social assets.`
    );
  }

  return storageBucket;
}

function isPrivateOrLocalUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    return (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return true;
  }
}

function storageHeaders(serviceKey: string, extra?: Record<string, string>) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...(extra || {})
  };
}

async function responseDetail(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";

  try {
    const data = JSON.parse(text) as { message?: unknown; error?: unknown };
    return String(data.message || data.error || text);
  } catch {
    return text;
  }
}

async function readBucket(fetcher: typeof fetch, bucketUrl: string, serviceKey: string) {
  const response = await fetcher(bucketUrl, {
    headers: storageHeaders(serviceKey),
    cache: "no-store"
  });

  if (!response.ok) return { response, bucket: null };
  const bucket = (await response.json().catch(() => null)) as BucketRecord | null;
  return { response, bucket };
}

async function verifyPublicBucket(fetcher: typeof fetch, bucketUrl: string, serviceKey: string) {
  const { response, bucket } = await readBucket(fetcher, bucketUrl, serviceKey);

  if (!response.ok) throw new Error((await responseDetail(response)) || "Supabase Storage bucket could not be verified.");
  if (bucket?.public !== true) throw new Error("Supabase Storage bucket must be public before returning public media URLs.");

  return bucket;
}

export async function ensurePublicSupabaseStorageBucket(input: EnsurePublicBucketInput) {
  const supabaseUrl = cleanSupabaseUrl(input.supabaseUrl);
  const fetcher = input.fetcher || fetch;
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(input.storageBucket)}`;
  const payload = {
    public: true,
    file_size_limit: input.fileSizeLimit,
    allowed_mime_types: input.allowedMimeTypes
  };

  const lookup = await readBucket(fetcher, bucketUrl, input.serviceKey);

  if (lookup.response.ok) {
    if (lookup.bucket?.public === true) return lookup.bucket;

    const updated = await fetcher(bucketUrl, {
      method: "PUT",
      headers: storageHeaders(input.serviceKey),
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (!updated.ok) {
      throw new Error((await responseDetail(updated)) || "Supabase Storage bucket exists but could not be made public.");
    }

    return verifyPublicBucket(fetcher, bucketUrl, input.serviceKey);
  }

  if (lookup.response.status !== 404) {
    throw new Error((await responseDetail(lookup.response)) || "Supabase Storage bucket lookup failed.");
  }

  const created = await fetcher(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders(input.serviceKey),
    body: JSON.stringify({
      id: input.storageBucket,
      name: input.storageBucket,
      ...payload
    }),
    cache: "no-store"
  });

  if (!created.ok && created.status !== 409) {
    throw new Error((await responseDetail(created)) || "Supabase Storage media bucket could not be created.");
  }

  return verifyPublicBucket(fetcher, bucketUrl, input.serviceKey);
}

export function supabasePublicObjectUrl(input: { supabaseUrl: string; storageBucket: string; objectPath: string }) {
  return `${cleanSupabaseUrl(input.supabaseUrl)}/storage/v1/object/public/${encodeURIComponent(input.storageBucket)}/${input.objectPath}`;
}

export async function uploadPublicSupabaseObject(input: PublicStorageUploadInput) {
  const fetcher = input.fetcher || fetch;

  assertSafePublicSocialMediaBucket({ storageBucket: input.storageBucket });

  await ensurePublicSupabaseStorageBucket({
    supabaseUrl: input.supabaseUrl,
    serviceKey: input.serviceKey,
    storageBucket: input.storageBucket,
    allowedMimeTypes: input.allowedMimeTypes,
    fileSizeLimit: input.fileSizeLimit,
    fetcher
  });

  const supabaseUrl = cleanSupabaseUrl(input.supabaseUrl);
  const response = await fetcher(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(input.storageBucket)}/${input.objectPath}`,
    {
      method: "POST",
      headers: storageHeaders(input.serviceKey, {
        "Content-Type": input.contentType,
        "Cache-Control": input.cacheControl || "31536000",
        "x-upsert": input.upsert === false ? "false" : "true"
      }),
      body: input.body,
      cache: "no-store"
    }
  );

  if (!response.ok) throw new Error((await responseDetail(response)) || "Supabase Storage upload failed.");

  const publicUrl = supabasePublicObjectUrl({
    supabaseUrl,
    storageBucket: input.storageBucket,
    objectPath: input.objectPath
  });

  await assertFacebookAccessibleUrl({ url: publicUrl, fetcher, timeoutMs: input.probeTimeoutMs });
  return publicUrl;
}

async function fetchWithTimeout(fetcher: typeof fetch, input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(input, {
      ...init,
      signal: init.signal || controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function probeError(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") return "Media fetch timed out.";
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message || "");
    if (message) return message;
  }
  return fallback;
}

export async function probeFacebookAccessibleUrl(input: {
  url: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<PublicUrlProbeResult> {
  const url = String(input.url || "").trim();
  const fetcher = input.fetcher || fetch;
  const timeoutMs = Math.max(100, input.timeoutMs || 5000);

  if (!url) return { ok: false, error: "Media URL is missing." };
  if (isPrivateOrLocalUrl(url)) return { ok: false, error: "Media URL is private or local." };

  try {
    const head = await fetchWithTimeout(fetcher, url, { method: "HEAD", cache: "no-store" }, timeoutMs);
    if (head.ok) return { ok: true, status: head.status };
    if (head.status !== 405 && head.status !== 501) {
      return { ok: false, status: head.status, error: `Media HEAD returned HTTP ${head.status}.` };
    }
  } catch (error) {
    return { ok: false, error: probeError(error, "Media HEAD check failed.") };
  }

  try {
    const ranged = await fetchWithTimeout(
      fetcher,
      url,
      {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        cache: "no-store"
      },
      timeoutMs
    );

    return ranged.ok || ranged.status === 206
      ? { ok: true, status: ranged.status }
      : { ok: false, status: ranged.status, error: `Media range GET returned HTTP ${ranged.status}.` };
  } catch (error) {
    return { ok: false, error: probeError(error, "Media range GET check failed.") };
  }
}

export async function assertFacebookAccessibleUrl(input: { url: string; fetcher?: typeof fetch; timeoutMs?: number }) {
  const result = await probeFacebookAccessibleUrl(input);
  if (!result.ok) throw new Error(result.error || "Media URL is not publicly fetchable.");
  return result;
}
