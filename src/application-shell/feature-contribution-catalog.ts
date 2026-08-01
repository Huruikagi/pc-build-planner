import { productCaptureWorkerContribution } from "../features/product-capture/public.js";
import { sourcePriceRefreshWorkerContribution } from "../features/source-price-refresh/public.js";
import type { FoundationScopedDataPort } from "../persistence/public.js";
import type {
  ApplicationFeatureRegistration,
  ApplicationWorkerRegistration,
  PublicApiEntry,
  ShellNavigator,
} from "./contracts.js";
import { isPersistent } from "./contracts.js";
import type {
  TransientActivationRequest,
  TransientGestureSource,
  TransientMenuGestureDependencies,
} from "./transient-surface-ports.js";

export interface FeatureContribution<
  TKey extends string = string,
  TPublic extends object = object,
  TActivation = unknown,
  TTransientActivation = TransientActivationRequest,
> {
  readonly key: TKey;
  readonly registration: ApplicationFeatureRegistration<
    TPublic,
    TActivation,
    TTransientActivation
  >;
  readonly workerRegistration?: ApplicationWorkerRegistration;
}

/**
 * Production compositionが解決した依存だけをfeatureへ渡す。
 * featureはこのcontext以外からfoundationやshell lifecycleへ到達しない。
 */
export interface FeatureCompositionContext {
  readonly data: FoundationScopedDataPort;
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
/**
 * feature所有のmenu gesture source factory。
 * production worker compositionはこれをshellの同期gesture portへ接続するだけで、
 * UI contribution、DOM、Reactのいずれも経由しない。
 */
export type WorkerMenuGestureFactory = (
  dependencies: TransientMenuGestureDependencies,
) => TransientGestureSource;

export interface WorkerFeatureContribution {
  readonly registration?: ApplicationFeatureRegistration<
    object,
    unknown,
    TransientActivationRequest
  >;
  readonly workerRegistration?: ApplicationWorkerRegistration;
  readonly transientSurfaceId?: ApplicationFeatureRegistration["id"];
  readonly createMenuGestureSource?: WorkerMenuGestureFactory;
}

export const featureContributionCatalog = Object.freeze([
  productCaptureWorkerContribution,
  sourcePriceRefreshWorkerContribution,
] as const) satisfies readonly WorkerFeatureContribution[];

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
  const TCatalog extends readonly WorkerFeatureContribution[],
>(catalog: TCatalog): readonly ApplicationWorkerRegistration[] {
  return Object.freeze(
    [...catalog]
      .sort((left, right) => {
        if (left.registration === undefined || right.registration === undefined)
          return 0;
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
      })
      .flatMap(({ workerRegistration }) =>
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
