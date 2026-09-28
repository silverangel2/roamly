export const DETECTOR_FAILURE_CLASS = "OBSERVABILITY_DETECTOR_FAILED";
export const INCIDENT_BUCKET_MS = 15 * 60 * 1000;

export function detectorFailureResult(detector: string) {
  return {
    ok: false as const,
    detected: 0,
    recovered: 0,
    error: "DETECTOR_FAILED",
    failure_class: DETECTOR_FAILURE_CLASS,
    detector_failed: detector
  };
}

export function backgroundDetectorIncident(params: {
  detector: string;
  route: string;
  now?: number;
}) {
  const bucket = Math.floor((params.now ?? Date.now()) / INCIDENT_BUCKET_MS);
  return {
    severity: "medium" as const,
    subsystem: "background_jobs" as const,
    eventCode: "observability_detector_failed",
    fingerprintParts: ["observability-detector", params.detector, DETECTOR_FAILURE_CLASS],
    eventKey: `observability-detector-failed:${params.detector}:${bucket}`,
    correlationId: null,
    safeMetadata: {
      failure_class: DETECTOR_FAILURE_CLASS,
      job_type: params.detector,
      endpoint: params.route,
      operation: "background_observability_detector",
      retryable: true,
      source: "background_detector"
    }
  };
}
