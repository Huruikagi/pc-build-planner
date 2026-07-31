import {
  CAPTURE_CORE_FIELDS,
  type CaptureDraftFields,
  type CaptureField,
  type ExtractionSource,
  type NormalizedField,
} from "./contracts.js";

export interface CandidateRanker {
  select(candidates: readonly NormalizedField[]): CaptureDraftFields;
}

/** Fixed selection order: json-ld > meta > heading/breadcrumb (tied) > table/definition-list (tied). */
const SOURCE_PRIORITY: Readonly<Record<ExtractionSource, number>> = {
  "json-ld": 0,
  meta: 1,
  heading: 2,
  breadcrumb: 2,
  table: 3,
  "definition-list": 3,
  "domain-map": 4,
};

interface Ranked {
  readonly entry: NormalizedField;
  readonly index: number;
}

export const createCandidateRanker = (): CandidateRanker => ({
  select(candidates) {
    const bestByField = new Map<CaptureField, Ranked>();

    candidates.forEach((entry, index) => {
      const priority = SOURCE_PRIORITY[entry.source];
      const current = bestByField.get(entry.field);

      if (current === undefined) {
        bestByField.set(entry.field, { entry, index });
        return;
      }

      const currentPriority = SOURCE_PRIORITY[current.entry.source];
      if (
        priority < currentPriority ||
        (priority === currentPriority &&
          (entry.documentOrder < current.entry.documentOrder ||
            (entry.documentOrder === current.entry.documentOrder &&
              index < current.index)))
      ) {
        bestByField.set(entry.field, { entry, index });
      }
    });

    const fields = Array.from(bestByField.values())
      .sort((a, b) => a.index - b.index)
      .map(({ entry }) => entry);

    const presentFields = new Set(fields.map((entry) => entry.field));
    const missingCoreFields = CAPTURE_CORE_FIELDS.filter(
      (coreField) => !presentFields.has(coreField),
    );

    return Object.freeze({
      fields: Object.freeze(fields),
      missingCoreFields: Object.freeze(missingCoreFields),
    });
  },
});
