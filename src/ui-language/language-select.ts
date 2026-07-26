import type { ChangeEvent, ReactElement } from "react";
import { createElement } from "react";
import type { SupportedLanguage } from "../ui-messages/public.js";
import { languageEndonym, useMessages } from "../ui-messages/public.js";
import { useLanguage } from "./react.js";

/**
 * 言語切り替え操作の振る舞いを所有する薄い表示adapter。状態を自前で持たず、
 * 選択肢は`useLanguage().available`から導出する（ハードコードしない、9.3）。
 * 表示は各言語の原語表記（`languageEndonym`）を用い、翻訳しない。
 */
export function LanguageSelectControl(): ReactElement {
  const messages = useMessages();
  const { language, available, setLanguage } = useLanguage();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setLanguage(event.target.value as SupportedLanguage);
  };
  const options = available.map((candidate) =>
    createElement(
      "option",
      { key: candidate, value: candidate },
      languageEndonym[candidate],
    ),
  );
  return createElement(
    "select",
    {
      "aria-label": messages("common.languageSelectLabel"),
      "data-region": "language-select",
      onChange,
      value: language,
    },
    options,
  );
}
