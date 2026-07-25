import type {
  MessageDefinition,
  MessageParams,
  PluralDefinition,
} from "./contracts.js";

const isPluralDefinition = (
  definition: MessageDefinition,
): definition is PluralDefinition => typeof definition !== "string";

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
  const template = isPluralDefinition(definition)
    ? selectForm(definition, params)
    : definition;
  return interpolate(template, params);
};
