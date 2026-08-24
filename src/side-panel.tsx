/**
 * 拡張として動くときのエントリ。ここが本番の composition root。
 *
 * dev harness (`src/dev.tsx`) と同じ `App` を同じ形でマウントする。
 * 片方だけで動く構造を作らないこと。v0.4.0 では合成ハーネス側が緑のまま
 * 本番の配線が繋がっていない状態が発生した (`docs/reverse/changes.md` C-5)。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { chromeCaptureDriver } from "./capture/protocol.js";
import { chromeStorageDriver, Store } from "./storage.js";

const container = document.getElementById("application-shell");
if (container === null)
  throw new Error("side panel host element is unavailable");

createRoot(container).render(
  <StrictMode>
    <App capture={chromeCaptureDriver} store={new Store(chromeStorageDriver)} />
  </StrictMode>,
);
