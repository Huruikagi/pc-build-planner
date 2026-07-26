/**
 * `ui-messages` の唯一の公開入口。カタログ定数（`MESSAGES`）そのものは公開しない。
 * view からのカタログ直接参照は `useMessages()` を唯一の経路とする規約を、
 * この公開面が担保する。
 */

export type { MessageCatalogShape, MessageKey } from "./catalog/index.js";
export type { MessageDescriptor, MessageParams } from "./contracts.js";
export type { SupportedLanguage } from "./languages.js";
export {
  FALLBACK_LANGUAGE,
  languageEndonym,
  resolverFor,
  SOURCE_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from "./languages.js";
export { MessageProvider, useMessages } from "./message-context.js";
export type { MessageResolver } from "./resolver.js";
export {
  createMessageResolver,
  defaultMessageResolver,
  message,
} from "./resolver.js";
