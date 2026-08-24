import { defineConfig } from "@playwright/test";

/**
 * 実拡張を未パッケージで読み込んで動かす E2E だけを持つ。
 *
 * コンポーネントを実アプリの外でマウントする合成ハーネスは作らない
 * (`docs/reverse/changes.md` C-5)。v0.4.0 ではそれが緑のまま、出荷ビルドで
 * プロジェクトを1つも作れない状態が進行した。ここが検証の正。
 */
export default defineConfig({
  testDir: "e2e",
  /** 拡張は永続コンテキスト単位なので、並列度を上げても取り合いにならない。 */
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: process.env.CI !== undefined ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { trace: "retain-on-failure" },
});
