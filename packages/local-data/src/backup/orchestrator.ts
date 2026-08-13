import type {
  ReplacementAssessmentTicket,
  ReplacementMode,
} from "../contracts.js";
import type {
  BackupOrchestrator,
  BackupOrchestratorDependencies,
  RestoreTicket,
} from "./contracts.js";

interface RestoreBinding<Root, Preview> {
  readonly root: Root;
  readonly mode: ReplacementMode;
  readonly assessment: ReplacementAssessmentTicket;
  readonly preview: Preview;
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
  FinalizationCapability = unknown,
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
    Error,
    FinalizationCapability
  >,
): BackupOrchestrator<RestoreInput, Artifact, Preview, Receipt, Error, FinalizationCapability> => {
  // The binding is deliberately closure-private. The public ticket has no
  // fields, serialization payload, candidate, root, or fencing information.
  const restoreBindings = new WeakMap<object, RestoreBinding<Root, Preview>>();

  const assess = async (
    root: Root,
    mode: ReplacementMode,
  ) =>
    mode === "recovery"
      ? dependencies.replacement.assessRecovery(root)
      : dependencies.replacement.assess(root);

  const bind = (
    root: Root,
    mode: ReplacementMode,
    assessment: ReplacementAssessmentTicket,
    preview: Preview,
  ): RestoreTicket => {
    const ticket = Object.freeze({}) as RestoreTicket;
    restoreBindings.set(ticket as object, { root, mode, assessment, preview });
    return ticket;
  };

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
      const mode = dependencies.replacementMode(root.value);
      const assessment = await assess(root.value, mode);
      if (!assessment.ok) return assessment;

      const preview = dependencies.codec.preview(candidate.value);
      const ticket = bind(root.value, mode, assessment.value.ticket, preview);
      return { ok: true, value: { preview, ticket } };
    },

    async reassess(ticket) {
      const binding = restoreBindings.get(ticket as object)!;
      const assessment = await assess(binding.root, binding.mode);
      if (!assessment.ok) return assessment;
      return {
        ok: true,
        value: {
          preview: binding.preview,
          ticket: bind(
            binding.root,
            binding.mode,
            assessment.value.ticket,
            binding.preview,
          ),
        },
      };
    },

    async commit(ticket) {
      const binding = restoreBindings.get(ticket as object)!;
      const committed = await dependencies.replacement.commit({
        candidate: binding.root,
        mode: binding.mode,
        ticket: binding.assessment,
      });
      if (!committed.ok) return committed;
      restoreBindings.delete(ticket as object);
      return committed.value.kind === "committed"
        ? {
            ok: true,
            value: { kind: "committed", summary: committed.value.receipt },
          }
        : {
            ok: true,
            value: {
              kind: "committed-finalization-required",
              summary: committed.value.receipt,
              finalization: committed.value.finalization,
            },
          };
    },

    findPendingFinalization() {
      return dependencies.replacement.findPendingFinalization();
    },

    finalize(ticket) {
      return dependencies.replacement.finalize(ticket);
    },
  };
};
