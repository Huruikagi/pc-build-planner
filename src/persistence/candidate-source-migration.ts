import type {
  CandidatePartV2,
  CandidateSource,
  CandidateSourceId,
  LocalDataRootV2,
} from "../domain/model.js";
import { schemaV2Validator, schemaValidator } from "../domain/validation.js";
import type { MigrationStep } from "./migration-registry.js";

/** Schema 1から2への純粋変換。production registryへの登録はcutover taskが所有する。 */
export const migrateCandidateSourcesV1ToV2: MigrationStep<1, 2> = {
  from: 1,
  to: 2,
  migrate(input) {
    const legacy = schemaValidator.validateRoot(input);
    if (!legacy.ok)
      return {
        ok: false,
        error: { code: "validation", version: 1, issue: legacy.error },
      };

    const candidateParts = legacy.value.candidateParts.map((candidate) => {
      const { price, ...product } = candidate.product;
      const { sourceInfo, ...candidateWithoutSourceInfo } = candidate;
      const hasSource = sourceInfo !== undefined || price !== undefined;
      if (!hasSource)
        return {
          ...candidateWithoutSourceInfo,
          product,
          sources: [],
        } satisfies CandidatePartV2;

      const source = {
        id: candidate.id as unknown as CandidateSourceId,
        ...(sourceInfo ?? {}),
        ...(price === undefined ? {} : { price }),
      } satisfies CandidateSource;
      return {
        ...candidateWithoutSourceInfo,
        product,
        sources: [source],
        primarySourceId: source.id,
      } satisfies CandidatePartV2;
    });

    const output = {
      ...legacy.value,
      schemaVersion: 2,
      candidateParts,
    } satisfies LocalDataRootV2;
    const validated = schemaV2Validator.validateRoot(output);
    return validated.ok
      ? validated
      : {
          ok: false,
          error: { code: "validation", version: 2, issue: validated.error },
        };
  },
};
