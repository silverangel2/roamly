import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "crypto";

/*
 * Claim-code protocol for the automation-owned daily-test account.
 *
 * The provisioning route never returns the account password. Instead it
 * returns a one-time claim code (>=128-bit random, 15-minute life). The
 * password is stored in the test user's Supabase user_metadata encrypted
 * under a key derived from the claim code itself, so the metadata alone
 * reveals nothing:
 *
 *   key       = SHA-256(claimCode)
 *   cipher    = AES-256-GCM(password, key, random IV)  (iv.tag.ciphertext)
 *   claimHash = SHA-256(claimCode + userId)            (hex)
 *
 * The claim route verifies claimHash with a timing-safe compare, checks
 * the record is unclaimed and unexpired, decrypts, wipes the cipher from
 * metadata, and returns the password exactly once — in the claim
 * response, over TLS, to whoever presented the code. The password never
 * appears in the provisioning response, the admin UI, or any log.
 */

export const DAILY_TEST_CLAIM_TTL_MS = 15 * 60 * 1000;

export interface DailyTestClaimRecord {
  v: 1;
  cipher: string;
  claimHash: string;
  expiresAt: string;
  claimed: boolean;
  claimedAt?: string;
}

export function dailyTestProvisioningEnabled() {
  return /^(true|1|enabled)$/i.test(
    (process.env.ROAMLY_DAILY_TEST_PROVISIONING || "").trim()
  );
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function dailyTestClaimHash(claimCode: string, userId: string) {
  return sha256Hex(claimCode + userId);
}

export function createDailyTestClaim(password: string, userId: string) {
  // 24 random bytes -> 192 bits of entropy, base64url-encoded.
  const claimCode = randomBytes(24).toString("base64url");
  const key = createHash("sha256").update(claimCode).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final()
  ]);
  const record: DailyTestClaimRecord = {
    v: 1,
    cipher: [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url")
    ].join("."),
    claimHash: dailyTestClaimHash(claimCode, userId),
    expiresAt: new Date(Date.now() + DAILY_TEST_CLAIM_TTL_MS).toISOString(),
    claimed: false
  };
  return { claimCode, record };
}

function isClaimRecord(value: unknown): value is DailyTestClaimRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.cipher === "string" &&
    typeof record.claimHash === "string" &&
    typeof record.expiresAt === "string" &&
    typeof record.claimed === "boolean"
  );
}

/*
 * Verify a presented claim code against a stored record and, when every
 * check passes, return the decrypted password. Any mismatch — wrong code,
 * already claimed, expired, malformed record, corrupt cipher — returns
 * null so callers can answer with one generic rejection.
 */
export function verifyDailyTestClaim(
  value: unknown,
  claimCode: string,
  userId: string
): string | null {
  if (!isClaimRecord(value)) return null;
  if (value.claimed) return null;
  if (Date.parse(value.expiresAt) <= Date.now()) return null;

  const expected = Buffer.from(
    dailyTestClaimHash(claimCode, userId),
    "utf8"
  );
  const presented = Buffer.from(value.claimHash, "utf8");
  if (
    expected.length !== presented.length ||
    !timingSafeEqual(expected, presented)
  ) {
    return null;
  }

  try {
    const [ivRaw, tagRaw, dataRaw] = value.cipher.split(".");
    if (!ivRaw || !tagRaw || !dataRaw) return null;
    const key = createHash("sha256").update(claimCode).digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivRaw, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64url")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/* The record as stored after a successful claim: cipher wiped. */
export function claimedDailyTestRecord(
  record: DailyTestClaimRecord
): DailyTestClaimRecord {
  return {
    v: 1,
    cipher: "",
    claimHash: record.claimHash,
    expiresAt: record.expiresAt,
    claimed: true,
    claimedAt: new Date().toISOString()
  };
}
