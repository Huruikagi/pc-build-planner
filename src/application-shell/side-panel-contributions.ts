import { createBackupRestoreSectionMount } from "../features/backup-restore/public.js";
import {
  type CandidateManagementContribution,
  createCandidateManagementContribution,
  createCandidateSourceDataPort,
  createChromeSourcePagePort,
  createSourceKindClassifier,
  type SourcePagePort,
  type TabsCreatePort,
} from "../features/candidate-management/feature-contribution.js";
import {
  type CompatibilityContribution,
  createCompatibilityContribution,
} from "../features/compatibility/feature-contribution.js";
import {
  type CurrentBuildContribution,
  createCurrentBuildContribution,
} from "../features/current-build/feature-contribution.js";
import {
  type CaptureRuntimePort,
  type ChromeScriptingApi,
  type ChromeTabsApi,
  createChromeCaptureRuntimePort,
  createProductCaptureContribution,
  type ProductCaptureContribution,
} from "../features/product-capture/feature-contribution.js";
import {
  createProductCapturePublicApi,
  createProductIdentityNormalizer,
} from "../features/product-capture/public.js";
import {
  createSettingsContribution,
  type SettingsContribution,
} from "../features/settings/feature-contribution.js";
import {
  createSourcePriceRefreshContribution,
  type SourcePriceRefreshContribution,
} from "../features/source-price-refresh/feature-contribution.js";
import type { SourcePriceRefreshPort } from "../features/source-price-refresh/public.js";
import type { FoundationDataPort } from "../persistence/public.js";
import type { FeatureCompositionContext } from "./feature-contribution-catalog.js";
import type { TransientSurfaceLifecyclePort } from "./transient-surface-ports.js";

/**
 * The only module that knows the concrete side panel features.
 * Feature UI pulls React in, so the service worker must never reach this graph.
 */
export type SidePanelFeatureContributions = readonly [
  CandidateManagementContribution,
  CurrentBuildContribution,
  ProductCaptureContribution,
  CompatibilityContribution,
  SettingsContribution,
  SourcePriceRefreshContribution,
];

/** Real `chrome.tabs`/`chrome.scripting` handles, supplied by the runtime entrypoint. */
export interface SidePanelChromeApis {
  readonly tabs: ChromeTabsApi;
  readonly scripting: ChromeScriptingApi;
}

export interface SidePanelCandidateFactories {
  readonly createSourcePagePort?: (tabs?: TabsCreatePort) => SourcePagePort;
}

export interface SidePanelContributionDependencies {
  /** Full replacement/maintenance capability is restricted to backup/restore composition. */
  readonly backupRestoreData: FoundationDataPort;
  readonly transientSurface?: TransientSurfaceLifecyclePort;
}

/**
 * Used only where no `chrome` runtime is available (e.g. this module's own
 * unit tests). Never used in production: `src/runtime/side-panel.ts` always
 * supplies real `chromeApis`.
 */
const inertCaptureRuntimePort: CaptureRuntimePort = {
  async getTab() {
    return { ok: false, error: { kind: "tab-unavailable" } };
  },
  async inject() {
    return { ok: false, error: "unknown" };
  },
};

/**
 * current-build depends on candidate-management's public query, and
 * product-capture depends on both its public query and its capture port, so
 * contributions are built in dependency order rather than as a uniform list.
 */
export const createSidePanelFeatureContributions = (
  context: FeatureCompositionContext,
  dependencies: SidePanelContributionDependencies,
  chromeApis?: SidePanelChromeApis,
  factories: SidePanelCandidateFactories = {},
): SidePanelFeatureContributions => {
  const productCapturePublic = createProductCapturePublicApi();
  let composedSourcePriceRefresh: SourcePriceRefreshPort | undefined;
  const duplicateRefreshPort: SourcePriceRefreshPort = {
    async matchSource(input) {
      return (
        composedSourcePriceRefresh?.matchSource(input) ?? {
          ok: false,
          error: { kind: "unexpected" },
        }
      );
    },
    async refreshCapturedPrice(input) {
      return (
        composedSourcePriceRefresh?.refreshCapturedPrice(input) ?? {
          ok: false,
          error: { kind: "unexpected" },
        }
      );
    },
  };
  const candidateManagement = createCandidateManagementContribution(context, {
    sourceData: createCandidateSourceDataPort(context.data),
    classifier: createSourceKindClassifier(
      productCapturePublic.manufacturerDomains,
    ),
    sourcePage: (factories.createSourcePagePort ?? createChromeSourcePagePort)(
      chromeApis?.tabs.create === undefined
        ? undefined
        : { create: chromeApis.tabs.create.bind(chromeApis.tabs) },
    ),
    identityNormalizer: createProductIdentityNormalizer(),
    sourcePriceRefresh: duplicateRefreshPort,
  });
  const currentBuild = createCurrentBuildContribution(context, {
    candidates: candidateManagement.registration.publicApi.query,
  });
  const productCapture = createProductCaptureContribution(context, {
    runtime:
      chromeApis === undefined
        ? inertCaptureRuntimePort
        : createChromeCaptureRuntimePort(chromeApis),
    transientSurface: dependencies.transientSurface ?? {
      isCurrent: () => false,
      waitUntilCurrent: async () => false,
      dismiss: async () => ({ ok: false, error: { kind: "not-started" } }),
      async conclude() {
        return { ok: false, error: { kind: "not-started" } };
      },
    },
    createCandidateEditorIntent:
      candidateManagement.registration.publicApi.createCandidateEditorIntent,
  });
  const compatibility = createCompatibilityContribution(context, {
    currentBuildQuery: currentBuild.registration.publicApi.query,
    candidateQuery: candidateManagement.registration.publicApi.query,
    async getProjectId() {
      const projects =
        await candidateManagement.registration.publicApi.query.listProjects();
      return projects.ok ? (projects.value[0]?.id ?? null) : null;
    },
  });
  const settings = createSettingsContribution({
    backupRestore: createBackupRestoreSectionMount({
      data: dependencies.backupRestoreData,
    }),
  });
  const sourcePriceRefresh = createSourcePriceRefreshContribution({
    catalog: candidateManagement.registration.publicApi.sources.catalog,
    mutations: candidateManagement.registration.publicApi.sources.mutations,
    pagePriceExtraction:
      productCapture.registration.publicApi.pagePriceExtraction,
    transientSurface: dependencies.transientSurface ?? {
      isCurrent: () => false,
      waitUntilCurrent: async () => false,
      dismiss: async () => ({ ok: false, error: { kind: "not-started" } }),
      async conclude() {
        return { ok: false, error: { kind: "not-started" } };
      },
    },
  });
  composedSourcePriceRefresh =
    sourcePriceRefresh.registration.publicApi.refresh;
  return [
    candidateManagement,
    currentBuild,
    productCapture,
    compatibility,
    settings,
    sourcePriceRefresh,
  ];
};
