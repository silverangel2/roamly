import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  publicSocialMediaStorageBucket,
  uploadPublicSupabaseObject
} from "@/lib/roamly/publicSocialStorage";
import { withBrandMetadata } from "@/lib/roamly/socialCaptions";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 50;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function randomObjectId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type UploadItemMeta = {
  title?: unknown;
  destination?: unknown;
  topic?: unknown;
};

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const supabaseUrl = String(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
  ).trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart form data." }, { status: 400 });
  }

  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const single = form.get("file");
  if (single instanceof File && single.size > 0) files.unshift(single);

  if (!files.length) {
    return NextResponse.json({ ok: false, error: "No image files provided." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { ok: false, error: `Too many files (max ${MAX_FILES}).` },
      { status: 400 }
    );
  }

  let items: UploadItemMeta[] = [];
  const itemsRaw = form.get("items");
  if (typeof itemsRaw === "string" && itemsRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(itemsRaw);
      if (Array.isArray(parsed)) items = parsed as UploadItemMeta[];
    } catch {
      items = [];
    }
  }
  const defaultTitle = clean(form.get("title"), 160);
  const defaultDestination = clean(form.get("destination"), 160);
  const defaultTopic = clean(form.get("topic"), 500);

  const { storageBucket } = publicSocialMediaStorageBucket();
  const uploaded: Array<{ id: string; title: string; destination: string | null; media_url: string }> = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const meta = items[index] || {};
    const title =
      clean(meta.title, 160) ||
      defaultTitle ||
      clean(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), 160) ||
      `Uploaded photo ${index + 1}`;
    const destination = clean(meta.destination, 160) || defaultDestination;
    const topic = clean(meta.topic, 500) || defaultTopic;

    try {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new Error(`Unsupported image type: ${file.type || "unknown"}. Use JPEG, PNG, or WebP.`);
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
      }

      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const objectPath = `social/images/manual-upload-${randomObjectId()}.${extension}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const publicUrl = await uploadPublicSupabaseObject({
        supabaseUrl,
        serviceKey,
        storageBucket,
        objectPath,
        body: new Blob([new Uint8Array(buffer)], { type: file.type }),
        contentType: file.type,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
        fileSizeLimit: MAX_FILE_BYTES
      });

      const { data, error } = await guard.admin
        .from("roamly_social_media_assets")
        .insert({
          platform: "facebook_roamly",
          status: "approved",
          title,
          media_url: publicUrl,
          asset_type: "image",
          source: "manual_admin_upload",
          destination: destination || null,
          topic: topic || null,
          approved_for_automation: true,
          excluded_from_automation: false,
          use_count: 0,
          is_vertical: true,
          metadata: withBrandMetadata("roamly", {
            uploaded_via: "admin_media_upload",
            uploaded_at: new Date().toISOString(),
            original_filename: file.name,
            mime_type: file.type,
            file_size_bytes: file.size,
            object_path: objectPath
          })
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);
      uploaded.push({ id: data.id, title, destination: destination || null, media_url: publicUrl });
    } catch (error) {
      failed.push({
        file: file.name,
        error: error instanceof Error ? error.message : "Upload failed."
      });
    }
  }

  await guard.admin.from("roamly_admin_activity_logs").insert({
    actor_email: guard.user.email || guard.user.id,
    action: "media_bulk_upload",
    target_type: "social_media_asset",
    target_id: null,
    status: failed.length ? "partial" : "completed",
    metadata: { uploaded: uploaded.length, failed: failed.length }
  });

  return NextResponse.json({
    ok: failed.length === 0,
    uploaded,
    failed,
    counts: { uploaded: uploaded.length, failed: failed.length }
  });
}
