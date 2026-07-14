import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { type EmailTemplateType, renderEmailTemplate } from "@/lib/roamly/email";
import { renderSampleItineraryGenerationEmail } from "@/lib/roamly/itineraryGenerationEmail";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sampleForTemplate(template: string) {
  if (template === "itinerary_ready") return renderSampleItineraryGenerationEmail("completion");
  if (template === "itinerary_generation_failure") return renderSampleItineraryGenerationEmail("failure");

  const samples: Record<string, { subject: string; preheader: string; message: string; actionUrl: string; destination?: string }> = {
    welcome: {
      subject: "Welcome to Roamly",
      preheader: "Your Roamly account is ready.",
      message: "Roamly is ready to help you plan, budget, and organize your next trip.",
      actionUrl: "/plan",
      destination: "your next trip"
    },
    contact_confirmation: {
      subject: "Thanks for contacting Roamly",
      preheader: "We received your message.",
      message: "Thanks for reaching out. Roamly Support will review your note and reply as soon as possible.",
      actionUrl: "/contact",
      destination: "Support"
    },
    support_notification: {
      subject: "New Roamly support request",
      preheader: "A support request needs review.",
      message: "A traveler sent a support request from the Roamly contact form.",
      actionUrl: "/admin/email",
      destination: "Support queue"
    },
    login_help: {
      subject: "Help signing in to Roamly",
      preheader: "Use this secure Roamly link to continue.",
      message: "Use the secure Roamly sign-in page and choose the same account you used to create your trip.",
      actionUrl: "/login",
      destination: "Roamly account"
    },
    trip_reminder: {
      subject: "Roamly trip reminder",
      preheader: "Your trip timeline has an upcoming item.",
      message: "Open Roamly to review your next saved activity, booking, or travel reminder.",
      actionUrl: "/notifications",
      destination: "New York"
    },
    facebook_autopost_failure: {
      subject: "Roamly Facebook autopost needs attention",
      preheader: "A scheduled Facebook post could not be published.",
      message: "Roamly could not publish a scheduled Facebook post. Review the automation queue before the next run.",
      actionUrl: "/admin/social/automation",
      destination: "Social automation"
    },
    weekly_automation_report: {
      subject: "Roamly weekly automation report",
      preheader: "Your weekly Roamly automation summary is ready.",
      message: "Review generated social posts, publishing results, failed jobs, and the retry queue.",
      actionUrl: "/admin/social/history",
      destination: "Automation"
    },
    billing_notification: {
      subject: "Roamly billing update",
      preheader: "A Roamly billing event needs review.",
      message: "A Roamly billing event was recorded. Open the billing tools to review the account status.",
      actionUrl: "/account",
      destination: "Billing"
    },
    feature_announcement: {
      subject: "New Roamly feature update",
      preheader: "A Roamly feature is ready to try.",
      message: "A new Roamly travel planning feature is available in your account.",
      actionUrl: "/dashboard",
      destination: "Roamly"
    },
    admin_test_email: {
      subject: "Roamly test email",
      preheader: "Your Roamly Google Workspace SMTP provider is ready.",
      message: "This is a controlled test email from the Roamly admin Email Center.",
      actionUrl: "/admin/email",
      destination: "Admin Email Center"
    }
  };

  return renderEmailTemplate((template as EmailTemplateType) || "admin_test_email", samples[template] || samples.admin_test_email);
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const template = getString(body.template) || "itinerary_ready";
  const rendered = sampleForTemplate(template);

  return NextResponse.json({
    ok: true,
    template,
    preview: {
      subject: rendered.subject,
      preheader: rendered.preheader,
      html: rendered.html,
      text: rendered.text
    }
  });
}
