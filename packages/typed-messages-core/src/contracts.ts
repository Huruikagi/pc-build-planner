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
