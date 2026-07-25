import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cleanup, render } from "@testing-library/react";

import {
  createMessageResolver,
  useMessages,
} from "../../src/ui-messages/public.js";
import { renderWithMessages } from "./render-with-messages.js";

afterEach(cleanup);

function SaveLabel() {
  return <p>{useMessages()("common.save")}</p>;
}

test("Providerを張らなくても既定resolverで解決した文言を描画する", () => {
  const rendered = render(<SaveLabel />);
  assert.equal(rendered.container.textContent, "保存");
});

test("Providerでresolverを差し替えると差し替えた解決結果を描画する", () => {
  const overrideResolver = createMessageResolver({
    "common.save": "SAVE",
  } as never);
  const rendered = renderWithMessages(<SaveLabel />, {
    resolver: overrideResolver,
  });
  assert.equal(rendered.container.textContent, "SAVE");
});

test("Providerの有無で表示が変わらない", () => {
  const withoutProvider = render(<SaveLabel />);
  const withoutProviderText = withoutProvider.container.textContent;
  withoutProvider.unmount();

  const withProvider = renderWithMessages(<SaveLabel />);
  assert.equal(withProvider.container.textContent, withoutProviderText);
});
