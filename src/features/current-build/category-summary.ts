import {
  type CandidatePart,
  type CandidatePartId,
  type CurrentBuild,
  PART_CATEGORIES,
  type PartCategory,
  type PositiveInteger,
} from "../../domain/public.js";
import type { MessageKey, MessageResolver } from "../../ui-messages/public.js";
import type { CategoryPolicy } from "./category-policy.js";

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

export const SELECTABLE_BUILD_CATEGORIES = PART_CATEGORIES.filter(
  (category) => category !== "uncategorized",
);

export interface CategorySelectionSummary {
  readonly category: Exclude<PartCategory, "uncategorized">;
  readonly items: readonly {
    readonly candidatePartId: CandidatePartId;
    readonly name: string;
    readonly quantity: PositiveInteger;
  }[];
  readonly displayText: string;
  readonly accessibleText: string;
  readonly isEmpty: boolean;
}

interface CreateCategorySummariesInput {
  readonly candidates: readonly CandidatePart[];
  readonly currentBuild: Readonly<CurrentBuild> | null;
  readonly policy: CategoryPolicy;
  readonly messages: MessageResolver;
}

const candidateName = (
  candidate: CandidatePart,
  messages: MessageResolver,
): string =>
  candidate.product.name?.confirmed ??
  candidate.product.name?.original ??
  messages("common.notEntered");

/** Pure presentation projection. Names remain strings and are never parsed as markup. */
export function createCategorySummaries({
  candidates,
  currentBuild,
  policy,
  messages,
}: CreateCategorySummariesInput): readonly CategorySelectionSummary[] {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const selectedByCategory = new Map<
    PartCategory,
    CategorySelectionSummary["items"]
  >();

  for (const item of currentBuild?.items ?? []) {
    const candidate = candidatesById.get(item.candidatePartId);
    if (
      candidate === undefined ||
      policy.modeFor(candidate.category) === "ineligible"
    )
      continue;
    const selected = selectedByCategory.get(candidate.category) ?? [];
    selectedByCategory.set(candidate.category, [
      ...selected,
      {
        candidatePartId: candidate.id,
        name: candidateName(candidate, messages),
        quantity: item.quantity,
      },
    ]);
  }

  return SELECTABLE_BUILD_CATEGORIES.map((category) => {
    const items = selectedByCategory.get(category) ?? [];
    const categoryName = messages(categoryMessageKeys[category]);
    const isEmpty = items.length === 0;
    const mode = policy.modeFor(category);
    const displayText = isEmpty
      ? messages("build.summaryEmpty")
      : mode === "single"
        ? (items[0]?.name ?? messages("build.summaryEmpty"))
        : items
            .map(({ name, quantity }) =>
              messages("build.summaryQuantity", { name, quantity }),
            )
            .join(messages("build.summarySeparator"));
    const accessibleSummary = isEmpty
      ? messages("build.summaryEmpty")
      : mode === "single"
        ? (items[0]?.name ?? messages("build.summaryEmpty"))
        : items
            .map(({ name, quantity }) =>
              messages("build.summaryAccessibleQuantity", { name, quantity }),
            )
            .join(messages("build.summarySeparator"));

    return {
      category,
      items,
      displayText,
      accessibleText: messages("build.summaryCategory", {
        category: categoryName,
        summary: accessibleSummary,
      }),
      isEmpty,
    };
  });
}
