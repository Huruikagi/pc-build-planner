import type {
  CoreResult,
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

export type BackupCommitResult<Summary, FinalizationCapability> =
  | { readonly kind: "committed"; readonly summary: Summary }
  | {
      readonly kind: "committed-finalization-required";
      readonly summary: Summary;
      readonly finalization: FinalizationCapability;
    };

export interface BackupOrchestrator<
  RestoreInput,
  Artifact,
  Preview,
  Summary,
  Error,
  FinalizationCapability = unknown,
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
  ): Promise<CoreResult<BackupCommitResult<Summary, FinalizationCapability>, Error>>;
  findPendingFinalization(): Promise<
    CoreResult<FinalizationCapability | null, Error>
  >;
  finalize(ticket: FinalizationCapability): Promise<CoreResult<Summary, Error>>;
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
  FinalizationCapability = unknown,
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
    Error,
    FinalizationCapability
  >;
}
