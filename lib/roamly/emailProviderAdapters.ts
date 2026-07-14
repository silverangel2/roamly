import { GMAIL_PROVIDER, GMAIL_READONLY_SCOPE, OUTLOOK_PROVIDER, OUTLOOK_READONLY_SCOPES, type EmailProvider } from "@/lib/roamly/emailConnections";

export type EmailProviderAdapter = {
  provider: EmailProvider;
  displayName: string;
  connectPath: string;
  disconnectPath: string;
  syncPath: string;
  webhookPath: string;
  readonlyScopes: readonly string[];
  supportsWatchNotifications: boolean;
  supportsIncrementalSync: boolean;
  requiredEnv: string[];
  unavailableMessage: string;
};

export const EMAIL_PROVIDER_ADAPTERS: Record<EmailProvider, EmailProviderAdapter> = {
  [GMAIL_PROVIDER]: {
    provider: GMAIL_PROVIDER,
    displayName: "Gmail",
    connectPath: "/api/integrations/gmail/connect",
    disconnectPath: "/api/integrations/gmail/disconnect",
    syncPath: "/api/integrations/gmail/sync",
    webhookPath: "/api/webhooks/gmail",
    readonlyScopes: [GMAIL_READONLY_SCOPE],
    supportsWatchNotifications: true,
    supportsIncrementalSync: true,
    requiredEnv: ["ROAMLY_TOKEN_ENCRYPTION_KEY", "GOOGLE_GMAIL_CLIENT_ID", "GOOGLE_GMAIL_CLIENT_SECRET", "ROAMLY_GMAIL_PUBSUB_TOPIC"],
    unavailableMessage: "Gmail import is not configured yet."
  },
  [OUTLOOK_PROVIDER]: {
    provider: OUTLOOK_PROVIDER,
    displayName: "Outlook",
    connectPath: "/api/integrations/outlook/connect",
    disconnectPath: "/api/integrations/outlook/disconnect",
    syncPath: "/api/integrations/outlook/sync",
    webhookPath: "/api/webhooks/outlook",
    readonlyScopes: OUTLOOK_READONLY_SCOPES,
    supportsWatchNotifications: true,
    supportsIncrementalSync: true,
    requiredEnv: ["ROAMLY_TOKEN_ENCRYPTION_KEY", "MICROSOFT_OUTLOOK_CLIENT_ID", "MICROSOFT_OUTLOOK_CLIENT_SECRET", "ROAMLY_OUTLOOK_WEBHOOK_SECRET"],
    unavailableMessage: "Outlook import is not configured yet."
  }
};

export function emailProviderAdapter(provider: EmailProvider) {
  return EMAIL_PROVIDER_ADAPTERS[provider];
}
