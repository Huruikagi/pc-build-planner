import type {
  CandidatePartId,
  CandidateSourceId,
  LocalDataRootV2,
  ProjectId,
  Revision,
  UtcTimestamp,
} from "../../src/domain/public.js";

const timestamp = "2026-07-28T00:00:00.000Z" as UtcTimestamp;
const projectId = "10000000-0000-4000-8000-000000000001" as ProjectId;

export const sourceRootV2 = (): LocalDataRootV2 => ({
  schemaVersion: 2,
  revision: 1 as Revision,
  projects: [
    {
      id: projectId,
      name: "架空構成",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  candidateParts: [
    {
      id: "20000000-0000-4000-8000-000000000001" as CandidatePartId,
      projectId,
      category: "uncategorized",
      product: { name: { original: "架空候補1" } },
      normalizedAttributes: { category: "uncategorized" },
      sources: [
        {
          id: "30000000-0000-4000-8000-000000000001" as CandidateSourceId,
          pageUrl: "https://catalog.example.invalid/synthetic-part-1",
          kind: "retail",
        },
      ],
      primarySourceId:
        "30000000-0000-4000-8000-000000000001" as CandidateSourceId,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "20000000-0000-4000-8000-000000000002" as CandidatePartId,
      projectId,
      category: "uncategorized",
      product: { name: { original: "架空候補2" } },
      normalizedAttributes: { category: "uncategorized" },
      sources: [
        {
          id: "30000000-0000-4000-8000-000000000002" as CandidateSourceId,
          pageUrl: "https://catalog.example.invalid/synthetic-part-1",
          kind: "manufacturer",
        },
      ],
      primarySourceId:
        "30000000-0000-4000-8000-000000000002" as CandidateSourceId,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "20000000-0000-4000-8000-000000000003" as CandidatePartId,
      projectId,
      category: "uncategorized",
      product: { name: { original: "架空候補3" } },
      normalizedAttributes: { category: "uncategorized" },
      sources: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0 as never, active: false },
});
