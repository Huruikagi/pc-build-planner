/**
 * Runtime-composition seam owned by project-context.
 * 通常 consumer は `public.ts` を使い続ける。shell 側の composition owner だけが
 * この module から production adapter を組み立てる（design: File Structure Plan、
 * ProjectContextBoundaryGate）。
 */

import { createProjectCatalogProjection } from "./catalog.js";
import type {
  ProjectCatalogSource,
  ProjectPreferencePort,
} from "./contracts.js";
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
  readonly api: ProjectContextPublicApi;
  readonly presentation: ProjectContextPresentationContribution;
  initialize(): ReturnType<ProjectContextService["initialize"]>;
}

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
