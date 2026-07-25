import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createElement } from "react";

import type { MessageResolver } from "../../src/ui-messages/public.js";
import { MessageProvider } from "../../src/ui-messages/public.js";

/** Renders `ui` inside a `MessageProvider`, so a test can override the resolver. */
export function renderWithMessages(
  ui: ReactElement,
  options?: { readonly resolver?: MessageResolver },
) {
  const props =
    options?.resolver === undefined
      ? { children: ui }
      : { resolver: options.resolver, children: ui };
  return render(createElement(MessageProvider, props));
}
