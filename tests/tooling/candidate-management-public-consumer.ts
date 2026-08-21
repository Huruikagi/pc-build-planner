import type { AppDataError } from "../../src/domain/public.js";
import type {
  CandidateCreatePort,
  CandidateEditorPrefill,
  CandidateManagementPublicApi,
  CandidateOperationError,
  CandidateQuery,
} from "../../src/features/candidate-management/public.js";

export const consumeCandidatePublicContract = async (
  api: CandidateManagementPublicApi,
  create: CandidateCreatePort,
  draft: Parameters<CandidateCreatePort["createCandidate"]>[0],
  context: Parameters<CandidateCreatePort["createCandidate"]>[1],
  prefill: CandidateEditorPrefill,
) => ({
  candidates: await api.query.listCandidates({ projectId: draft.projectId }),
  created: await create.createCandidate(draft, context),
  intent: api.createCandidateEditorIntent(prefill),
});

export const preserveCandidateErrorOwnership = (
  query: CandidateQuery,
  create: CandidateCreatePort,
  operationError: CandidateOperationError,
  dataError: AppDataError,
) => ({ query, create, operationError, dataError });

export const rejectCreateCapabilityEscalation = (
  create: CandidateCreatePort,
) => {
  // @ts-expect-error create-only port cannot update candidates
  void create.updateCandidate;
  // @ts-expect-error create-only port cannot delete candidates
  void create.deleteCandidate;
  // @ts-expect-error create-only port cannot own project lifecycle
  void create.createProject;
  // @ts-expect-error create-only port cannot mutate candidate sources
  void create.addSource;
};
