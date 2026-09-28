export const STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES = {
  configurationMissing: "WEBHOOK_CONFIGURATION_MISSING",
  signatureMissing: "WEBHOOK_SIGNATURE_MISSING",
  signatureVerificationFailed: "WEBHOOK_SIGNATURE_VERIFICATION_FAILED"
} as const;

type PreVerificationFailure = (typeof STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES)[keyof typeof STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES];

const PUBLIC_FAILURE_BUCKET_MS = 15 * 60 * 1000;

export function stripeWebhookPreVerificationIncident(
  failure: PreVerificationFailure,
  now = Date.now()
) {
  const isConfigurationFailure = failure === STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.configurationMissing;
  const bucket = Math.floor(now / PUBLIC_FAILURE_BUCKET_MS);
  const eventCode = failure === STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.configurationMissing
    ? "stripe_webhook_configuration_missing"
    : failure === STRIPE_WEBHOOK_PRE_VERIFICATION_FAILURES.signatureMissing
      ? "stripe_webhook_signature_missing"
      : "stripe_webhook_signature_verification_failed";

  return {
    severity: isConfigurationFailure ? "high" as const : "medium" as const,
    eventCode,
    fingerprintParts: ["stripe_webhook_pre_verification", failure],
    eventKey: isConfigurationFailure
      ? `stripe-webhook-pre-verification:${eventCode}`
      : `stripe-webhook-pre-verification:${eventCode}:${bucket}`,
    safeMetadata: {
      operation: "stripe_webhook",
      stage: "pre_verification",
      failure_class: failure,
      retryable: isConfigurationFailure
    },
    correlationId: null
  };
}
