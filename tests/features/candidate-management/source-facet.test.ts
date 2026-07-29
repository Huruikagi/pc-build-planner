import assert from "node:assert/strict";
import test from "node:test";
import type {
  CandidateSourceId,
  LocalDataRoot,
  Revision,
} from "../../../src/domain/public.js";
import { createCandidateManagementContribution } from "../../../src/features/candidate-management/feature-contribution.js";
import type { CandidateSourceDataPort } from "../../../src/features/candidate-management/source-data-port.js";
import type {
  FoundationDataPort,
  FoundationScopedDataPort,
  RootMutationCommand,
} from "../../../src/persistence/public.js";
import { sourceRoot } from "../../fixtures/candidate-source-root.js";

test("contributionのsources facetはcatalogと全mutationをfeature内portへ配送する", async () => {
  const root: LocalDataRoot = { ...sourceRoot(), revision: 7 as Revision };
  const commands: RootMutationCommand[] = [];
  let sourceQueries = 0;
  const data = {
    async query(project: (root: never) => unknown) {
      return { ok: true as const, value: project(root as never) };
    },
    async mutate(command: RootMutationCommand) {
      commands.push(command);
      return { ok: true as const, value: {} as never };
    },
  } as FoundationScopedDataPort;
  const sourceData: CandidateSourceDataPort = {
    async query(project) {
      sourceQueries += 1;
      return { ok: true, value: project(root) };
    },
    async mutateCandidate(candidate, context) {
      commands.push({
        requestId: context.requestId,
        expectedRevision: context.expectedRevision as Revision,
        operation: {
          kind: "update",
          entity: "candidatePart",
          value: candidate as never,
        },
      });
      return { ok: true, value: undefined };
    },
  };
  const contribution = createCandidateManagementContribution(
    {
      data,
      fullDataPort: data as FoundationDataPort,
      navigator: {
        async activate() {
          return { ok: true, value: undefined };
        },
      },
    },
    sourceData,
  );
  const api = contribution.registration.publicApi;
  const listed = await api.sources.catalog.listSourceReferences({});
  assert.equal(listed.ok && listed.value.length, 2);
  assert.equal(sourceQueries, 1);

  const candidate = root.candidateParts[0];
  assert.ok(candidate);
  const target = {
    candidateId: candidate.id,
    sourceId: candidate.primarySourceId as CandidateSourceId,
  };
  const source = candidate.sources[0];
  assert.ok(source);
  const results = [];
  results.push(
    await api.sources.mutations.addSource({
      candidateId: candidate.id,
      source: {
        id: "30000000-0000-4000-8000-000000000099" as CandidateSourceId,
        pageUrl: "https://catalog.example.invalid/synthetic-part-99",
      },
    }),
  );
  results.push(
    await api.sources.mutations.updateSource({
      candidateId: candidate.id,
      source,
    }),
  );
  results.push(await api.sources.mutations.removeSource(target));
  results.push(await api.sources.mutations.setPrimarySource(target));
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, true, true, true],
  );
  assert.equal(commands.length, 4);
  assert.deepEqual(
    commands.map((command) => command.expectedRevision),
    [7, 7, 7, 7],
  );
  assert.equal(new Set(commands.map((command) => command.requestId)).size, 4);
  assert.equal(sourceQueries, 9);
  assert.equal(api.query !== undefined, true);
  assert.equal(typeof api.createCandidateEditorIntent, "function");
  assert.equal("capture" in api, false);
});
