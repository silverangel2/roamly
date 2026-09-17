export type FacebookPublicationTruth =
  | "processing"
  | "published_unverified"
  | "published_verified"
  | "failed";

export type FacebookProcessingClassification = {
  state: "terminal_success" | "terminal_failure" | "processing" | "unknown";
  status: string;
};

export type FacebookPublicVisibilityResult = {
  verified: boolean;
  reason: string;
  status?: number;
  finalUrl?: string;
};

export function classifyFacebookProcessing(value: unknown): FacebookProcessingClassification {
  const status =
    value && typeof value === "object"
      ? String(
          (value as Record<string, unknown>).status ||
            (value as Record<string, unknown>).video_status ||
            (value as Record<string, unknown>).processing_phase ||
            ""
        ).toLowerCase()
      : "";

  if (!status) return { state: "unknown", status };
  if (/error|failed|rejected|invalid|blocked/.test(status)) {
    return { state: "terminal_failure", status };
  }
  if (/ready|complete|finished|success|published/.test(status)) {
    return { state: "terminal_success", status };
  }
  if (/processing|upload|pending|queued|in_progress/.test(status)) {
    return { state: "processing", status };
  }
  return { state: "unknown", status };
}

export function classifyFacebookPublication(input: {
  finish: Record<string, unknown>;
  confirmation: Record<string, unknown>;
  confirmationError?: string | null;
  visibility: FacebookPublicVisibilityResult;
}) {
  const finishAccepted = input.finish.success === true;
  const finalObjectId = String(input.confirmation.id || "").trim();
  const permalink = String(input.confirmation.permalink_url || "").trim();
  const classifiedAsReel =
    input.confirmation.is_reel === true ||
    String(input.confirmation.media_type || "").toLowerCase() === "reel" ||
    /\/reel\//i.test(permalink);

  if (!finishAccepted) {
    return {
      truth: "failed" as const,
      reason: "Meta did not explicitly confirm the Reel finish request.",
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  if (input.confirmationError) {
    return {
      truth: "published_unverified" as const,
      reason: "Meta final object confirmation failed.",
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  const finalStatus = input.confirmation.status || input.confirmation.video_status || input.confirmation.processing_phase;
  if (finalStatus) {
    const finalProcessing = classifyFacebookProcessing(input.confirmation);
    if (finalProcessing.state === "terminal_failure") {
      return {
        truth: "failed" as const,
        reason: `Meta final object reported terminal failure: ${finalProcessing.status}.`,
        finishAccepted,
        finalObjectId,
        permalink,
        classifiedAsReel
      };
    }
    if (finalProcessing.state !== "terminal_success") {
      return {
        truth: "published_unverified" as const,
        reason: `Meta final object is not in a terminal publish state: ${String(finalStatus)}.`,
        finishAccepted,
        finalObjectId,
        permalink,
        classifiedAsReel
      };
    }
  }

  if (!finalObjectId) {
    return {
      truth: "published_unverified" as const,
      reason: "Meta final object ID was not returned.",
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  if (!classifiedAsReel) {
    return {
      truth: "published_unverified" as const,
      reason: "Meta did not confirm that the final object is a Reel.",
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  if (!permalink) {
    return {
      truth: "published_unverified" as const,
      reason: "Meta did not return a public permalink.",
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  if (!input.visibility.verified) {
    return {
      truth: "published_unverified" as const,
      reason: input.visibility.reason,
      finishAccepted,
      finalObjectId,
      permalink,
      classifiedAsReel
    };
  }

  return {
    truth: "published_verified" as const,
    reason: "Meta Reel identity and anonymous permalink visibility were verified.",
    finishAccepted,
    finalObjectId,
    permalink,
    classifiedAsReel
  };
}
