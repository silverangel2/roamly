# Roamly Google Workspace Email

Official Roamly support email:

`support@roamlyhq.com`

Roamly domain:

`https://roamlyhq.com`

## Google Workspace Setup

1. Create `support@roamlyhq.com` as a Google Workspace user or mailbox.
2. Verify `roamlyhq.com` in Google Workspace.
3. Add the Gmail MX records for `roamlyhq.com` in DNS.
4. Confirm mail can be received in the `support@roamlyhq.com` Gmail inbox.
5. Use `support@roamlyhq.com` as the public Roamly support address.
6. Optional: configure a Gmail vacation responder or manual mailbox auto-reply.
7. Add SPF, DKIM, and DMARC records later for stronger deliverability.

## Roamly App Email

Google Workspace handles the mailbox for `support@roamlyhq.com`.

The Roamly app handles contact-form auto-replies when an app email provider is configured.

Recommended app envs:

```bash
ROAMLY_SUPPORT_EMAIL=support@roamlyhq.com
ROAMLY_FROM_EMAIL=support@roamlyhq.com
ROAMLY_EMAIL_PROVIDER=resend
RESEND_API_KEY=...
```

If `ROAMLY_EMAIL_PROVIDER=resend` and `RESEND_API_KEY` is present, Roamly sends contact notifications and customer auto-replies through Resend. If the provider is missing, contact messages can still be saved by the app and the user sees that email delivery is not configured yet.
