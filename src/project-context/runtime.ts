/**
 * Runtime-composition seam owned by project-context.
 * 通常 consumer は `public.ts` を使い続ける。shell 側の composition owner だけが
 * この module から production adapter を組み立てる（design: File Structure Plan、
 * ProjectContextBoundaryGate）。
 */
import type { ProjectPreferencePort } from "./contracts.js";
import {
  createChromeProjectPreferencePortIfAvailable,
  createInMemoryProjectPreferencePort,
} from "./preference-store.js";

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
