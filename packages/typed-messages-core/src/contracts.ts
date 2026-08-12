/** A message selected by the implicit numeric `count` parameter. */
export interface PluralDefinition {
  readonly selectors?: never;
  readonly forms: {
    readonly zero?: string;
    readonly one?: string;
    readonly other: string;
  };
}

/** A message selected by one or more explicitly named numeric parameters. */
export interface MultiPluralDefinition<
  Selectors extends readonly [string, ...string[]] = readonly [
    string,
    ...string[],
  ],
> {
  readonly selectors: Selectors;
  readonly forms: {
    readonly other: string;
    readonly [combination: string]: string;
  };
}

/** The three supported catalog leaf shapes. */
export type MessageDefinition =
  | string
  | PluralDefinition
  | MultiPluralDefinition;

/** A catalog namespace whose nested branches terminate in message definitions. */
export interface MessageNamespace {
  readonly [segment: string]: MessageDefinition | MessageNamespace;
}

/** Derives every dot-joined leaf key from a nested catalog literal. */
export type MessageKeyOf<Catalog> = {
  [Key in keyof Catalog & string]: Catalog[Key] extends MessageDefinition
    ? Key
    : Catalog[Key] extends object
      ? `${Key}.${MessageKeyOf<Catalog[Key]>}`
      : never;
}[keyof Catalog & string];

/** Looks up the message definition at a dot-joined catalog key. */
export type DefinitionAt<
  Catalog,
  Key extends string,
> = Key extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Catalog
    ? DefinitionAt<Catalog[Head], Tail>
    : never
  : Key extends keyof Catalog
    ? Catalog[Key] extends MessageDefinition
      ? Catalog[Key]
      : never
    : never;

/** JSON-safe values accepted for message interpolation. */
export type MessageParam = string | number;

/** The runtime parameter object shared by formatters and descriptors. */
export type MessageParams = Readonly<Record<string, MessageParam>>;

type PlaceholderNames<Text> = Text extends string
  ? Text extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never
  : never;

type DefinitionPlaceholders<Definition> = Definition extends string
  ? PlaceholderNames<Definition>
  : Definition extends { readonly forms: infer Forms }
    ? PlaceholderNames<Forms[keyof Forms]>
    : never;

type SelectorNames<Definition> =
  Definition extends MultiPluralDefinition<infer Selectors>
    ? Selectors[number]
    : Definition extends PluralDefinition
      ? "count"
      : never;

type ParamsForDefinition<Definition> = Readonly<{
  [Name in DefinitionPlaceholders<Definition> | SelectorNames<Definition>]:
    Name extends SelectorNames<Definition> ? number : MessageParam;
}>;

/** The parameter object derived for one catalog key. */
export type ParamsForKey<
  Catalog,
  Key extends MessageKeyOf<Catalog>,
> = ParamsForDefinition<DefinitionAt<Catalog, Key>>;

type ExactParams<Expected, Actual> = Exclude<keyof Actual, keyof Expected> extends never
  ? Actual
  : Actual & Readonly<Record<Exclude<keyof Actual, keyof Expected>, never>>;

/** Derives the optional or required resolver argument tuple for a catalog key. */
export type ParamsArgsFor<
  Catalog,
  Key extends MessageKeyOf<Catalog>,
  Params extends ParamsForKey<Catalog, Key> = ParamsForKey<Catalog, Key>,
> = DefinitionPlaceholders<DefinitionAt<Catalog, Key>> extends never
  ? SelectorNames<DefinitionAt<Catalog, Key>> extends never
    ? []
    : [params: ExactParams<ParamsForKey<Catalog, Key>, Params>]
  : [params: ExactParams<ParamsForKey<Catalog, Key>, Params>];

declare const MESSAGE_DESCRIPTOR_BRAND: unique symbol;

/** A catalog-bound message intent whose runtime data is only key and params. */
export interface MessageDescriptor<Catalog> {
  readonly key: MessageKeyOf<Catalog>;
  readonly params?: MessageParams;
  readonly [MESSAGE_DESCRIPTOR_BRAND]: Catalog;
}
