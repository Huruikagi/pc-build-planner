import type {
  CoreResult,
  FinalizationTicket,
  ReplacementAssessment,
  ReplacementMode,
  RootReplacementPort,
} from "../contracts.js";

export interface BackupSnapshotReader<Root, Error> {
  read(): Promise<CoreResult<Root, Error>>;
}

/**
 * Product-owned transformation stages. Each boundary remains explicit so an
 * untrusted input cannot skip exchange-version handling or domain mapping.
 */
export interface BackupCodec<
  Root,
  RestoreInput,
  Decoded,
  Versioned,
  Candidate,
  ArtifactPayload,
  Preview,
  Error,
> {
  create(root: Root): CoreResult<ArtifactPayload, Error>;
  decode(input: RestoreInput): CoreResult<Decoded, Error>;
  version(decoded: Decoded): CoreResult<Versioned, Error>;
  map(versioned: Versioned): CoreResult<Candidate, Error>;
  toRoot(candidate: Candidate): CoreResult<Root, Error>;
  preview(candidate: Candidate): Preview;
}

export interface BackupArtifactPolicy<ArtifactPayload, Artifact, Error> {
  create(payload: ArtifactPayload): CoreResult<Artifact, Error>;
}

declare const restoreTicketBrand: unique symbol;
export interface RestoreTicket {
  readonly [restoreTicketBrand]: "restore";
}

export interface BackupPreflight<Preview> {
  readonly preview: Preview;
  readonly ticket: RestoreTicket;
}

export type BackupCommitResult<Summary> =
  | { readonly kind: "committed"; readonly summary: Summary }
  | {
      readonly kind: "committed-finalization-required";
      readonly summary: Summary;
      readonly finalization: FinalizationTicket;
    };

export interface BackupOrchestrator<
  RestoreInput,
  Artifact,
  Preview,
  Summary,
  Error,
> {
  create(): Promise<CoreResult<Artifact, Error>>;
  preflight(
    input: RestoreInput,
  ): Promise<CoreResult<Readonly<BackupPreflight<Preview>>, Error>>;
  reassess(
    ticket: RestoreTicket,
  ): Promise<CoreResult<Readonly<BackupPreflight<Preview>>, Error>>;
  commit(
    ticket: RestoreTicket,
  ): Promise<CoreResult<BackupCommitResult<Summary>, Error>>;
  findPendingFinalization(): Promise<
    CoreResult<FinalizationTicket | null, Error>
  >;
  finalize(ticket: FinalizationTicket): Promise<CoreResult<Summary, Error>>;
}

export interface BackupOrchestratorDependencies<
  Root,
  RestoreInput,
  Decoded,
  Versioned,
  Candidate,
  ArtifactPayload,
  Artifact,
  Preview,
  AssessmentPreview,
  Receipt,
  Error,
> {
  readonly snapshot: BackupSnapshotReader<Root, Error>;
  readonly codec: BackupCodec<
    Root,
    RestoreInput,
    Decoded,
    Versioned,
    Candidate,
    ArtifactPayload,
    Preview,
    Error
  >;
  readonly artifactPolicy: BackupArtifactPolicy<ArtifactPayload, Artifact, Error>;
  /** Product policy selects normal replacement or recovery before assessment. */
  readonly replacementMode: (root: Root) => ReplacementMode;
  readonly replacement: RootReplacementPort<
    Root,
    ReplacementAssessment<AssessmentPreview>,
    Receipt,
    Error
  >;
}
