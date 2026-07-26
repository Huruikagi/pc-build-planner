import type {
  SidePanelBootstrapError,
  SidePanelBootstrapOptions,
  SidePanelBootstrapResult,
} from "../application-shell/runtime-bootstrap.js";
import { createSidePanelBootstrap } from "../application-shell/runtime-bootstrap.js";
import type { Result } from "../domain/public.js";
import type { LanguagePlatform } from "../ui-language/contracts.js";
import { syncDocumentLanguage } from "../ui-language/document-language.js";
import { initializeUiLanguage } from "../ui-language/store.js";

export interface SidePanelLanguageBootstrapOptions<TRootApi extends object>
  extends SidePanelBootstrapOptions<TRootApi> {
  readonly languagePlatform: LanguagePlatform;
}

/**
 * 言語ランタイムの初期化と文書の言語同期を、シェル起動より前に完了させる。
 * `initializeUiLanguage`は常に`SupportedLanguage`へ解決するため（上流の
 * `LanguagePreferencePort`契約により例外を投げない）、この関数自体が
 * シェル起動を妨げることはない（2.1, 2.6, 5.1）。この関数自身は副作用を
 * 持たず、注入された`options`だけで動作するためテストしやすい。
 */
export async function startSidePanelWithLanguage<TRootApi extends object>(
  options: SidePanelLanguageBootstrapOptions<TRootApi>,
): Promise<
  Result<SidePanelBootstrapResult<TRootApi>, SidePanelBootstrapError>
> {
  await initializeUiLanguage(options.languagePlatform);
  syncDocumentLanguage(options.document);
  return createSidePanelBootstrap(options).start();
}
