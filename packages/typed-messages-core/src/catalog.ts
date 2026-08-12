import type {
  DefinitionAt,
  MessageDefinition,
  MessageKeyOf,
  MessageNamespace,
} from "./contracts.js";

/** The dot-keyed runtime representation of a nested catalog. */
export type FlatCatalog<Catalog> = {
  readonly [Key in MessageKeyOf<Catalog>]: DefinitionAt<Catalog, Key>;
};

function isMessageDefinition(
  value: MessageDefinition | MessageNamespace,
): value is MessageDefinition {
  if (typeof value === "string") {
    return true;
  }

  if (!("forms" in value)) {
    return false;
  }

  const forms: unknown = value.forms;
  return (
    typeof forms === "object" &&
    forms !== null &&
    "other" in forms &&
    typeof forms.other === "string"
  );
}

/** Converts nested namespaces to their shared dot-key representation. */
export function flattenCatalog<const Catalog extends MessageNamespace>(
  catalog: Catalog,
): FlatCatalog<Catalog> {
  const flattened: Record<string, MessageDefinition> = {};

  const visit = (namespace: MessageNamespace, prefix: string): void => {
    for (const [segment, value] of Object.entries(namespace)) {
      const key = prefix === "" ? segment : `${prefix}.${segment}`;

      if (isMessageDefinition(value)) {
        flattened[key] = value;
      } else {
        visit(value, key);
      }
    }
  };

  visit(catalog, "");
  return flattened as FlatCatalog<Catalog>;
}
