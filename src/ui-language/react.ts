import type { ReactElement, ReactNode } from "react";
import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  MessageProvider,
  resolverFor,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from "../ui-messages/public.js";
import type { LanguageStore } from "./contracts.js";
import { uiLanguageStore } from "./store.js";

/** 表示言語の選択面。カタログそのものは露出しない。 */
export interface LanguageSelection {
  readonly language: SupportedLanguage;
  readonly available: readonly SupportedLanguage[];
  readonly setLanguage: (language: SupportedLanguage) => void;
}

/** `LanguageProvider` が張られている木の中でのみ、現在有効なストアを伝える。 */
const LanguageStoreContext = createContext<LanguageStore | undefined>(
  undefined,
);

/**
 * 言語ストアを購読し、対応するresolverを上流の`MessageProvider`へ供給する。
 * `MessageProvider` / `useMessages` のシグネチャは変更しない。言語の変更は
 * 再レンダーのみを引き起こし、root の生成・破棄を伴わない。これにより表示中の
 * 機能・選択・入力途中の内容・スクロール位置が保持される（1.3）。
 * テストのために`store`を差し替えられるが、既定は単一インスタンスとする。
 */
export function LanguageProvider({
  store = uiLanguageStore,
  children,
}: {
  readonly store?: LanguageStore;
  readonly children: ReactNode;
}): ReactElement {
  const language = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const messageProviderProps = { resolver: resolverFor(language), children };
  const contextProviderProps = {
    value: store,
    children: createElement(MessageProvider, messageProviderProps),
  };
  return createElement(LanguageStoreContext.Provider, contextProviderProps);
}

/**
 * 現在の言語・選択可能な言語の一覧・切り替え関数を返す。カタログそのものは
 * 露出しない。`LanguageProvider`の内側でのみ呼べる。
 */
export function useLanguage(): LanguageSelection {
  const store = useContext(LanguageStoreContext);
  if (store === undefined) {
    throw new Error("useLanguage must be called within a LanguageProvider");
  }
  const language = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    language,
    available: SUPPORTED_LANGUAGES,
    setLanguage: store.setLanguage,
  };
}
