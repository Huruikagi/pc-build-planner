import type {
  FoundationDataPort,
  FoundationScopedDataPort,
} from "../persistence/public.js";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  PublicApiEntry,
  ShellNavigator,
} from "./contracts.js";
import { isPersistent } from "./contracts.js";

export interface FeatureContribution<
  TKey extends string = string,
  TPublic extends object = object,
  TActivation = unknown,
> {
  readonly key: TKey;
  readonly registration: ApplicationFeatureRegistration<TPublic, TActivation>;
  readonly workerRegistration?: ApplicationWorkerRegistration;
}

/**
 * Production compositionが解決した依存だけをfeatureへ渡す。
 * featureはこのcontext以外からfoundationやshell lifecycleへ到達しない。
 */
export interface FeatureCompositionContext {
  readonly data: FoundationScopedDataPort;
  /** 置換・保守capabilityを含む完全port。backup-restore専用の依存であり、既定の絞り込みportとは別に供給する。 */
  readonly fullDataPort: FoundationDataPort;
  readonly navigator: ShellNavigator;
}

export type FeatureContributionFactory<
  TKey extends string = string,
  TPublic extends object = object,
> = (context: FeatureCompositionContext) => FeatureContribution<TKey, TPublic>;

export type FeaturePublicApiContribution<
  TContribution extends FeatureContribution,
> =
  TContribution extends FeatureContribution<infer TKey, infer TPublic>
    ? PublicApiEntry<TKey, TPublic>
    : never;

/**
 * Worker contextが参照するcatalog。
 * side panel専用contributionは`side-panel-contributions.ts`が所有し、
 * worker bundleのDOM/React非依存を保つためこのmodule graphへ持ち込まない。
 */
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
      const leftPersistent = isPersistent(left.registration);
      const rightPersistent = isPersistent(right.registration);
      if (leftPersistent !== rightPersistent) return leftPersistent ? -1 : 1;
      const byOrder =
        leftPersistent && rightPersistent
          ? left.registration.navigation.order -
            right.registration.navigation.order
          : 0;
      return (
        byOrder || left.registration.id.localeCompare(right.registration.id)
      );
    }),
  );
}
