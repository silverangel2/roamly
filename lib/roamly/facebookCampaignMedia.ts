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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function imageUrl(value: unknown) {
  const raw = text(value);
  if (!raw || /\.mp4(\?|#|$)/i.test(raw)) return "";
  return raw;
}

/**
 * Identity of the still photo a draft was built from.
 * Generated Reel MP4s and video object paths are not photo identities.
 */
export function sourcePhotoCandidateFromDraft(draft: {
  selected_media_asset_id?: unknown;
  selected_media_url?: unknown;
  metadata?: Record<string, unknown> | null;
}): CampaignPhotoCandidate | null {
  const metadata = record(draft.metadata);
  const library = record(metadata.facebookLibraryMedia);
  const generated = record(metadata.generatedReelVideo);
  const sourceAssetId = text(
    metadata.sourceMediaAssetId ||
    metadata.sourceImageAssetId ||
    library.sourceMediaAssetId ||
    library.sourceImageAssetId ||
    generated.sourceMediaAssetId ||
    generated.sourceImageAssetId
  );
  const sourceUrl = imageUrl(
    metadata.sourceMediaUrl ||
    metadata.sourceImageUrl ||
    library.sourceMediaUrl ||
    library.sourceImageUrl ||
    generated.sourceMediaUrl ||
    generated.sourceImageUrl
  );
  const selectedUrl = imageUrl(draft.selected_media_url);
  const photoUrl = sourceUrl || selectedUrl;
  const photoId = sourceAssetId || (photoUrl ? text(draft.selected_media_asset_id) : "");
  if (!photoId && !photoUrl) return null;
  const sourceMeta = record(metadata.sourceImageMetadata);
  return {
    id: photoId || "recent-source",
    media_url: photoUrl,
    asset_type: "image",
    metadata: {
      contentSha256: text(sourceMeta.contentSha256 || metadata.sourceContentSha256 || library.contentSha256 || generated.sourceContentSha256),
      objectPath: text(sourceMeta.objectPath || metadata.sourceObjectPath || library.sourceObjectPath || generated.sourceObjectPath)
    }
  };
}

function destinationMatches(assetPlace: string, wanted: string) {
  if (!assetPlace || !wanted) return false;
  if (assetPlace === wanted) return true;
  // "lisbon" matches "lisbon-portugal"; short tokens like "uk" do not.
  if (wanted.length < 4 || assetPlace.length < 4) return false;
  return assetPlace.startsWith(`${wanted}-`) || wanted.startsWith(`${assetPlace}-`);
}

/** Prefer a destination/topic-bound photo, then use the approved image pool when the draft has no matching binding. */
export function selectCampaignPhotoAsset<T extends CampaignPhotoCandidate>(assets: T[], destination: string, topic: string) {
  return selectCampaignPhotoAssetDecision(assets, destination, topic).asset;
}

export function selectCampaignPhotoAssetDecision<T extends CampaignPhotoCandidate>(
  assets: T[],
  destination: string,
  topic: string,
  options: {
    excludedKeys?: ReadonlySet<string>;
    reservedKeys?: ReadonlySet<string>;
    rotationIndex?: number;
    previousKeys?: ReadonlySet<string>;
  } = {}
) {
  const destinationKey = slug(destination);
  const topicKey = slug(topic);
  const eligible = [...assets].filter((asset) => {
    if (!asset.id || !text(asset.media_url) || !isImage(asset)) return false;
    return true;
  });
  const relevant = eligible.filter((asset) => {
    const metadata = asset.metadata || {};
    const assetDestination = slug(asset.destination || metadataText(metadata, "destination", "city", "location"));
    const assetTopic = slug(asset.topic || metadataText(metadata, "topic", "theme", "contentKey", "conceptKey"));
    return destinationMatches(assetDestination, destinationKey) || (assetTopic && assetTopic === topicKey);
  });
  const excludedKeys = options.excludedKeys || new Set<string>();
  const reservedKeys = options.reservedKeys || new Set<string>();
  const previousKeys = options.previousKeys;
  const blockedBy = (asset: T, keys: ReadonlySet<string>) =>
    [...campaignAssetIdentityKeys(asset)].some((key) => keys.has(key));
  const byLeastUsed = (a: T, b: T) => {
    const useDiff = Number(a.use_count || 0) - Number(b.use_count || 0);
    if (useDiff) return useDiff;
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return Date.parse(text(b.created_at)) - Date.parse(text(a.created_at));
  };
  const notBlocked = (asset: T) => !blockedBy(asset, excludedKeys) && !blockedBy(asset, reservedKeys);
  // Skip the photo just used when another candidate exists, even if use_count
  // was not updated. A single-photo pool still falls through below.
  const pickFresh = (list: T[]) => {
    const sorted = [...list].sort(byLeastUsed);
    if (!previousKeys || !previousKeys.size) return sorted[0] || null;
    return sorted.find((asset) => !blockedBy(asset, previousKeys)) || null;
  };

  const freshRelevant = relevant.filter(notBlocked);
  const relevantChoice = pickFresh(freshRelevant);
  if (relevantChoice) return { asset: relevantChoice, exhausted: false };

  const freshEligible = eligible.filter(notBlocked);
  const eligibleChoice = pickFresh(freshEligible);
  if (eligibleChoice) return { asset: eligibleChoice, exhausted: false };

  // Recency window covers every fresh photo. Continue through the full
  // eligible pool instead of restarting on the one destination-bound image.
  // Reservations still stop a generation batch from repeating early.
  if (!eligible.length) return { asset: null, exhausted: true };
  const ordered = [...eligible].sort(byLeastUsed);
  const unreserved = ordered.filter((asset) => !blockedBy(asset, reservedKeys));
  const rotation = unreserved.length ? unreserved : ordered;
  let start = (options.rotationIndex || 0) % rotation.length;
  if (previousKeys && previousKeys.size) {
    const previousIndex = rotation.findIndex((asset) => blockedBy(asset, previousKeys));
    if (previousIndex >= 0) start = (previousIndex + 1 + (options.rotationIndex || 0)) % rotation.length;
  }
  for (let step = 0; step < rotation.length; step += 1) {
    const candidate = rotation[(start + step) % rotation.length];
    if (previousKeys && previousKeys.size && blockedBy(candidate, previousKeys) && rotation.length > 1) continue;
    return { asset: candidate, exhausted: true };
  }
  return { asset: rotation[start] || null, exhausted: Boolean(rotation[start]) };
}

/**
 * Keep a draft's bound library photo when it has not been used recently.
 * When it has, take the next pool photo. The returned asset is the library
 * row, so photo credit/attribution stored on that row stays with the photo.
 */
export function selectAutopostPhotoForPost<T extends CampaignPhotoCandidate>(
  assets: T[],
  destination: string,
  topic: string,
  options: {
    bound?: T | null;
    excludedKeys?: ReadonlySet<string>;
    reservedKeys?: ReadonlySet<string>;
    rotationIndex?: number;
    previousKeys?: ReadonlySet<string>;
  } = {}
) {
  const bound = options.bound || null;
  const excludedKeys = options.excludedKeys || new Set<string>();
  const boundRepeated = Boolean(bound && [...campaignAssetIdentityKeys(bound)].some((key) => excludedKeys.has(key)));
  if (bound && !boundRepeated) return { asset: bound, exhausted: false };
  return selectCampaignPhotoAssetDecision(assets, destination, topic, {
    excludedKeys,
    reservedKeys: options.reservedKeys,
    rotationIndex: options.rotationIndex,
    previousKeys: options.previousKeys && options.previousKeys.size
      ? options.previousKeys
      : bound
        ? campaignAssetIdentityKeys(bound)
        : undefined
  });
}
