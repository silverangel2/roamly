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
function isImage(asset: CampaignPhotoCandidate) {
  const type = text(asset.asset_type).toLowerCase();
  return type === "image" || type === "photo" || /\.(png|jpe?g|webp)(\?|$)/i.test(text(asset.media_url));
}

/** Select only an approved, destination/topic-bound photo for an automatic campaign item. */
export function selectCampaignPhotoAsset<T extends CampaignPhotoCandidate>(assets: T[], destination: string, topic: string) {
  const destinationKey = slug(destination);
  const topicKey = slug(topic);
  return [...assets].filter((asset) => {
    if (!asset.id || !text(asset.media_url) || !isImage(asset)) return false;
    const metadata = asset.metadata || {};
    const assetDestination = slug(asset.destination || metadataText(metadata, "destination", "city", "location"));
    const assetTopic = slug(asset.topic || metadataText(metadata, "topic", "theme", "contentKey", "conceptKey"));
    if (assetDestination && assetDestination !== destinationKey) return false;
    if (assetTopic && assetTopic !== topicKey) return false;
    return Boolean((assetDestination && assetDestination === destinationKey) || (assetTopic && assetTopic === topicKey));
  }).sort((a, b) => {
    const useDiff = Number(a.use_count || 0) - Number(b.use_count || 0);
    if (useDiff) return useDiff;
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return Date.parse(text(b.created_at)) - Date.parse(text(a.created_at));
  })[0] || null;
}
