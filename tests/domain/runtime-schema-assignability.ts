/**
 * Typecheck-only fixture: a schema declared with the shared kernel must infer a
 * type that is assignable to the existing public contract *and* accept that
 * contract's values, with no cast on either side. `pnpm typecheck` is the
 * assertion; this module is never executed.
 */

import type { UtcTimestamp } from "../../src/domain/identifiers.js";
import type {
  BuildItem,
  CandidatePartId,
  CandidateSource,
  CandidateSourceId,
  CurrentBuild,
  CurrentBuildId,
  PositiveInteger,
  Project,
  ProjectId,
} from "../../src/domain/model.js";
import {
  decodeWithProfile,
  httpUrl,
  optionalField,
  plainObject,
  positiveInteger,
  type SchemaOutput,
  safeString,
  tagged,
  utcTimestamp,
  uuid,
  z,
} from "../../src/domain/runtime-schema/public.js";

const projectSchema = plainObject(
  {
    id: tagged(uuid<ProjectId>(), "invalid-uuid"),
    name: tagged(safeString(), "invalid-string"),
    createdAt: tagged(utcTimestamp<UtcTimestamp>(), "invalid-utc-timestamp"),
    updatedAt: tagged(utcTimestamp<UtcTimestamp>(), "invalid-utc-timestamp"),
  },
  { nonObjectTag: "missing-field", unsafeObjectTag: "forbidden-payload" },
);

const buildItemSchema = plainObject({
  candidatePartId: tagged(uuid<CandidatePartId>(), "invalid-uuid"),
  quantity: tagged(
    positiveInteger<PositiveInteger>(),
    "invalid-positive-integer",
  ),
});

const currentBuildSchema = plainObject({
  id: tagged(uuid<CurrentBuildId>(), "invalid-uuid"),
  projectId: tagged(uuid<ProjectId>(), "invalid-uuid"),
  items: tagged(z.array(buildItemSchema), "invalid-array"),
  updatedAt: tagged(utcTimestamp<UtcTimestamp>(), "invalid-utc-timestamp"),
});

/**
 * Optional keys stay exact-optional, which is what the existing public
 * contracts declare under `exactOptionalPropertyTypes`.
 */
const sourceSchema = plainObject({
  id: tagged(uuid<CandidateSourceId>(), "invalid-uuid"),
  pageUrl: optionalField(tagged(httpUrl(), "invalid-url")),
  siteName: optionalField(tagged(safeString(), "invalid-string")),
  capturedAt: optionalField(
    tagged(utcTimestamp<UtcTimestamp>(), "invalid-utc-timestamp"),
  ),
});

type DecodedProject = SchemaOutput<typeof projectSchema>;
type DecodedBuildItem = SchemaOutput<typeof buildItemSchema>;
type DecodedCurrentBuild = SchemaOutput<typeof currentBuildSchema>;
type DecodedSource = SchemaOutput<typeof sourceSchema>;

// Schema output → existing public type.
export const decodedProjectIsPublic: Project = {} as DecodedProject;
export const decodedBuildItemIsPublic: BuildItem = {} as DecodedBuildItem;
export const decodedBuildIsPublic: CurrentBuild = {} as DecodedCurrentBuild;
export const decodedSourceIsPublic: Omit<CandidateSource, "price" | "kind"> =
  {} as DecodedSource;

// Existing public type → schema output.
export const publicProjectIsDecoded: DecodedProject = {} as Project;
export const publicBuildItemIsDecoded: DecodedBuildItem = {} as BuildItem;
export const publicBuildIsDecoded: DecodedCurrentBuild = {} as CurrentBuild;
export const publicSourceIsDecoded: DecodedSource = {} as Omit<
  CandidateSource,
  "price" | "kind"
>;

// `decodeWithProfile` hands the owner its own contract, not a vendor type.
export const decodedThroughProfile = (input: unknown): Project | undefined => {
  const result = decodeWithProfile(projectSchema, input, {
    toError: (issue, path) => ({ code: issue.tag ?? issue.code, path }),
  });
  return result.ok ? result.value : undefined;
};
