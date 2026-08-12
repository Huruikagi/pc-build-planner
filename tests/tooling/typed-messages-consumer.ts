import {
  createMessageDescriptorFactory,
  createMessageResolver,
  flattenCatalog,
  validateCatalogParity,
} from "@pc-build-planner/typed-messages-core";

const catalog = {
  fixture: {
    greeting: "Hello, {name}",
    items: { forms: { one: "{count} item", other: "{count} items" } },
  },
} as const;

const resolver = createMessageResolver(catalog);
const descriptor = createMessageDescriptorFactory<typeof catalog>();

export const resolvedSyntheticMessage = resolver("fixture.greeting", {
  name: "consumer",
});
export const resolvedSyntheticDescriptor = resolver.resolveDescriptor(
  descriptor("fixture.items", { count: 2 }),
);
export const syntheticCatalogParity = validateCatalogParity(
  flattenCatalog(catalog),
  flattenCatalog(catalog),
);
