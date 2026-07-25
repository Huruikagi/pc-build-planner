/** A message value that varies by quantity. Values are language-specific; the shape is not. */
export interface PluralDefinition {
  readonly forms: {
    readonly other: string;
    readonly one?: string;
    readonly zero?: string;
  };
}

export type MessageDefinition = string | PluralDefinition;

export type MessageParamValue = string | number;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

/** A nested namespace of messages; leaves are `MessageDefinition`. */
export interface MessageNamespace {
  readonly [segment: string]: MessageDefinition | MessageNamespace;
}

/** Extracts `{name}` placeholder names from a literal message string. */
export type PlaceholderNames<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

/** Derives the dot-joined key union from a catalog's nested namespace shape. */
export type MessageKeyOf<T> = {
  [K in keyof T & string]: T[K] extends MessageDefinition
    ? K
    : `${K}.${MessageKeyOf<T[K]>}`;
}[keyof T & string];

/** Resolves the `MessageDefinition` at a dot-joined key path within a catalog. */
export type DefinitionAt<
  T,
  K extends string,
> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? DefinitionAt<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

declare const MESSAGE_DESCRIPTOR_BRAND: unique symbol;

/** The only value logic layers pass to the display layer for a message. */
export interface MessageDescriptor {
  readonly key: string;
  readonly params?: MessageParams;
  readonly [MESSAGE_DESCRIPTOR_BRAND]: true;
}
