import { err, ok, type Result } from "../../domain/public.js";
import type {
  CaptureCandidatePort,
  ManagementError,
} from "../candidate-management/public.js";
import type { CaptureError, ConfirmedCaptureSession } from "./contracts.js";
import type { CaptureDraftMapper } from "./draft-mapper.js";
import type { CaptureSubmitOutcome } from "./state.js";

export interface SubmitCaptureDraftDependencies {
  readonly draftMapper: CaptureDraftMapper;
  readonly capturePort: CaptureCandidatePort;
}

const toCaptureError = (error: ManagementError): CaptureError => {
  switch (error.kind) {
    case "validation":
      return { kind: "validation", fields: error.fields };
    case "maintenance":
      return { kind: "maintenance" };
    case "storage":
      return { kind: "storage" };
    case "quota":
      return { kind: "quota" };
    case "unsupported-data":
      return { kind: "unsupported-data" };
    default:
      // "conflict"/"not-found" are not expected from a single create call;
      // fold them into the same generic, retriable bucket as a storage failure.
      return { kind: "storage" };
  }
};

/**
 * Builds `CaptureState`'s `submitDraft` dependency: map the session once,
 * create the candidate once, and never re-implement persistence, capacity, or
 * migration logic that `CaptureCandidatePort` already owns.
 */
export const createSubmitCaptureDraft =
  (dependencies: SubmitCaptureDraftDependencies) =>
  async (
    session: ConfirmedCaptureSession,
  ): Promise<Result<CaptureSubmitOutcome, CaptureError>> => {
    const draft = dependencies.draftMapper.toCandidateDraft(session);
    if (!draft.ok) return draft;

    try {
      const created = await dependencies.capturePort.createCandidate(
        draft.value,
      );
      if (!created.ok) return err(toCaptureError(created.error));
      return ok({
        candidateId: created.value.id,
        projectId: created.value.projectId,
      });
    } catch {
      return err({ kind: "storage" });
    }
  };
