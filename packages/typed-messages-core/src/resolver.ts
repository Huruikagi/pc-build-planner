import type {
  MessageDefinition,
  MessageDescriptor,
  MessageKeyOf,
  MessageNamespace,
  MessageParams,
  ParamsArgsFor,
} from "./contracts.js";
import { flattenCatalog } from "./catalog.js";
import { formatMessage } from "./format.js";

export interface MessageResolver<Catalog> {
  <Key extends MessageKeyOf<Catalog>>(
    key: Key,
    ...params: ParamsArgsFor<Catalog, Key>
  ): string;
  resolveDescriptor(descriptor: MessageDescriptor<Catalog>): string;
}

export function createMessageResolver<const Catalog extends MessageNamespace>(
  catalog: Catalog,
): MessageResolver<Catalog> {
  const flattened = flattenCatalog(catalog) as Readonly<
    Record<string, MessageDefinition>
  >;

  const resolveRuntime = (key: string, params?: MessageParams): string => {
    const definition = flattened[key];
    return definition === undefined ? key : formatMessage(definition, params);
  };

  const resolve = ((key: string, params?: MessageParams): string =>
    resolveRuntime(key, params)) as unknown as MessageResolver<Catalog>;
  resolve.resolveDescriptor = (descriptor) =>
    resolveRuntime(descriptor.key, descriptor.params);

  return resolve;
}
