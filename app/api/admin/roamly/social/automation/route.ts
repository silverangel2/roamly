import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  clearFailedFacebookJobs,
  generateFacebookQueue,
  getFacebookAutomationSummary,
  isAutomationActionRateLimited,
  publishNextFacebookPostNow,
  refillFacebookQueue,
  retryFailedFacebookPosts,
  runFacebookAutomationCycle,
  saveFacebookAutomationSettings,
  skipNextFacebookPost,
  validateFacebookPageConnection,
  type FacebookAutomationSettings
} from "@/lib/roamly/socialAutomation";

function getString(value: unknown, maxLength = 80) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getBoolean(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function getNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function getNumberArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => getNumber(item, Number.NaN, 0, 23))
    .filter((item) => Number.isFinite(item));
  return values.length ? [...new Set(values)] : undefined;
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : undefined;
}

function getSettingsPatch(value: unknown): Partial<FacebookAutomationSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const body = value as Record<string, unknown>;
  const media = body.media && typeof body.media === "object" && !Array.isArray(body.media) ? (body.media as Record<string, unknown>) : {};
  const patch: Partial<FacebookAutomationSettings> = {
    postsPerDay: getNumber(body.postsPerDay, 2, 0, 12),
    reelsPerWeek: getNumber(body.reelsPerWeek, 3, 0, 21),
    preferredPostingHours: getNumberArray(body.preferredPostingHours),
    timeZone: getString(body.timeZone, 80) || undefined,
    minimumQueueSize: getNumber(body.minimumQueueSize, 30, 0, 500),
    maximumQueueSize: getNumber(body.maximumQueueSize, 100, 1, 1000),
    maximumDailyPosts: getNumber(body.maximumDailyPosts, 3, 0, 24),
    contentCategories: getStringArray(body.contentCategories),
    affiliatePostFrequency: getNumber(body.affiliatePostFrequency, 12, 0, 100),
    promotionalPostFrequency: getNumber(body.promotionalPostFrequency, 15, 0, 100),
    websiteLinkFrequency: getNumber(body.websiteLinkFrequency, 80, 0, 100),
    statementPostFrequency: getNumber(body.statementPostFrequency, 20, 0, 100),
    automaticRetryLimit: getNumber(body.automaticRetryLimit, 3, 0, 10),
    media: {
      maximumUsesPerAsset: getNumber(media.maximumUsesPerAsset, 5, 0, 100),
      minimumDaysBeforeReuse: getNumber(media.minimumDaysBeforeReuse, 14, 0, 365),
      preferNewestUploads: media.preferNewestUploads !== false,
      allowGeneratedVisuals: media.allowGeneratedVisuals !== false,
      allowStatementGraphics: media.allowStatementGraphics !== false,
      allowStockFallbackMedia: media.allowStockFallbackMedia === true
    }
  };
  Object.keys(patch).forEach((key) => {
    if (patch[key as keyof FacebookAutomationSettings] === undefined) delete patch[key as keyof FacebookAutomationSettings];
  });
  return patch;
}

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const summary = await getFacebookAutomationSummary(guard.admin);
  return NextResponse.json({ ok: true, summary });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = getString(body.action);
  const confirm = getBoolean(body.confirm);
  const actorEmail = guard.user.email || guard.user.id;

  if (!action) return NextResponse.json({ ok: false, error: "Action is required." }, { status: 400 });

  if (["generate_100", "refill_queue", "run_automation"].includes(action)) {
    const limited = await isAutomationActionRateLimited(guard.admin, actorEmail, action);
    if (limited) return NextResponse.json({ ok: false, error: "Please wait before running this action again." }, { status: 429 });
  }

  if (action === "generate_100") {
    if (!confirm) return NextResponse.json({ ok: false, error: "Please confirm before creating 100 scheduled posts." }, { status: 400 });
    const result = await generateFacebookQueue(guard.admin, { count: 100, actorEmail });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "refill_queue") {
    const result = await refillFacebookQueue(guard.admin, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "run_automation") {
    const result = await runFacebookAutomationCycle(guard.admin, { trigger: "admin" });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "publish_next_now") {
    if (!confirm) return NextResponse.json({ ok: false, error: "Please confirm before publishing immediately." }, { status: 400 });
    const result = await publishNextFacebookPostNow(guard.admin, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "retry_failures") {
    const result = await retryFailedFacebookPosts(guard.admin, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "skip_next") {
    const result = await skipNextFacebookPost(guard.admin, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "clear_failed_jobs") {
    if (!confirm) return NextResponse.json({ ok: false, error: "Please confirm before clearing failed jobs." }, { status: 400 });
    const result = await clearFailedFacebookJobs(guard.admin, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "pause") {
    const result = await saveFacebookAutomationSettings(guard.admin, { paused: true }, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "resume") {
    const result = await saveFacebookAutomationSettings(guard.admin, { paused: false }, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "enable_autopost") {
    if (!confirm) return NextResponse.json({ ok: false, error: "Please confirm before enabling unattended autoposting." }, { status: 400 });
    const validation = await validateFacebookPageConnection();
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, error: validation.blockingIssues[0] || "Facebook Page validation failed.", validation },
        { status: 400 }
      );
    }
    const result = await saveFacebookAutomationSettings(
      guard.admin,
      { automationEnabled: true, paused: false, manualReviewRequired: false },
      actorEmail
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "disable_autopost") {
    const result = await saveFacebookAutomationSettings(guard.admin, { automationEnabled: false, paused: true }, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "save_settings") {
    const settings = getSettingsPatch(body.settings);
    const significantIncrease = typeof settings.maximumDailyPosts === "number" && settings.maximumDailyPosts > 6;
    if (significantIncrease && !confirm) {
      return NextResponse.json({ ok: false, error: "Please confirm before setting more than 6 posts per day." }, { status: 400 });
    }
    const result = await saveFacebookAutomationSettings(guard.admin, settings, actorEmail);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  return NextResponse.json({ ok: false, error: "Unsupported automation action." }, { status: 400 });
}
