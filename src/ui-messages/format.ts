import type {
  MessageDefinition,
  MessageParams,
  MultiPluralDefinition,
  PluralDefinition,
} from "./contracts.js";

type PluralCategory = "zero" | "one" | "other";

const isStructuredDefinition = (
  definition: MessageDefinition,
): definition is PluralDefinition | MultiPluralDefinition =>
  typeof definition !== "string";

const isMultiPluralDefinition = (
  definition: PluralDefinition | MultiPluralDefinition,
): definition is MultiPluralDefinition => definition.selectors !== undefined;

const pluralCategory = (count: number): PluralCategory => {
  if (count === 0) return "zero";
  if (count === 1) return "one";
  return "other";
};

const selectForm = (
  definition: PluralDefinition,
  params: MessageParams | undefined,
): string => {
  const count = params?.count;
  if (typeof count !== "number") return definition.forms.other;
  if (count === 0 && definition.forms.zero !== undefined)
    return definition.forms.zero;
  if (count === 1 && definition.forms.one !== undefined)
    return definition.forms.one;
  return definition.forms.other;
};

const selectMultiForm = (
  definition: MultiPluralDefinition,
  params: MessageParams | undefined,
): string => {
  const categories: PluralCategory[] = [];
  for (const selector of definition.selectors) {
    const count = params?.[selector];
    if (typeof count !== "number") return definition.forms.other;
    categories.push(pluralCategory(count));
  }
  return definition.forms[categories.join("|")] ?? definition.forms.other;
};

const interpolate = (
  template: string,
  params: MessageParams | undefined,
): string =>
  template.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const value = params?.[name];
    return value === undefined ? match : String(value);
  });

/** Formats a message definition against parameters. Never throws; returns `string` always. */
export const formatMessage = (
  definition: MessageDefinition,
  params?: MessageParams,
): string => {
  const template = isStructuredDefinition(definition)
    ? isMultiPluralDefinition(definition)
      ? selectMultiForm(definition, params)
      : selectForm(definition, params)
    : definition;
  return interpolate(template, params);
};
