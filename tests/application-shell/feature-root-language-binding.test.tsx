import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { LanguageProvider, useLanguage } from "../../src/ui-language/public.js";
import {
  resetUiLanguageForTest,
  uiLanguageStore,
} from "../../src/ui-language/store.js";
import { useMessages } from "../../src/ui-messages/public.js";

afterEach(() => {
  resetUiLanguageForTest();
});

const FEATURE_ROOT_FILES = [
  "src/features/candidate-management/react-root.tsx",
  "src/features/product-capture/react-root.tsx",
  "src/features/compatibility/react-root.tsx",
  "src/features/backup-restore/react-root.tsx",
];

test("4件のreact-root.tsxはui-language/public.jsのLanguageProviderだけを設置する", async () => {
  for (const path of FEATURE_ROOT_FILES) {
    const source = await readFile(path, "utf8");
    assert.match(
      source,
      /from ["']\.\.\/\.\.\/ui-language\/public\.js["']/,
      path,
    );
    assert.doesNotMatch(source, /MessageProvider/, path);
  }
});

test("current-build/registration.tsはui-language/public.jsのLanguageProviderだけを設置する", async () => {
  const source = await readFile(
    "src/features/current-build/registration.ts",
    "utf8",
  );
  assert.match(source, /from ["']\.\.\/\.\.\/ui-language\/public\.js["']/);
  assert.doesNotMatch(source, /MessageProvider/);
});

/** Mirrors the exact composition every mount* function uses: LanguageProvider around a view. */
function FeatureProbe({ label }: { readonly label: string }) {
  const messages = useMessages();
  const { language } = useLanguage();
  return (
    <p data-region={`probe-${label}`}>
      {label}:{language}:{messages("common.save")}
    </p>
  );
}

test("言語を切り替えると独立した複数のfeature rootが同時に追随する", async () => {
  const labels = ["candidate", "capture", "compatibility", "backup", "build"];
  const mounted: Array<{
    readonly container: HTMLElement;
    readonly root: Root;
  }> = [];
  for (const label of labels) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(() => {
      root.render(
        <LanguageProvider>{<FeatureProbe label={label} />}</LanguageProvider>,
      );
    });
    mounted.push({ container, root });
  }

  for (const { container } of mounted) {
    assert.match(container.textContent ?? "", /:ja:/);
  }

  // Switching the shared singleton store, exactly as LanguageSelectControl does.
  await act(() => {
    uiLanguageStore.setLanguage("en");
  });

  for (const { container } of mounted) {
    assert.match(
      container.textContent ?? "",
      /:en:/,
      container.textContent ?? "",
    );
  }

  for (const { container, root } of mounted) {
    await act(() => root.unmount());
    container.remove();
  }
});
