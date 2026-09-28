import { recordOperationalEvent } from "@/lib/roamly/operationalIncidents";
import {
  backgroundDetectorIncident,
  detectorFailureResult,
  DETECTOR_FAILURE_CLASS,
  INCIDENT_BUCKET_MS
} from "@/lib/roamly/observabilityDetectorDiagnosticsLogic";

type DetectorRecorder = typeof recordOperationalEvent;

export type BackgroundDetectorFailure = {
  detector: string;
  route: string;
  error?: string;
};

export async function recordBackgroundDetectorFailure(
  params: BackgroundDetectorFailure & { recorder?: DetectorRecorder; now?: number }
) {
  const recorder = params.recorder || recordOperationalEvent;
  try {
    const result = await recorder(backgroundDetectorIncident(params));
    return result.ok;
  } catch {
    console.warn("[Roamly observability] detector diagnostic unavailable", {
      detector: params.detector,
      failure_class: DETECTOR_FAILURE_CLASS
    });
    return false;
  }
}

export { detectorFailureResult, DETECTOR_FAILURE_CLASS, INCIDENT_BUCKET_MS };
