import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlySupportEmail } from "@/lib/roamly/email";

function cleanToken(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 64) : "";
}

function confirmationPage(message: string) {
  const support = getRoamlySupportEmail();
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roamly email preferences</title></head>` +
      `<body style="margin:0;background:#f6f8fa;font-family:Arial,sans-serif;color:#17212b">` +
      `<div style="max-width:560px;margin:48px auto;padding:24px"><div style="background:#fff;border:1px solid #e5e9ed;border-radius:20px;padding:32px">` +
      `<p style="margin:0 0 8px;color:#0f6f8f;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Roamly</p>` +
      `<h1 style="margin:0;font-size:22px">Email preferences</h1>` +
      `<p style="margin:16px 0 0;font-size:15px;line-height:1.6">${message}</p>` +
      `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#7a8791">Need help? Contact <a href="mailto:${support}" style="color:#0f6f8f">${support}</a>.</p>` +
      `</div></div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

/**
 * One-click unsubscribe for FYI/marketing email.
 * The token is a random UUID stored in roamly_email_preferences — no login needed.
 */
export async function GET(request: NextRequest) {
  const token = cleanToken(request.nextUrl.searchParams.get("token"));
  if (!token) return confirmationPage("This unsubscribe link is missing its token. Please use the link from your Roamly email.");

  const admin = createSupabaseAdminClient();
  if (!admin) return confirmationPage("Email preferences are temporarily unavailable. Please try again later.");

  const lookup = await admin
    .from("roamly_email_preferences")
    .select("user_id,unsubscribed_all")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (lookup.error || !lookup.data) {
    return confirmationPage("This unsubscribe link is invalid or has expired. Please use the link from your most recent Roamly email.");
  }
  if ((lookup.data as { unsubscribed_all?: boolean }).unsubscribed_all === true) {
    return confirmationPage("You're already unsubscribed from Roamly emails. You won't receive any more FYI or marketing emails.");
  }

  const update = await admin
    .from("roamly_email_preferences")
    .update({ unsubscribed_all: true, marketing_enabled: false, updated_at: new Date().toISOString() })
    .eq("unsubscribe_token", token);
  if (update.error) return confirmationPage("Something went wrong saving your preference. Please try again later.");

  return confirmationPage(
    "Done — you're unsubscribed from Roamly emails. You won't receive FYI digests or marketing emails anymore. " +
      "Your trips, bookings, and Live Companion still work exactly as before; only the emails stop."
  );
}
