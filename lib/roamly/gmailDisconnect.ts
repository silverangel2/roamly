const GMAIL_STOP_URL = "https://gmail.googleapis.com/gmail/v1/users/me/stop";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROVIDER_TIMEOUT_MS = 5_000;

type FetchLike = typeof fetch;

export async function stopGmailPushDelivery(accessToken: string, fetchImpl: FetchLike = fetch) {
  if (!accessToken) return false;
  try {
    const response = await fetchImpl(GMAIL_STOP_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function revokeGoogleOAuthToken(token: string, fetchImpl: FetchLike = fetch) {
  if (!token) return false;
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    if (response.ok) return true;
    if (response.status === 400) {
      const errorBody = await response.json().catch(() => null) as { error?: unknown } | null;
      return errorBody?.error === "invalid_token";
    }
    return false;
  } catch {
    return false;
  }
}
