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
import { createProductCapturePublicApi } from "../features/product-capture/public.js";
import {
  createSettingsContribution,
  type SettingsContribution,
} from "../features/settings/feature-contribution.js";
import type { FeatureCompositionContext } from "./feature-contribution-catalog.js";

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
];

/** Real `chrome.tabs`/`chrome.scripting` handles, supplied by the runtime entrypoint. */
export interface SidePanelChromeApis {
  readonly tabs: ChromeTabsApi;
  readonly scripting: ChromeScriptingApi;
}

export interface SidePanelCandidateFactories {
  readonly createSourcePagePort?: (tabs?: TabsCreatePort) => SourcePagePort;
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
  chromeApis?: SidePanelChromeApis,
  factories: SidePanelCandidateFactories = {},
): SidePanelFeatureContributions => {
  const productCapturePublic = createProductCapturePublicApi();
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
  });
  const currentBuild = createCurrentBuildContribution(context, {
    candidates: candidateManagement.registration.publicApi.query,
  });
  const productCapture = createProductCaptureContribution(context, {
    runtime:
      chromeApis === undefined
        ? inertCaptureRuntimePort
        : createChromeCaptureRuntimePort(chromeApis),
    transientSurface: context.transientSurface ?? {
      isCurrent: () => false,
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
      data: context.fullDataPort,
    }),
  });
  return [
    candidateManagement,
    currentBuild,
    productCapture,
    compatibility,
    settings,
  ];
};
