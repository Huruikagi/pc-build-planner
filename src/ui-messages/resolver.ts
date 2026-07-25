import type { MessageCatalogShape, MessageKey } from "./catalog/index.js";
import { MESSAGES } from "./catalog/index.js";
import type {
  DefinitionAt,
  MessageDescriptor,
  MessageParams,
  MessageParamValue,
  PlaceholderNames,
  PluralDefinition,
} from "./contracts.js";
import { formatMessage } from "./format.js";

/** Placeholder names required by a message definition, across every plural form. */
type PlaceholdersOfDefinition<D> = D extends string
  ? PlaceholderNames<D>
  : D extends PluralDefinition
    ?
        | PlaceholderNames<D["forms"]["other"]>
        | PlaceholderNames<Exclude<D["forms"]["one"], undefined>>
        | PlaceholderNames<Exclude<D["forms"]["zero"], undefined>>
    : never;

/**
 * The `(key, ...params)` call shape for key `K` in `Catalog`: no arguments when the
 * message has no placeholders, otherwise a single required params object. Plural
 * messages always require `count`, even when no form text references it.
 */
export type ParamsArgsFor<Catalog, K extends string> =
  DefinitionAt<Catalog, K> extends PluralDefinition
    ? [
        params: Readonly<
          Record<
            PlaceholdersOfDefinition<DefinitionAt<Catalog, K>>,
            MessageParamValue
          >
        > & { readonly count: number },
      ]
    : [PlaceholdersOfDefinition<DefinitionAt<Catalog, K>>] extends [never]
      ? []
      : [
          params: Readonly<
            Record<
              PlaceholdersOfDefinition<DefinitionAt<Catalog, K>>,
              MessageParamValue
            >
          >,
        ];

type ParamsArgs<K extends MessageKey> = ParamsArgsFor<typeof MESSAGES, K>;

export interface MessageResolver {
  /** キーによる解決。パラメータの過不足はコンパイルエラーになる。 */
  <K extends MessageKey>(key: K, ...params: ParamsArgs<K>): string;
  /** 記述子による解決。ロジック層が渡した値を表示層が解く経路。 */
  readonly resolveDescriptor: (descriptor: MessageDescriptor) => string;
}

/** Creates a resolver closed over a flat, dot-keyed catalog. */
export const createMessageResolver = (
  catalog: MessageCatalogShape,
): MessageResolver => {
  const flat = catalog as Readonly<Record<string, string | PluralDefinition>>;

  const resolve = (key: string, params?: MessageParams): string => {
    const definition = flat[key];
    if (definition === undefined) return key;
    return formatMessage(definition, params);
  };

  const callable = (key: string, ...params: readonly unknown[]): string =>
    resolve(key, params[0] as MessageParams | undefined);

  return Object.assign(callable, {
    resolveDescriptor: (descriptor: MessageDescriptor): string =>
      resolve(descriptor.key, descriptor.params),
  }) as unknown as MessageResolver;
};

/** The only type-safe way to build a `MessageDescriptor`. Parameter checking happens here. */
export const message = <K extends MessageKey>(
  key: K,
  ...params: ParamsArgs<K>
): MessageDescriptor => {
  const value = params[0] as MessageParams | undefined;
  return (
    value === undefined ? { key } : { key, params: value }
  ) as MessageDescriptor;
};

/** Flattens the nested catalog namespace into the dot-keyed shape `createMessageResolver` expects. */
export const flattenNamespace = (
  namespace: Readonly<Record<string, unknown>>,
  prefix = "",
): Readonly<Record<string, string | PluralDefinition>> => {
  const out: Record<string, string | PluralDefinition> = {};
  for (const [key, value] of Object.entries(namespace)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out[path] = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      "forms" in value
    ) {
      out[path] = value as PluralDefinition;
    } else {
      Object.assign(
        out,
        flattenNamespace(value as Readonly<Record<string, unknown>>, path),
      );
    }
  }
  return out;
};

/** The default resolver, closed over the bundled Japanese catalog. */
export const defaultMessageResolver: MessageResolver = createMessageResolver(
  flattenNamespace(MESSAGES) as unknown as MessageCatalogShape,
);
