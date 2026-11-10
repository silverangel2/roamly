export const ROAMLY_PUBLIC_DOMAIN = "https://roamlyhq.com";
export const ROAMLY_LOGO_URL = `${ROAMLY_PUBLIC_DOMAIN}/roamly-wordmark@2x.png`;

export const ROAMLY_EMAIL_FOOTER_COPY =
  "Roamly helps travelers plan smarter trips with AI-powered itineraries, budget checks, booking organization, and Live Trip Companion.";

export const ROAMLY_AFFILIATE_DISCLOSURE =
  "Roamly may earn a commission from some booking links. Recommendations are ranked according to your trip needs, not commission.";

export type RoamlyEmailSummaryItem = {
  label: string;
  value: string | number | null | undefined;
};

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
  summaryItems?: RoamlyEmailSummaryItem[];
  supportEmail: string;
  footerUrl?: string;
  managePreferencesUrl?: string;
  managePreferencesLabel?: string;
  includeAffiliateDisclosure?: boolean;
};

export type RoamlyRenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

export function escapeEmailHtml(value?: string | number | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toRoamlyAbsoluteUrl(url?: string | null, baseUrl = ROAMLY_PUBLIC_DOMAIN) {
  const value = (url || "").trim();
  if (!value) return "";

  const safeBase = baseUrl.startsWith("https://") && !/localhost|127\.0\.0\.1|\[::1\]|vercel\.app/i.test(baseUrl)
    ? baseUrl.replace(/\/$/, "")
    : ROAMLY_PUBLIC_DOMAIN;

  try {
    const parsed = /^https?:\/\//i.test(value) ? new URL(value) : new URL(value.startsWith("/") ? value : `/${value}`, safeBase);
    const unsafeHost = /localhost|127\.0\.0\.1|\[::1\]|vercel\.app/i.test(parsed.host);
    const unsafeProtocol = parsed.protocol !== "https:";
    if (unsafeHost || unsafeProtocol) {
      return `${ROAMLY_PUBLIC_DOMAIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return safeBase;
  }
}

export function renderEmailBodyCopy(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(
      (part) =>
        `<p style="Margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:#223354;">${escapeEmailHtml(part).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export function renderEmailHeading(title: string) {
  return `<h1 style="Margin:0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:700;color:#223354;">${escapeEmailHtml(title)}</h1>`;
}

export function renderEmailCta(label?: string, url?: string) {
  const ctaUrl = toRoamlyAbsoluteUrl(url);
  if (!label || !ctaUrl) return "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="Margin:22px 0 0 0;border-collapse:separate;">
      <tr>
        <td bgcolor="#087BFF" style="border-radius:8px;text-align:center;">
          <a href="${escapeEmailHtml(ctaUrl)}" style="display:inline-block;padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeEmailHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

export function renderEmailSummary(items?: RoamlyEmailSummaryItem[]) {
  const rows = (items || [])
    .map((item) => ({ label: item.label, value: item.value == null ? "" : String(item.value).trim() }))
    .filter((item) => item.label && item.value)
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #DCE5F0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:700;color:#223354;width:38%;">${escapeEmailHtml(item.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #DCE5F0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#657795;">${escapeEmailHtml(item.value)}</td>
        </tr>`
    )
    .join("");

  if (!rows) return "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="Margin:18px 0;border-collapse:collapse;border:1px solid #DCE5F0;border-radius:8px;background:#F2F6FC;">
      ${rows}
    </table>`;
}

export function renderRoamlyEmailHeader(footerUrl = ROAMLY_PUBLIC_DOMAIN) {
  /* Batch 10 design layer (2026-11-10): the header is the brand
   * navy band (#071E55, the cnavy token). The wordmark renders as
   * white text, not the logo PNG: the PNG wordmark is primary-blue
   * on transparent, which cannot sit legibly on navy, and a text
   * wordmark is the email-safe form (no image blocking, no
   * dark-mode inversion). The band links to the same footerUrl
   * the image linked to — link and name unchanged. */
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="Margin:0 0 20px 0;border-collapse:separate;">
      <tr>
        <td bgcolor="#071E55" align="center" style="padding:20px 16px;border-radius:10px;background:#071E55;text-align:center;">
          <a href="${escapeEmailHtml(footerUrl)}" style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:26px;font-weight:900;letter-spacing:0.4px;color:#ffffff;text-decoration:none;">Roamly</a>
        </td>
      </tr>
    </table>`;
}

export function renderRoamlyEmailFooter({
  supportEmail,
  footerUrl = ROAMLY_PUBLIC_DOMAIN,
  managePreferencesUrl,
  managePreferencesLabel
}: {
  supportEmail: string;
  footerUrl?: string;
  managePreferencesUrl?: string;
  managePreferencesLabel?: string;
}) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td align="left" style="padding:20px 0 0 0;">
          <p style="Margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#657795;">${escapeEmailHtml(ROAMLY_EMAIL_FOOTER_COPY)}</p>
          ${managePreferencesUrl && managePreferencesLabel ? `<p style="Margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;"><a href="${escapeEmailHtml(managePreferencesUrl)}" style="color:#087BFF;font-weight:700;text-decoration:none;">${escapeEmailHtml(managePreferencesLabel)}</a></p>` : ""}
          <p style="Margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#657795;">Need help? Reply to this email or contact <a href="mailto:${escapeEmailHtml(supportEmail)}" style="color:#087BFF;font-weight:700;text-decoration:none;">${escapeEmailHtml(supportEmail)}</a>.</p>
          <p style="Margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#657795;">Roamly · <a href="${escapeEmailHtml(footerUrl)}" style="color:#087BFF;font-weight:700;text-decoration:none;">roamlyhq.com</a></p>
        </td>
      </tr>
    </table>`;
}

function renderPlainText(input: RoamlyEmailShellInput, ctaUrl: string, title: string, bodyText: string) {
  const summary = (input.summaryItems || [])
    .map((item) => ({ label: item.label, value: item.value == null ? "" : String(item.value).trim() }))
    .filter((item) => item.label && item.value)
    .map((item) => `${item.label}: ${item.value}`)
    .join("\n");
  const disclosure = input.includeAffiliateDisclosure ? ROAMLY_AFFILIATE_DISCLOSURE : "";
  const supportLine = `Need help? Reply to this email or contact ${input.supportEmail}.`;

  return [
    title,
    input.intro,
    bodyText,
    summary,
    ctaUrl ? `${input.ctaLabel || "Open Roamly"}: ${ctaUrl}` : "",
    disclosure,
    ROAMLY_EMAIL_FOOTER_COPY,
    input.managePreferencesUrl && input.managePreferencesLabel ? `${input.managePreferencesLabel}: ${toRoamlyAbsoluteUrl(input.managePreferencesUrl)}` : "",
    supportLine,
    input.footerUrl || ROAMLY_PUBLIC_DOMAIN
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderRoamlyEmailShell(input: RoamlyEmailShellInput): RoamlyRenderedEmail {
  const footerUrl = toRoamlyAbsoluteUrl(input.footerUrl || ROAMLY_PUBLIC_DOMAIN);
  const preheader = input.preheader || input.intro || ROAMLY_EMAIL_FOOTER_COPY;
  const title = input.title || input.subject;
  const ctaUrl = input.ctaUrl ? toRoamlyAbsoluteUrl(input.ctaUrl, footerUrl) : "";
  const bodyHtml = input.bodyHtml || (input.intro ? renderEmailBodyCopy(input.intro) : "");
  const bodyText = input.bodyText || input.intro || "";
  const disclosure = input.includeAffiliateDisclosure ? ROAMLY_AFFILIATE_DISCLOSURE : "";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeEmailHtml(input.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .roamly-email-container { width: 100% !important; }
        .roamly-email-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .roamly-email-card { padding: 24px 20px !important; }
      }
    </style>
  </head>
  <body style="Margin:0;padding:0;background:#F2F6FC;color:#223354;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeEmailHtml(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#F2F6FC" style="border-collapse:collapse;background:#F2F6FC;">
      <tr>
        <td align="center" class="roamly-email-pad" style="padding:28px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="roamly-email-container" style="width:600px;max-width:600px;border-collapse:collapse;">
            <tr>
              <td>${renderRoamlyEmailHeader(footerUrl)}</td>
            </tr>
            <tr>
              <td bgcolor="#ffffff" class="roamly-email-card" style="padding:32px;border:1px solid #DCE5F0;border-radius:10px;background:#ffffff;">
                ${
                  input.eyebrow
                    ? `<p style="Margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#087BFF;">${escapeEmailHtml(input.eyebrow)}</p>`
                    : ""
                }
                ${renderEmailHeading(title)}
                ${input.intro ? `<div style="Margin:16px 0 0 0;">${renderEmailBodyCopy(input.intro)}</div>` : ""}
                ${bodyHtml ? `<div style="Margin:18px 0 0 0;">${bodyHtml}</div>` : ""}
                ${renderEmailSummary(input.summaryItems)}
                ${renderEmailCta(input.ctaLabel, ctaUrl)}
                ${
                  disclosure
                    ? `<p style="Margin:22px 0 0 0;padding-top:14px;border-top:1px solid #DCE5F0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#657795;">${escapeEmailHtml(disclosure)}</p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td>${renderRoamlyEmailFooter({ supportEmail: input.supportEmail, footerUrl, managePreferencesUrl: input.managePreferencesUrl ? toRoamlyAbsoluteUrl(input.managePreferencesUrl, footerUrl) : undefined, managePreferencesLabel: input.managePreferencesLabel })}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: input.subject,
    preheader,
    html,
    text: renderPlainText(input, ctaUrl, title, bodyText)
  };
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

If your question is about a trip, itinerary, booking, payment, or Live Companion, please reply with any extra details or screenshots.`;

  return renderRoamlyEmailShell({
    subject: "We received your Roamly message",
    preheader: "Thanks for contacting Roamly. We received your message.",
    eyebrow: "Support",
    title: "We received your Roamly message",
    bodyHtml: renderEmailBodyCopy(bodyText),
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
    bodyHtml: renderEmailBodyCopy(message),
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
  const bodyText = `Hi ${name || "there"},

Thanks for contacting Roamly. We received your note and will review it as soon as possible.`;

  return renderRoamlyEmailShell({
    subject: "Thanks for contacting Roamly",
    preheader: "Roamly received your launch message.",
    eyebrow: "Contact",
    title: "Thanks for reaching out.",
    bodyHtml: renderEmailBodyCopy(bodyText),
    bodyText,
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
    bodyHtml: renderEmailBodyCopy(message),
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
    bodyHtml: renderEmailBodyCopy(message),
    bodyText: message,
    ctaLabel: "View your itinerary",
    ctaUrl,
    supportEmail,
    includeAffiliateDisclosure
  });
}
