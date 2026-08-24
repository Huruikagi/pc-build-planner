/**
 * ブラウザで直接開くための開発ハーネス。
 *
 * **隔離したコンポーネントではなく、実アプリの composition をそのまま起動する。**
 * 差し替えるのは保存先 (メモリ) と文言解決 (`chrome.i18n` の代わりにビルド時に
 * 埋め込んだ ja カタログ) だけ。配線が繋がっていなければここでも壊れる。
 *
 * v0.4.0 では、コンポーネントを直接マウントする合成ハーネスの上でテストが
 * 緑のまま、本番の配線が繋がっていない状態が spec 数本ぶん進行した
 * (`docs/reverse/changes.md` C-5)。同じ構造を作らないこと。
 * 検証の正は常に実拡張を通す E2E。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import jaMessages from "../_locales/ja/messages.json" with { type: "json" };
import { App } from "./app.js";
import { installMessageFallback, type MessageCatalog } from "./i18n.js";
import { SCHEMA_VERSION } from "./model.js";
import { createMemoryStorageDriver, Store } from "./storage.js";

installMessageFallback(jaMessages as MessageCatalog);

/** 架空データのみ。実在の商品・サイトを使わない。 */
const seed = {
  schemaVersion: SCHEMA_VERSION,
  revision: 0,
  selectedProjectId: "seed-main",
  projects: [
    {
      id: "seed-main",
      name: "メインPC 2026",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "seed-itx",
      name: "サブ機 mini-ITX",
      createdAt: "2026-08-10T00:00:00.000Z",
    },
  ],
} as const;

const container = document.getElementById("application-shell");
if (container === null) throw new Error("dev host element is unavailable");

createRoot(container).render(
  <StrictMode>
    <App
      store={
        new Store(
          createMemoryStorageDriver({ ...seed, projects: [...seed.projects] }),
        )
      }
    />
  </StrictMode>,
);
