import type {
  MessageDefinition,
  MessageParams,
  MultiPluralDefinition,
  PluralDefinition,
} from "./contracts.js";

type PluralCategory = "zero" | "one" | "other";

const pluralCategory = (value: number): PluralCategory => {
  if (value === 0) return "zero";
  if (value === 1) return "one";
  return "other";
};

const isMultiPluralDefinition = (
  definition: PluralDefinition | MultiPluralDefinition,
): definition is MultiPluralDefinition => definition.selectors !== undefined;

const selectSinglePluralForm = (
  definition: PluralDefinition,
  params: MessageParams | undefined,
): string => {
  const count = params?.count;
  if (typeof count !== "number") return definition.forms.other;
  return definition.forms[pluralCategory(count)] ?? definition.forms.other;
};

const selectMultiPluralForm = (
  definition: MultiPluralDefinition,
  params: MessageParams | undefined,
): string => {
  const categories: PluralCategory[] = [];
  for (const selector of definition.selectors) {
    const value = params?.[selector];
    if (typeof value !== "number") return definition.forms.other;
    categories.push(pluralCategory(value));
  }
  return definition.forms[categories.join("|")] ?? definition.forms.other;
};

const interpolate = (
  template: string,
  params: MessageParams | undefined,
): string =>
  template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => {
    const value = params?.[name];
    return value === undefined ? placeholder : String(value);
  });

/** Formats a message definition against runtime parameters. */
export const formatMessage = (
  definition: MessageDefinition,
  params?: MessageParams,
): string => {
  const template =
    typeof definition === "string"
      ? definition
      : isMultiPluralDefinition(definition)
        ? selectMultiPluralForm(definition, params)
        : selectSinglePluralForm(definition, params);

  return interpolate(template, params);
};
