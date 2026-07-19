import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  PublicApiEntry,
} from "./contracts.js";

export interface FeatureContribution<
  TKey extends string = string,
  TPublic extends object = object,
> {
  readonly key: TKey;
  readonly registration: ApplicationFeatureRegistration<TPublic>;
  readonly workerRegistration?: ApplicationWorkerRegistration;
}

export type FeaturePublicApiContribution<
  TContribution extends FeatureContribution,
> =
  TContribution extends FeatureContribution<infer TKey, infer TPublic>
    ? PublicApiEntry<TKey, TPublic>
    : never;

export const featureContributionCatalog = Object.freeze(
  [],
) as readonly [] satisfies readonly FeatureContribution[];

export function getSidePanelContributions<
  const TCatalog extends readonly FeatureContribution[],
>(catalog: TCatalog): readonly TCatalog[number][] {
  return ordered(catalog);
}

export function getPublicApiContributions<
  const TCatalog extends readonly FeatureContribution[],
>(
  catalog: TCatalog,
): readonly FeaturePublicApiContribution<TCatalog[number]>[] {
  return Object.freeze(
    ordered(catalog).map(({ key, registration }) => ({
      key,
      publicApi: registration.publicApi,
    })),
  ) as readonly FeaturePublicApiContribution<TCatalog[number]>[];
}

export function getWorkerContributions<
  const TCatalog extends readonly FeatureContribution[],
>(catalog: TCatalog): readonly ApplicationWorkerRegistration[] {
  return Object.freeze(
    ordered(catalog).flatMap(({ workerRegistration }) =>
      workerRegistration ? [workerRegistration] : [],
    ),
  );
}

function ordered<const TCatalog extends readonly FeatureContribution[]>(
  catalog: TCatalog,
): readonly TCatalog[number][] {
  return Object.freeze(
    [...catalog].sort((left, right) => {
      const byOrder =
        left.registration.navigation.order -
        right.registration.navigation.order;
      return (
        byOrder || left.registration.id.localeCompare(right.registration.id)
      );
    }),
  );
}
