export const ROAMLY_PUBLIC_DOMAIN = "https://roamlyhq.com";

export const ROAMLY_EMAIL_FOOTER_COPY =
  "Roamly helps travelers plan smarter trips with AI-powered itineraries, budget checks, booking organization, and Live Trip Companion.";

export const ROAMLY_AFFILIATE_DISCLOSURE =
  "Roamly may earn a commission when you book or shop through partner links. This does not change your price.";

export type RoamlyEmailShellInput = {
  subject: string;
  preheader?: string;
  eyebrow?: string;
  title?: string;
  intro?: string;
  bodyHtml?: string;
  bodyText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  supportEmail: string;
  footerUrl?: string;
  includeAffiliateDisclosure?: boolean;
};

export type RoamlyRenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export function escapeEmailHtml(value?: string | null) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absoluteUrl(url?: string | null, footerUrl = ROAMLY_PUBLIC_DOMAIN) {
  const value = (url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${footerUrl.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(
      (part) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#42526a;">${escapeEmailHtml(part).replace(/\n/g, "<br />")}</p>`
    )
    .join("");
}

export function renderRoamlyEmailShell(input: RoamlyEmailShellInput): RoamlyRenderedEmail {
  const footerUrl = input.footerUrl || ROAMLY_PUBLIC_DOMAIN;
  const preheader = input.preheader || input.intro || ROAMLY_EMAIL_FOOTER_COPY;
  const title = input.title || input.subject;
  const ctaUrl = absoluteUrl(input.ctaUrl, footerUrl);
  const bodyHtml = input.bodyHtml || (input.intro ? paragraphs(input.intro) : "");
  const bodyText = input.bodyText || input.intro || "";
  const disclosure = input.includeAffiliateDisclosure ? ROAMLY_AFFILIATE_DISCLOSURE : "";
  const supportLine = `Need help? Reply to this email or contact ${input.supportEmail}.`;
  const footerText = `${ROAMLY_EMAIL_FOOTER_COPY}\n${supportLine}\n${footerUrl}`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f7fbf8;font-family:Arial,sans-serif;color:#102033;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeEmailHtml(preheader)}</div>
    <main style="max-width:680px;margin:0 auto;padding:28px 18px;">
      <header style="padding:8px 8px 18px;">
        <a href="${escapeEmailHtml(footerUrl)}" style="display:inline-flex;align-items:center;gap:10px;color:#102033;text-decoration:none;">
          <span style="display:inline-grid;width:40px;height:40px;place-items:center;border-radius:14px;background:#54d6c6;color:#102033;font-size:21px;font-weight:900;">R</span>
          <span style="font-size:24px;font-weight:900;letter-spacing:0;color:#102033;">Roamly</span>
        </a>
      </header>
      <section style="background:#ffffff;border:1px solid #dce8f2;border-radius:24px;padding:28px;box-shadow:0 18px 45px rgba(16,32,51,0.10);">
        ${input.eyebrow ? `<p style="margin:0 0 14px;font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#1b9aaa;">${escapeEmailHtml(input.eyebrow)}</p>` : ""}
        <h1 style="margin:0;font-size:30px;line-height:1.08;color:#102033;">${escapeEmailHtml(title)}</h1>
        ${input.intro ? `<p style="margin:16px 0 0;font-size:16px;line-height:1.65;color:#42526a;">${escapeEmailHtml(input.intro)}</p>` : ""}
        <div style="margin-top:20px;">${bodyHtml}</div>
        ${
          ctaUrl
            ? `<a href="${escapeEmailHtml(ctaUrl)}" style="display:inline-block;margin-top:10px;background:#1b9aaa;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 19px;font-weight:900;">${escapeEmailHtml(input.ctaLabel || "Open Roamly")}</a>`
            : ""
        }
        ${
          disclosure
            ? `<p style="margin:22px 0 0;border-top:1px solid #e5edf3;padding-top:14px;font-size:12px;line-height:1.6;color:#6d7a8c;">${escapeEmailHtml(disclosure)}</p>`
            : ""
        }
      </section>
      <footer style="padding:18px 8px 0;">
        <p style="margin:0;font-size:12px;line-height:1.65;color:#6d7a8c;">${escapeEmailHtml(ROAMLY_EMAIL_FOOTER_COPY)}</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.65;color:#6d7a8c;">Need help? Reply to this email or contact <a href="mailto:${escapeEmailHtml(input.supportEmail)}" style="color:#1b9aaa;font-weight:900;text-decoration:none;">${escapeEmailHtml(input.supportEmail)}</a>.</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.65;color:#6d7a8c;"><a href="${escapeEmailHtml(footerUrl)}" style="color:#1b9aaa;font-weight:900;text-decoration:none;">roamlyhq.com</a></p>
      </footer>
    </main>
  </body>
</html>`;

  const text = [
    title,
    bodyText,
    ctaUrl ? `${input.ctaLabel || "Open Roamly"}: ${ctaUrl}` : "",
    disclosure,
    footerText
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject: input.subject, preheader, html, text };
}

export function renderSupportAutoReplyTemplate({
  name,
  supportEmail
}: {
  name: string;
  supportEmail: string;
}) {
  const safeName = name.trim() || "there";
  const bodyText = `Hi ${safeName},

Thanks for contacting Roamly. We received your message and will review it as soon as possible.

If your question is about a trip, itinerary, booking, payment, or Live Companion, please reply with any extra details or screenshots.

Roamly Support
${supportEmail}
${ROAMLY_PUBLIC_DOMAIN}`;

  return renderRoamlyEmailShell({
    subject: "We received your Roamly message",
    preheader: "Thanks for contacting Roamly. We received your message.",
    eyebrow: "Support",
    title: "We received your Roamly message",
    bodyHtml: paragraphs(bodyText),
    bodyText,
    ctaLabel: "Open Roamly",
    ctaUrl: ROAMLY_PUBLIC_DOMAIN,
    supportEmail
  });
}

export function renderGenericSupportResponseTemplate({
  subject,
  message,
  supportEmail
}: {
  subject: string;
  message: string;
  supportEmail: string;
}) {
  return renderRoamlyEmailShell({
    subject,
    preheader: message.slice(0, 140),
    eyebrow: "Roamly Support",
    title: subject,
    bodyHtml: paragraphs(message),
    bodyText: message,
    ctaLabel: "Open Roamly",
    ctaUrl: ROAMLY_PUBLIC_DOMAIN,
    supportEmail
  });
}

export function renderLaunchContactConfirmationTemplate({
  name,
  supportEmail
}: {
  name: string;
  supportEmail: string;
}) {
  return renderRoamlyEmailShell({
    subject: "Thanks for contacting Roamly",
    preheader: "Roamly received your launch message.",
    eyebrow: "Contact",
    title: "Thanks for reaching out.",
    bodyHtml: paragraphs(`Hi ${name || "there"},\n\nThanks for contacting Roamly. We received your note and will review it as soon as possible.`),
    bodyText: `Hi ${name || "there"},\n\nThanks for contacting Roamly. We received your note and will review it as soon as possible.`,
    supportEmail
  });
}

export function renderBookingShareEmailTemplate({
  title,
  message,
  ctaUrl,
  supportEmail,
  includeAffiliateDisclosure
}: {
  title: string;
  message: string;
  ctaUrl?: string;
  supportEmail: string;
  includeAffiliateDisclosure?: boolean;
}) {
  return renderRoamlyEmailShell({
    subject: title,
    preheader: "A Roamly booking or trip share is ready.",
    eyebrow: "Booking organization",
    title,
    bodyHtml: paragraphs(message),
    bodyText: message,
    ctaLabel: "Open trip",
    ctaUrl,
    supportEmail,
    includeAffiliateDisclosure
  });
}

export function renderItineraryEmailTemplate({
  title,
  message,
  ctaUrl,
  supportEmail,
  includeAffiliateDisclosure
}: {
  title: string;
  message: string;
  ctaUrl?: string;
  supportEmail: string;
  includeAffiliateDisclosure?: boolean;
}) {
  return renderRoamlyEmailShell({
    subject: title,
    preheader: "Your Roamly itinerary is ready to review.",
    eyebrow: "Roamly itinerary",
    title,
    bodyHtml: paragraphs(message),
    bodyText: message,
    ctaLabel: "Open trip in Roamly",
    ctaUrl,
    supportEmail,
    includeAffiliateDisclosure
  });
}
