import { GMAIL_PROVIDER, GMAIL_READONLY_SCOPE, type EmailProvider } from "@/lib/roamly/emailConnections";

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

export const EMAIL_PROVIDER_ADAPTERS = {
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
  }
} satisfies Partial<Record<EmailProvider, EmailProviderAdapter>>;

export function emailProviderAdapter(provider: EmailProvider) {
  return EMAIL_PROVIDER_ADAPTERS[provider as keyof typeof EMAIL_PROVIDER_ADAPTERS];
}
