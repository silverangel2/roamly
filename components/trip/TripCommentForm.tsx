"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";
import { BuiButton } from "@/components/boardui/Button";
import { PLAN_COMMENT_BODY_MAX } from "@/lib/roamly/planComments";
import { useI18n } from "@/components/i18n/I18nProvider";

type PostedComment = {
  id: string;
  body: string;
};

type ApiPayload = {
  ok: boolean;
  comment?: PostedComment;
  error?: string;
};

function friendlyError(error: string, translateText: (text: string) => string): string {
  if (error === "EMPTY_BODY") return translateText("Write a note first.");
  if (error === "BODY_TOO_LONG") return translateText(`Keep it under ${PLAN_COMMENT_BODY_MAX} characters.`);
  if (error === "COMMENTS_UNAVAILABLE") return translateText("Notes are not available yet — try again shortly.");
  return translateText("That note did not save. Try again.");
}

/**
 * Client island inside TripCommentBox: posts a note and shows it immediately.
 * Renders nothing on its own — the server card decides whether to mount it.
 */
export function TripCommentForm({ tripId }: { tripId: string }) {
  const { translateText } = useI18n();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<PostedComment[]>([]);

  async function submit() {
    if (sending) return;
    const trimmed = body.trim();
    if (!trimmed) {
      setError(friendlyError("EMPTY_BODY", translateText));
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
        setError(friendlyError(payload.error || "UNKNOWN_ERROR", translateText));
        return;
      }
      setPosted((previous) => [...previous, { id: payload.comment!.id, body: payload.comment!.body }]);
      setBody("");
    } catch {
      setError(friendlyError("UNKNOWN_ERROR", translateText));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {posted.length ? (
        <ul className="grid gap-2">
          {posted.map((comment) => (
            <li key={comment.id} className="rounded-2xl bg-csoft px-4 py-3 text-sm leading-6 text-ink">
              {comment.body}
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={`trip-note-${tripId}`} className="mt-3 block text-sm font-black text-chead">
        {translateText("Add a note for your trip")}
      </label>
      <textarea
        id={`trip-note-${tripId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={PLAN_COMMENT_BODY_MAX}
        rows={3}
        placeholder={translateText("e.g. No early mornings, more seafood, wheelchair access for mom…")}
        className="bui-input mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold leading-6 text-ink outline-none placeholder:text-cgray2 focus:border-cblue focus:ring-4 focus:ring-cblue/10"
      />
      {error ? <p role="alert" className="mt-2 text-sm font-medium text-coral">{error}</p> : null}
      <BuiButton onClick={submit} busy={sending} className="mt-3">
        {sending ? translateText("Saving…") : translateText("Save note")}
      </BuiButton>
    </div>
  );
}
