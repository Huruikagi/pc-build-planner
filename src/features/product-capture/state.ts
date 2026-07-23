import {
  type CandidatePartId,
  createRequestId,
  type ProjectId,
  type Result,
} from "../../domain/public.js";
import type {
  CaptureError,
  CaptureField,
  CaptureResult,
  CaptureSession,
  CaptureSessionState,
  ConfirmedCaptureSession,
} from "./contracts.js";
import type { CaptureCoordinator } from "./coordinator.js";

export interface CaptureSubmitOutcome {
  readonly candidateId: CandidatePartId;
  readonly projectId: ProjectId;
}

export interface CaptureStateDependencies {
  readonly coordinator: CaptureCoordinator;
  /** Real port-calling logic (draft mapping + `CaptureCandidatePort`) is wired by later tasks. */
  readonly submitDraft: (
    session: ConfirmedCaptureSession,
  ) => Promise<Result<CaptureSubmitOutcome, CaptureError>>;
  readonly createRequestId?: () => string;
}

const resolvedName = (session: CaptureSession): string => {
  const corrected = session.userCorrections.name;
  if (corrected !== undefined) return corrected.trim();
  const confirmed = session.fields.find((field) => field.field === "name")
    ?.value.confirmed;
  return typeof confirmed === "string" ? confirmed.trim() : "";
};

export class CaptureState {
  #listeners = new Set<() => void>();
  #value: CaptureSessionState = { status: "idle" };

  public constructor(private readonly dependencies: CaptureStateDependencies) {}

  public get value(): CaptureSessionState {
    return this.#value;
  }

  /** Lets the React adapter observe feature-owned state without owning it. */
  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.#listeners.delete(listener);
    };
  }

  /** Always targets the currently displayed page; there is no cached prior tab. */
  public async startCapture(): Promise<void> {
    if (
      this.#value.status === "extracting" ||
      this.#value.status === "submitting"
    ) {
      return;
    }
    const requestId = (this.dependencies.createRequestId ?? createRequestId)();
    this.#set({ status: "extracting", requestId });

    let result: Result<CaptureResult, CaptureError>;
    try {
      result = await this.dependencies.coordinator.captureCurrentTab();
    } catch {
      this.#set({
        status: "failed",
        recoverable: true,
        error: { kind: "injection-failed" },
      });
      return;
    }
    if (!result.ok) {
      this.#set({ status: "failed", recoverable: true, error: result.error });
      return;
    }

    const session: CaptureSession = {
      requestId: result.value.requestId,
      tabId: result.value.tabId,
      pageUrl: result.value.pageUrl,
      capturedAt: result.value.capturedAt,
      fields: result.value.draft.fields.map((field) => ({
        field: field.field,
        value: { original: field.rawValue, confirmed: field.normalizedValue },
        source: field.source,
        sourceLabel: field.sourceLabel,
      })),
      rejectedFields: result.value.rejectedFields,
      missingCoreFields: result.value.draft.missingCoreFields,
      userCorrections: {},
    };
    this.#set({ status: "review", session });
  }

  /** A failure with a retained draft is still editable, exactly like `review`. */
  #activeSession(): CaptureSession | undefined {
    if (this.#value.status === "review") return this.#value.session;
    if (this.#value.status === "failed" && this.#value.draft !== undefined) {
      return this.#value.draft;
    }
    return undefined;
  }

  public updateField(field: CaptureField, value: string): void {
    const session = this.#activeSession();
    if (session === undefined) return;
    this.#set({
      status: "review",
      session: {
        ...session,
        userCorrections: { ...session.userCorrections, [field]: value },
      },
    });
  }

  public selectProject(projectId: ProjectId): void {
    const session = this.#activeSession();
    if (session === undefined) return;
    this.#set({ status: "review", session: { ...session, projectId } });
  }

  /** Flips to `submitting` before awaiting the port call, so a re-entrant call is a no-op. */
  public async submit(): Promise<void> {
    const session = this.#activeSession();
    if (session === undefined) return;

    if (resolvedName(session).length === 0) {
      this.#set({
        status: "failed",
        recoverable: true,
        draft: session,
        error: { kind: "validation", fields: { name: "required" } },
      });
      return;
    }
    if (session.projectId === undefined) {
      this.#set({
        status: "failed",
        recoverable: true,
        draft: session,
        error: { kind: "project-required" },
      });
      return;
    }

    const confirmed: ConfirmedCaptureSession = {
      ...session,
      projectId: session.projectId,
    };
    this.#set({ status: "submitting", session: confirmed });

    let result: Result<CaptureSubmitOutcome, CaptureError>;
    try {
      result = await this.dependencies.submitDraft(confirmed);
    } catch {
      this.#set({
        status: "failed",
        recoverable: true,
        draft: session,
        error: { kind: "storage" },
      });
      return;
    }
    if (!result.ok) {
      this.#set({
        status: "failed",
        recoverable: true,
        draft: session,
        error: result.error,
      });
      return;
    }
    this.#set({
      status: "saved",
      candidateId: result.value.candidateId,
      projectId: result.value.projectId,
    });
  }

  #set(next: CaptureSessionState): void {
    this.#value = next;
    for (const listener of this.#listeners) listener();
  }
}

export const createCaptureState = (
  dependencies: CaptureStateDependencies,
): CaptureState => new CaptureState(dependencies);
