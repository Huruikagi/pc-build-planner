import type { ReplacementAssessmentTicket } from "../contracts.js";
import type {
  BackupOrchestrator,
  BackupOrchestratorDependencies,
  RestoreTicket,
} from "./contracts.js";

interface RestoreBinding<Root> {
  readonly root: Root;
  readonly assessment: ReplacementAssessmentTicket;
}

export const createBackupOrchestrator = <
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
>(
  dependencies: BackupOrchestratorDependencies<
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
    Error
  >,
): BackupOrchestrator<RestoreInput, Artifact, Preview, Error> => {
  // The binding is deliberately closure-private. The public ticket has no
  // fields, serialization payload, candidate, root, or fencing information.
  const restoreBindings = new WeakMap<object, RestoreBinding<Root>>();

  return {
    async create() {
      const snapshot = await dependencies.snapshot.read();
      if (!snapshot.ok) return snapshot;
      const payload = dependencies.codec.create(snapshot.value);
      if (!payload.ok) return payload;
      return dependencies.artifactPolicy.create(payload.value);
    },

    async preflight(input) {
      const decoded = dependencies.codec.decode(input);
      if (!decoded.ok) return decoded;
      const versioned = dependencies.codec.version(decoded.value);
      if (!versioned.ok) return versioned;
      const candidate = dependencies.codec.map(versioned.value);
      if (!candidate.ok) return candidate;
      const root = dependencies.codec.toRoot(candidate.value);
      if (!root.ok) return root;
      const assessment = await dependencies.replacement.assess(root.value);
      if (!assessment.ok) return assessment;

      const preview = dependencies.codec.preview(candidate.value);
      const ticket = Object.freeze({}) as RestoreTicket;
      restoreBindings.set(ticket as object, {
        root: root.value,
        assessment: assessment.value.ticket,
      });
      return { ok: true, value: { preview, ticket } };
    },
  };
};
