export type CampaignPhotoCandidate = {
  id: string;
  media_url?: string | null;
  asset_type?: string | null;
  destination?: string | null;
  topic?: string | null;
  title?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  use_count?: number | null;
  last_used_at?: string | null;
  created_at?: string | null;
};

function text(value: unknown) { return String(value || "").trim(); }
function slug(value: unknown) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function metadataText(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) { const value = text(metadata?.[key]); if (value) return value; }
  return "";
}

function normalizedMediaUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return `${url.protocol}//${url.host}${url.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch {
    return raw.split(/[?#]/, 1)[0].toLowerCase().replace(/\/$/, "");
  }
}

/** Stable identities let signed URLs and duplicate DB rows represent one physical image. */
export function campaignAssetIdentityKeys(asset: CampaignPhotoCandidate) {
  const metadata = asset.metadata || {};
  const keys = new Set<string>();
  const add = (prefix: string, value: unknown) => {
    const normalized = text(value).toLowerCase();
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };

  add("id", asset.id);
  for (const key of ["contentSha256", "contentHash", "sha256", "imageHash", "assetHash", "fingerprint"]) {
    add("hash", metadata[key]);
  }
  for (const key of ["objectPath", "publicObjectPath", "storagePath", "path", "sourcePath"]) {
    add("path", metadata[key]);
  }
  add("url", normalizedMediaUrl(asset.media_url));
  return keys;
}
function isImage(asset: CampaignPhotoCandidate) {
  const type = text(asset.asset_type).toLowerCase();
  return type === "image" || type === "photo" || /\.(png|jpe?g|webp)(\?|$)/i.test(text(asset.media_url));
}

/** Prefer a destination/topic-bound photo, then use the approved image pool when the draft has no matching binding. */
export function selectCampaignPhotoAsset<T extends CampaignPhotoCandidate>(assets: T[], destination: string, topic: string) {
  return selectCampaignPhotoAssetDecision(assets, destination, topic).asset;
}

export function selectCampaignPhotoAssetDecision<T extends CampaignPhotoCandidate>(
  assets: T[],
  destination: string,
  topic: string,
  options: { excludedKeys?: ReadonlySet<string> } = {}
) {
  const destinationKey = slug(destination);
  const topicKey = slug(topic);
  const eligible = [...assets].filter((asset) => {
    if (!asset.id || !text(asset.media_url) || !isImage(asset)) return false;
    return true;
  });
  const bound = eligible.filter((asset) => {
    const metadata = asset.metadata || {};
    const assetDestination = slug(asset.destination || metadataText(metadata, "destination", "city", "location"));
    const assetTopic = slug(asset.topic || metadataText(metadata, "topic", "theme", "contentKey", "conceptKey"));
    return (assetDestination && assetDestination === destinationKey) || (assetTopic && assetTopic === topicKey);
  });
  const pool = bound.length ? bound : eligible;
  const excludedKeys = options.excludedKeys || new Set<string>();
  const available = pool.filter((asset) => ![...campaignAssetIdentityKeys(asset)].some((key) => excludedKeys.has(key)));
  const candidates = available.length ? available : pool;
  const asset = candidates.sort((a, b) => {
    const useDiff = Number(a.use_count || 0) - Number(b.use_count || 0);
    if (useDiff) return useDiff;
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return Date.parse(text(b.created_at)) - Date.parse(text(a.created_at));
  })[0] || null;
  return { asset, exhausted: Boolean(asset && !available.length) };
}
