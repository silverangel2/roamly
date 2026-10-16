"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { PLAN_COMMENT_BODY_MAX } from "@/lib/roamly/planComments";

type PostedComment = {
  id: string;
  body: string;
};

type ApiPayload = {
  ok: boolean;
  comment?: PostedComment;
  error?: string;
};

function friendlyError(error: string): string {
  if (error === "EMPTY_BODY") return "Write a note first.";
  if (error === "BODY_TOO_LONG") return `Keep it under ${PLAN_COMMENT_BODY_MAX} characters.`;
  if (error === "COMMENTS_UNAVAILABLE") return "Notes are not available yet — try again shortly.";
  return "That note did not save. Try again.";
}

/**
 * Client island inside TripCommentBox: posts a note and shows it immediately.
 * Renders nothing on its own — the server card decides whether to mount it.
 */
export function TripCommentForm({ tripId }: { tripId: string }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<PostedComment[]>([]);

  async function submit() {
    if (sending) return;
    const trimmed = body.trim();
    if (!trimmed) {
      setError(friendlyError("EMPTY_BODY"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed })
      });
      const payload = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !payload.ok || !payload.comment) {
        setError(friendlyError(payload.error || "UNKNOWN_ERROR"));
        return;
      }
      setPosted((previous) => [...previous, { id: payload.comment!.id, body: payload.comment!.body }]);
      setBody("");
    } catch {
      setError(friendlyError("UNKNOWN_ERROR"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {posted.length ? (
        <ul className="grid gap-2">
          {posted.map((comment) => (
            <li key={comment.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              {comment.body}
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={`trip-note-${tripId}`} className="sr-only">
        Add a note for your trip
      </label>
      <textarea
        id={`trip-note-${tripId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={PLAN_COMMENT_BODY_MAX}
        rows={3}
        placeholder="e.g. No early mornings, more seafood, wheelchair access for mom…"
        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-ink placeholder:text-slate-400 focus:border-ocean focus:outline-none"
      />
      {error ? <p className="mt-2 text-sm font-medium text-coral">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={sending}
        className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ocean px-5 text-sm font-bold text-white transition disabled:opacity-50"
      >
        {sending ? "Saving…" : "Save note"}
      </button>
    </div>
  );
}
