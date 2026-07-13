import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { getRoamlyReplyToEmail, renderEmailTemplate, sendRoamlyEmail } from "@/lib/roamly/email";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const to = getString(body.to);
  const subject = getString(body.subject);
  const message = getString(body.message || body.text);
  const html = getString(body.html);
  const templateType = getString(body.template) || "general_admin_message";

  if (!to || !subject || (!message && !html)) {
    return NextResponse.json({ ok: false, error: "Recipient, subject, and message are required." }, { status: 400 });
  }

  const template = html
    ? { subject, html, text: message }
    : renderEmailTemplate(templateType as Parameters<typeof renderEmailTemplate>[0], {
        subject,
        message,
        actionUrl: "/notifications"
      });

  const result = await sendRoamlyEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    replyTo: getRoamlyReplyToEmail() || guard.user.email || null,
    metadata: { sentBy: guard.user.email, template: templateType, source: "admin_composer" }
  });

  return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : result.status === "skipped" ? 202 : 400 });
}
