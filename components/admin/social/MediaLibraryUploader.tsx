"use client";

import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";

const DESTINATION_OPTIONS = [
  "Lisbon",
  "Vancouver",
  "Tokyo",
  "Barcelona",
  "New York",
  "Banff",
  "Seoul",
  "Mexico City",
  "Paris",
  "San Diego",
  "Montreal",
  "Chicago",
  "Rome",
  "Reykjavik",
  "Quebec City",
  "London",
  "Oaxaca",
  "Costa Rica",
  "Amsterdam",
  "Cape Town"
];

const SLUG_TO_DESTINATION: Record<string, string> = {
  amsterdam: "Amsterdam",
  banff: "Banff",
  barcelona: "Barcelona",
  "cape-town": "Cape Town",
  chicago: "Chicago",
  "costa-rica": "Costa Rica",
  lisbon: "Lisbon",
  london: "London",
  "mexico-city": "Mexico City",
  montreal: "Montreal",
  "new-york": "New York",
  oaxaca: "Oaxaca",
  paris: "Paris",
  "quebec-city": "Quebec City",
  reykjavik: "Reykjavik",
  rome: "Rome",
  "san-diego": "San Diego",
  seoul: "Seoul",
  tokyo: "Tokyo",
  vancouver: "Vancouver"
};

// Vercel caps serverless request bodies (~4.5MB), so batch by total size.
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

function detectDestination(filename: string) {
  const match = filename.toLowerCase().match(/media-generation-(.+?)-\d+-0-[0-9a-f-]+\.webp$/);
  if (match && SLUG_TO_DESTINATION[match[1]]) return SLUG_TO_DESTINATION[match[1]];
  return "";
}

function detectPhotoNumber(filename: string) {
  const match = filename.match(/media-generation-.+?-(\d+)-0-/);
  return match ? match[1] : "";
}

function cleanTitle(filename: string) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/^media generation /, "")
    .trim()
    .slice(0, 160);
}

type UploadResult = { file: string; ok: boolean; error?: string };

export function MediaLibraryUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [destinationOverride, setDestinationOverride] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<UploadResult[]>([]);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);

  function pickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []).filter(
      (file) => file.size > 0 && /^image\/(jpeg|png|webp)$/.test(file.type)
    );
    setFiles(picked);
    setResults([]);
    setProgress({ done: 0, total: 0 });
  }

  async function upload() {
    if (!files.length || uploading) return;
    setUploading(true);
    setResults([]);
    setProgress({ done: 0, total: files.length });

    // Size-based batches.
    const batches: File[][] = [];
    let current: File[] = [];
    let currentBytes = 0;
    for (const file of files) {
      if (current.length && currentBytes + file.size > MAX_BATCH_BYTES) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(file);
      currentBytes += file.size;
    }
    if (current.length) batches.push(current);

    const allResults: UploadResult[] = [];
    let done = 0;

    for (const batch of batches) {
      const form = new FormData();
      const items = batch.map((file) => {
        const destination = destinationOverride || detectDestination(file.name);
        const photoNumber = detectPhotoNumber(file.name);
        const title = destination
          ? `${destination} travel photo${photoNumber ? ` ${photoNumber}` : ""}`
          : cleanTitle(file.name) || `Uploaded photo`;
        return { title, destination: destination || undefined };
      });
      batch.forEach((file) => form.append("files", file, file.name));
      form.append("items", JSON.stringify(items));

      try {
        const response = await fetch("/api/admin/roamly/social/media/upload", {
          method: "POST",
          body: form
        });
        const data = (await response.json().catch(() => ({}))) as {
          uploaded?: Array<{ title: string }>;
          failed?: Array<{ file: string; error: string }>;
        };
        const uploadedByIndex = new Map(
          (data.uploaded || []).map((item, index) => [index, item])
        );
        batch.forEach((file, index) => {
          const failedEntry = (data.failed || []).find((entry) => entry.file === file.name);
          if (failedEntry) {
            allResults.push({ file: file.name, ok: false, error: failedEntry.error });
          } else if (!response.ok && !uploadedByIndex.has(index)) {
            allResults.push({ file: file.name, ok: false, error: `Request failed (HTTP ${response.status}).` });
          } else {
            allResults.push({ file: file.name, ok: true });
          }
        });
      } catch (error) {
        batch.forEach((file) =>
          allResults.push({
            file: file.name,
            ok: false,
            error: error instanceof Error ? error.message : "Upload failed."
          })
        );
      }

      done += batch.length;
      setProgress({ done, total: files.length });
      setResults([...allResults]);
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok).length;

  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Add photos</p>
      <h2 className="mt-2 text-xl font-black text-ink">Upload to the content library</h2>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
        New photos are approved for the autopost rotation immediately. Tag a destination so
        campaign drafts prefer matching photos.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-[#d8e2da] bg-mist px-4 py-6 text-center text-sm font-black text-slate-500 transition hover:border-ocean hover:text-ink">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={pickFiles}
            disabled={uploading}
          />
          {files.length
            ? `${files.length} photo${files.length === 1 ? "" : "s"} selected (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`
            : "Choose photos (JPEG, PNG, or WebP)"}
        </label>
        <label className="grid gap-1">
          <span className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">
            Destination tag
          </span>
          <select
            value={destinationOverride}
            onChange={(event) => setDestinationOverride(event.target.value)}
            disabled={uploading}
            className="rounded-xl border border-[#e0e8dc] bg-white px-3 py-2.5 text-sm font-bold text-ink"
          >
            <option value="">Auto-detect from filename</option>
            {DESTINATION_OPTIONS.map((destination) => (
              <option key={destination} value={destination}>
                {destination}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={upload}
          disabled={!files.length || uploading}
          className="rounded-xl bg-ink px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-40"
        >
          {uploading ? `Uploading ${progress.done}/${progress.total}…` : `Upload ${files.length || ""} photo${files.length === 1 ? "" : "s"}`.trim()}
        </button>
        {uploading ? (
          <div className="h-2 w-48 overflow-hidden rounded-full bg-mist">
            <div
              className="h-full rounded-full bg-ocean transition-all"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
        ) : null}
        {results.length > 0 && !uploading ? (
          <p className="text-sm font-black text-slate-600">
            {succeeded} uploaded{failed ? `, ${failed} failed` : ""}
          </p>
        ) : null}
      </div>

      {failed > 0 ? (
        <ul className="mt-3 grid gap-1 text-xs font-bold text-red-700">
          {results
            .filter((result) => !result.ok)
            .map((result) => (
              <li key={result.file} className="break-words">
                {result.file}: {result.error}
              </li>
            ))}
        </ul>
      ) : null}
    </Card>
  );
}
