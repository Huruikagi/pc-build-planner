/**
 * Runtime-composition seam owned by project-context.
 * 通常 consumer は `public.ts` を使い続ける。shell 側の composition owner だけが
 * この module から production adapter を組み立てる（design: File Structure Plan、
 * ProjectContextBoundaryGate）。
 */

import type { ProjectId, RequestId, UtcTimestamp } from "../domain/public.js";
import { createProjectCatalogProjection } from "./catalog.js";
import type {
  ProjectCatalogSource,
  ProjectPreferencePort,
} from "./contracts.js";
import {
  createFoundationProjectLifecycleDataPort,
  type ProjectLifecycleFoundationPort,
} from "./lifecycle-data-port.js";
import {
  createProjectLifecyclePresentationContribution,
  type ProjectLifecyclePresentationContribution,
  type ProjectLifecyclePresentationMessageResolver,
} from "./lifecycle-presentation.js";
import { createProjectLifecycleService } from "./lifecycle-service.js";
import { createProjectLifecycleState } from "./lifecycle-state.js";
import {
  createChromeProjectPreferencePortIfAvailable,
  createInMemoryProjectPreferencePort,
} from "./preference-store.js";
import {
  createProjectContextPresentationContribution,
  type ProjectContextPresentationContribution,
} from "./presentation-contribution.js";
import {
  createProjectContextPublicApi,
  type ProjectContextCorePublicApi,
  type ProjectContextPublicApi,
} from "./public.js";
import {
  createProjectContextService,
  type ProjectContextService,
} from "./service.js";

export type {
  ProjectPreferenceError,
  ProjectPreferencePort,
  ProjectPreferenceRead,
} from "./contracts.js";
export {
  createChromeProjectPreferencePortIfAvailable,
  createInMemoryProjectPreferencePort,
} from "./preference-store.js";

/**
 * production の preference adapter を一つの seam で選ぶ（要件 8.1）。
 * Chrome storage が使えない実行環境（DOM test など）では決定的な in-memory port へ
 * fallback し、呼び出し側が環境判定を持たないようにする。
 */
export const createProductionProjectPreferencePort =
  (): ProjectPreferencePort =>
    createChromeProjectPreferencePortIfAvailable() ??
    createInMemoryProjectPreferencePort();

export interface ProductionProjectContext {
  readonly api: ProjectContextCorePublicApi;
  readonly presentation: ProjectContextPresentationContribution;
  initialize(): ReturnType<ProjectContextService["initialize"]>;
}

export interface ProjectContextRuntimeDependencies {
  readonly catalog: ProjectCatalogSource;
  readonly preference: ProjectPreferencePort;
  readonly foundation: ProjectLifecycleFoundationPort;
  readonly messages: ProjectLifecyclePresentationMessageResolver;
  readonly createProjectId: () => ProjectId;
  readonly createRequestId: () => RequestId;
  readonly now: () => UtcTimestamp;
}

export interface ProjectContextRuntime {
  readonly api: ProjectContextPublicApi;
  readonly presentation: ProjectContextPresentationContribution;
  readonly lifecyclePresentation: ProjectLifecyclePresentationContribution;
  initialize(): ReturnType<ProjectContextService["initialize"]>;
}

/** 注入済み adapter だけを組み立て、instance の生成・保持は呼び出し側へ残す。 */
export const createProjectContextRuntime = (
  dependencies: ProjectContextRuntimeDependencies,
): ProjectContextRuntime => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(dependencies.catalog),
    preference: dependencies.preference,
  });
  const lifecycleService = createProjectLifecycleService({
    data: createFoundationProjectLifecycleDataPort(
      dependencies.foundation,
      dependencies.createRequestId,
    ),
    context: { refresh: () => service.refresh() },
    createProjectId: dependencies.createProjectId,
    now: dependencies.now,
  });
  const api = createProjectContextPublicApi({
    service,
    lifecycle: lifecycleService,
  });
  const state = createProjectLifecycleState({
    read: api.read,
    lifecycle: lifecycleService,
  });
  return Object.freeze({
    api,
    presentation: createProjectContextPresentationContribution({
      read: api.read,
      commands: api.commands,
    }),
    lifecyclePresentation: createProjectLifecyclePresentationContribution({
      read: api.read,
      lifecycle: lifecycleService,
      state,
      messages: dependencies.messages,
    }),
    initialize: () => service.initialize(),
  });
};

/** shell composition専用のproduction project-context assembly。 */
export const createProductionProjectContext = (
  catalog: ProjectCatalogSource,
): ProductionProjectContext => {
  const service = createProjectContextService({
    catalog: createProjectCatalogProjection(catalog),
    preference: createProductionProjectPreferencePort(),
  });
  const api = createProjectContextPublicApi({ service });
  return Object.freeze({
    api,
    presentation: createProjectContextPresentationContribution({
      read: api.read,
      commands: api.commands,
    }),
    initialize: () => service.initialize(),
  });
};
