import type {
  DefinitionAt,
  MessageDefinition,
  MessageKeyOf,
} from "./contracts.js";

export type CatalogParityIssue = Readonly<{
  code: "missing-key" | "excess-key" | "placeholder-mismatch";
  key: string;
}>;

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

type PlaceholderMismatchKeys<Source, Target> = {
  [Key in MessageKeyOf<Source> & MessageKeyOf<Target>]: [
    DefinitionPlaceholders<DefinitionAt<Source, Key>>,
  ] extends [DefinitionPlaceholders<DefinitionAt<Target, Key>>]
    ? [DefinitionPlaceholders<DefinitionAt<Target, Key>>] extends [
        DefinitionPlaceholders<DefinitionAt<Source, Key>>,
      ]
      ? never
      : Key
    : Key;
}[MessageKeyOf<Source> & MessageKeyOf<Target>];

/** Identifies only keys whose presence or placeholder sets differ. */
export type CatalogParityViolations<Source, Target> =
  | Exclude<MessageKeyOf<Source>, MessageKeyOf<Target>>
  | Exclude<MessageKeyOf<Target>, MessageKeyOf<Source>>
  | PlaceholderMismatchKeys<Source, Target>;

function placeholderNames(definition: MessageDefinition): ReadonlySet<string> {
  const names = new Set<string>();
  const texts =
    typeof definition === "string"
      ? [definition]
      : Object.values(definition.forms);

  for (const text of texts) {
    for (const match of text.matchAll(/\{([^{}]+)\}/g)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }

  return names;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

export function validateCatalogParity(
  source: Readonly<Record<string, MessageDefinition>>,
  target: Readonly<Record<string, MessageDefinition>>,
): readonly CatalogParityIssue[] {
  const issues: CatalogParityIssue[] = [];

  for (const [key, sourceDefinition] of Object.entries(source)) {
    const targetDefinition = target[key];
    if (targetDefinition === undefined) {
      issues.push({ code: "missing-key", key });
    } else if (
      !setsEqual(
        placeholderNames(sourceDefinition),
        placeholderNames(targetDefinition),
      )
    ) {
      issues.push({ code: "placeholder-mismatch", key });
    }
  }

  for (const key of Object.keys(target)) {
    if (source[key] === undefined) {
      issues.push({ code: "excess-key", key });
    }
  }

  return issues;
}
