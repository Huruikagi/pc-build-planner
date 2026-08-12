import type {
  MessageDescriptor,
  MessageKeyOf,
  ParamsArgsFor,
  ParamsForKey,
} from "./contracts.js";

export interface MessageDescriptorFactory<Catalog> {
  <
    Key extends MessageKeyOf<Catalog>,
    const Params extends ParamsForKey<Catalog, Key> = ParamsForKey<Catalog, Key>,
  >(
    key: Key,
    ...params: ParamsArgsFor<Catalog, Key, Params>
  ): MessageDescriptor<Catalog>;
}

export function createMessageDescriptorFactory<
  Catalog,
>(): MessageDescriptorFactory<Catalog> {
  return <Key extends MessageKeyOf<Catalog>>(
    key: Key,
    ...params: ParamsArgsFor<Catalog, Key>
  ): MessageDescriptor<Catalog> =>
    (params.length === 0
      ? { key }
      : { key, params: params[0] }) as unknown as MessageDescriptor<Catalog>;
}
