import { useState, useSyncExternalStore } from "react";

import {
  type CandidatePartId,
  PART_CATEGORIES,
  type PartCategory,
} from "../../domain/public.js";
import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import { useMessages } from "../../ui-messages/public.js";
import { createCategoryPolicy, isValidQuantity } from "./category-policy.js";
import type { BuildDisplayError, BuildState } from "./state.js";

const categoryMessageKeys = {
  cpu: "category.cpu",
  "cpu-cooler": "category.cpu-cooler",
  motherboard: "category.motherboard",
  memory: "category.memory",
  gpu: "category.gpu",
  storage: "category.storage",
  "power-supply": "category.power-supply",
  case: "category.case",
  "case-fan": "category.case-fan",
  "expansion-card": "category.expansion-card",
  other: "category.other",
  uncategorized: "category.uncategorized",
} as const satisfies Record<PartCategory, MessageKey>;

/** Uncategorized candidates are never build-eligible, so the tab never applies. */
const selectableCategories = PART_CATEGORIES.filter(
  (category) => category !== "uncategorized",
);

const errorMessageKeys = {
  validation: "persistenceError.validation",
  "not-found": "build.notFound",
  conflict: "persistenceError.conflict",
  maintenance: "persistenceError.maintenance",
  "corrupt-data": "build.corruptData",
  "unsupported-data": "build.unsupportedData",
  quota: "persistenceError.quota",
  storage: "build.storage",
  "snapshot-restore-failed": "persistenceError.snapshotRestoreFailed",
} as const satisfies Record<BuildDisplayError["code"], MessageKey>;

const policy = createCategoryPolicy();

const displayName = (
  candidate: {
    readonly product: {
      readonly name?: {
        readonly original: string | null;
        readonly confirmed?: string;
      };
    };
  },
  messages: MessageResolver,
): string =>
  candidate.product.name?.confirmed ??
  candidate.product.name?.original ??
  messages("common.notEntered");

/** Renders feature-owned state without moving domain state into React hooks. */
export function BuildView({ state }: { readonly state: BuildState }) {
  const messages = useMessages();
  useSyncExternalStore(
    (listener) => state.subscribe(listener),
    () => state.value,
    () => state.value,
  );
  const [quantityErrors, setQuantityErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const value = state.value;
  const disabled = value.isSaving || value.mutationsDisabled;
  const itemsByCandidate = new Map(
    (value.currentBuild?.items ?? []).map((item) => [
      item.candidatePartId,
      item,
    ]),
  );

  const select = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    void state.execute({
      type: "select",
      projectId: value.selectedProjectId,
      candidatePartId,
    });
  };
  const remove = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    void state.execute({
      type: "remove",
      projectId: value.selectedProjectId,
      candidatePartId,
    });
  };
  const confirmQuantity = (candidatePartId: CandidatePartId) => {
    if (value.selectedProjectId === null) return;
    const draft = value.quantityDrafts[candidatePartId];
    const parsed = Number(draft);
    if (!isValidQuantity("multiple", parsed)) {
      setQuantityErrors((current) => ({
        ...current,
        [candidatePartId]: messages("build.invalidQuantity"),
      }));
      return;
    }
    setQuantityErrors((current) => {
      const { [candidatePartId]: _removed, ...rest } = current;
      return rest;
    });
    void state.execute({
      type: "set-quantity",
      projectId: value.selectedProjectId,
      candidatePartId,
      quantity: parsed,
    });
  };

  return (
    <section aria-label={messages("build.title")} className="current-build">
      <nav aria-label={messages("build.projectsNav")}>
        {value.projects.map((project) => (
          <button
            aria-current={
              project.id === value.selectedProjectId ? "page" : undefined
            }
            data-project-id={project.id}
            disabled={disabled}
            key={project.id}
            onClick={() => void state.selectProject(project.id)}
            type="button"
          >
            {project.name}
          </button>
        ))}
      </nav>
      <nav aria-label={messages("build.categoryNav")}>
        {selectableCategories.map((category) => (
          <button
            aria-current={
              category === value.selectedCategory ? "page" : undefined
            }
            data-category={category}
            key={category}
            onClick={() => state.selectCategory(category)}
            type="button"
          >
            {messages(categoryMessageKeys[category])}
          </button>
        ))}
      </nav>
      {value.candidates.length === 0 ? (
        <p>{messages("build.noCandidates")}</p>
      ) : (
        <ul
          aria-label={messages("build.candidateListLabel")}
          data-region="candidate-list"
        >
          {value.candidates.map((candidate) => {
            const mode = policy.modeFor(candidate.category);
            const item = itemsByCandidate.get(candidate.id);
            const name = displayName(candidate, messages);
            const quantityError = quantityErrors[candidate.id];

            if (mode !== "multiple") {
              return (
                <li key={candidate.id}>
                  <span>{name}</span>
                  {item === undefined ? (
                    <button
                      data-select-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => select(candidate.id)}
                      type="button"
                    >
                      {messages("build.select")}
                    </button>
                  ) : (
                    <button
                      data-remove-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => remove(candidate.id)}
                      type="button"
                    >
                      {messages("build.remove")}
                    </button>
                  )}
                </li>
              );
            }

            return (
              <li key={candidate.id}>
                <span>{name}</span>
                {item === undefined ? (
                  <button
                    data-select-candidate-id={candidate.id}
                    disabled={disabled}
                    onClick={() => select(candidate.id)}
                    type="button"
                  >
                    {messages("build.add")}
                  </button>
                ) : (
                  <>
                    <input
                      aria-describedby={
                        quantityError === undefined
                          ? undefined
                          : `quantity-error-${candidate.id}`
                      }
                      aria-invalid={
                        quantityError === undefined ? undefined : true
                      }
                      data-quantity-input={candidate.id}
                      disabled={disabled}
                      inputMode="numeric"
                      onChange={(event) =>
                        state.setQuantityDraft(candidate.id, event.target.value)
                      }
                      value={
                        value.quantityDrafts[candidate.id] ??
                        String(item.quantity)
                      }
                    />
                    <button
                      data-confirm-quantity={candidate.id}
                      disabled={disabled}
                      onClick={() => confirmQuantity(candidate.id)}
                      type="button"
                    >
                      {messages("build.confirmQuantity")}
                    </button>
                    {quantityError === undefined ? null : (
                      <p id={`quantity-error-${candidate.id}`} role="alert">
                        {quantityError}
                      </p>
                    )}
                    <button
                      data-remove-candidate-id={candidate.id}
                      disabled={disabled}
                      onClick={() => remove(candidate.id)}
                      type="button"
                    >
                      {messages("build.remove")}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {value.currentBuild === null ? (
        <p>{messages("build.noCurrentBuild")}</p>
      ) : null}
      {value.displayError === null ? null : (
        <p role="alert">
          {messages(errorMessageKeys[value.displayError.code])}
        </p>
      )}
    </section>
  );
}
