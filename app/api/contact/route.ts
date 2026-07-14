import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getRoamlySupportEmail,
  isEmailConfigured,
  sendRoamlyEmail
} from "@/lib/roamly/email";
import {
  escapeEmailHtml,
  renderRoamlyEmailShell,
  renderSupportAutoReplyTemplate
} from "@/lib/roamly/emailTemplates";

const allowedCategories = new Set(["support", "billing", "itinerary", "partner", "bug", "other"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getString(value: unknown, maxLength = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function requestOrigin(request: NextRequest) {
  return request.headers.get("origin") || request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = getString(body.name, 160);
  const email = getString(body.email, 320).toLowerCase();
  const subject = getString(body.subject, 180);
  const message = getString(body.message, 8000);
  const categoryInput = getString(body.category, 40).toLowerCase();
  const category = allowedCategories.has(categoryInput) ? categoryInput : "support";
  const tripIdInput = getString(body.trip_id || body.tripId, 80);
  const tripId = uuidPattern.test(tripIdInput) ? tripIdInput : null;
  const supportEmail = getRoamlySupportEmail();

  if (!name || !email || !subject || !message) {
    return NextResponse.json({ ok: false, error: "Name, email, subject, and message are required." }, { status: 400 });
  }

  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const metadata = {
    source: "contact_page",
    user_agent: request.headers.get("user-agent") || "",
    origin: requestOrigin(request)
  };

  let saved = false;
  let supportMessageId: string | null = null;
  const admin = createSupabaseAdminClient();

  if (admin) {
    const { data, error } = await admin
      .from("roamly_support_messages")
      .insert({
        name,
        email,
        subject,
        message,
        category,
        trip_id: tripId,
        metadata
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (!error.message.includes("schema cache") && !error.message.includes("does not exist")) {
        console.error("[Roamly contact] support message save failed", error.message);
      }
    } else {
      saved = true;
      supportMessageId = data?.id || null;
    }
  }

  const emailStatus = isEmailConfigured();
  const delivery = {
    supportNotification: "skipped" as "sent" | "failed" | "skipped",
    autoReply: "skipped" as "sent" | "failed" | "skipped"
  };

  if (emailStatus.configured) {
    const supportTemplate = renderRoamlyEmailShell({
      subject: `Roamly contact: ${subject}`,
      preheader: `${category} message from ${name}`,
      eyebrow: "Support request",
      title: subject,
      bodyHtml: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#42526a;"><strong>Name:</strong> ${escapeEmailHtml(name)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#42526a;"><strong>Email:</strong> ${escapeEmailHtml(email)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#42526a;"><strong>Category:</strong> ${escapeEmailHtml(category)}</p>
        ${tripId ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;color:#42526a;"><strong>Trip ID:</strong> ${escapeEmailHtml(tripId)}</p>` : ""}
        <p style="margin:18px 0 0;white-space:pre-wrap;font-size:15px;line-height:1.65;color:#42526a;">${escapeEmailHtml(message)}</p>
      `,
      bodyText: `Name: ${name}\nEmail: ${email}\nCategory: ${category}${tripId ? `\nTrip ID: ${tripId}` : ""}\n\n${message}`,
      supportEmail
    });

    const supportResult = await sendRoamlyEmail({
      to: supportEmail,
      subject: supportTemplate.subject,
      html: supportTemplate.html,
      text: supportTemplate.text,
      replyTo: email,
      metadata: { type: "support_notification", template: "support_notification", supportMessageId, category, saved }
    });
    delivery.supportNotification = supportResult.ok ? "sent" : supportResult.status === "skipped" ? "skipped" : "failed";

    const autoReply = renderSupportAutoReplyTemplate({ name, supportEmail });
    const autoReplyResult = await sendRoamlyEmail({
      to: email,
      subject: autoReply.subject,
      html: autoReply.html,
      text: autoReply.text,
      replyTo: supportEmail,
      metadata: { type: "contact_confirmation", template: "contact_confirmation", supportMessageId, category, saved }
    });
    delivery.autoReply = autoReplyResult.ok ? "sent" : autoReplyResult.status === "skipped" ? "skipped" : "failed";
  }

  const responseMessage = emailStatus.configured
    ? "Thanks - your message was received."
    : "Thanks — your message was received. Email delivery is not configured yet.";

  return NextResponse.json({
    ok: true,
    saved,
    id: supportMessageId,
    emailConfigured: emailStatus.configured,
    delivery,
    message: responseMessage
  });
}
