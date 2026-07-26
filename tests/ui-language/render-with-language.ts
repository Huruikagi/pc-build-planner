import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createElement } from "react";

import type { LanguageStore } from "../../src/ui-language/contracts.js";
import { LanguageProvider } from "../../src/ui-language/react.js";

/** Renders `ui` inside a `LanguageProvider`, so a test can override the store. */
export function renderWithLanguage(
  ui: ReactElement,
  options?: { readonly store?: LanguageStore },
) {
  const props =
    options?.store === undefined
      ? { children: ui }
      : { store: options.store, children: ui };
  return render(createElement(LanguageProvider, props));
}
