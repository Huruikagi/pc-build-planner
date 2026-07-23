# テスト実装規約

戦略レベルの方針（何を・どの層で検証するか）は `tech.md` の「テストと品質」に従う。本書はその実装手段、すなわち**ランナー・ツール構成とテストコードの書き方**の判断を記録する。

## ランナーとツール構成

- テストランナーは **Node 標準テストランナー（`node:test`）** を単一の基盤とする。アサーションは `node:assert/strict`。
- DOM 環境は `global-jsdom` を `tests/setup-dom.ts` から `--import` で登録する。
- React component のテストには **testing-library** を使う。
  - `@testing-library/react`（`render` / `cleanup`）
  - `@testing-library/user-event`（操作の発火）
- 実行は `package.json` の `test` script に集約し、`--import ./tests/setup-dom.ts` と `--test-isolation=none` を前提にする。

### 入れないもの（意図的な非採用）

- **Vitest は導入しない**。本プロジェクトは Vite を使わず、`node:test` 基盤が確立済みのため、置き換える理由がない。testing-library はランナー非依存なので `node:test` の上にそのまま乗る。
- **`@testing-library/jest-dom` は導入しない**。Jest/Vitest の `expect` 拡張マッチャーであり、`node:assert` ベースと噛み合わない。DOM 検証は `container.textContent` への正規表現マッチや `querySelector` の存在チェックで表現する。

新しいテストツールを足すときは、この 2 つを外した理由（ランナー非依存か・`node:assert` と両立するか）を判断基準にする。

## DOM テストのハーネスパターン

feature-owned state を React 外に持つ設計（`tech.md` 参照）に合わせ、テストは「state を組み立て → `render` → user 操作 → DOM とコマンド列を検証」の順で書く。`renderView` のようなヘルパーに `user` / `query` / `text` を集約し、各テストの定型記述を減らす。

```tsx
async function renderView(harness: Harness) {
  await harness.state.load();
  const user = userEvent.setup();
  const view = render(<BuildView state={harness.state} />);
  const query = <E extends Element = HTMLElement>(selector: string): E => {
    const element = view.container.querySelector<E>(selector);
    assert.ok(element, `expected element for selector ${selector}`);
    return element;
  };
  return { ...view, user, query, text: () => view.container.textContent ?? "" };
}

afterEach(cleanup); // node:test の afterEach で後始末を一元化
```

参照実装: `tests/features/current-build/view.test.tsx`

### 書き方の約束

- **手動 `act` / `createRoot` / `dispatchEvent` を書かない**。`render` と `user-event` が `act` ラップと再レンダーの flush を内包するので、手動 `rerender()` も不要。
- 操作は user-event で表現する（`user.click` / `user.clear` / `user.type`）。`Object.getOwnPropertyDescriptor(...).set` で値を差し込む等の DOM 直叩きは避ける。
- id 指定など属性ベースで要素を取る場合は `data-*` を `querySelector` で引き、存在チェック（`assert.ok`）を通してから使う。`as HTMLButtonElement` の無検証キャストはしない。
- テキスト検証は `container.textContent` への正規表現マッチを既定とする。
- 未信頼文字列が安全な JSX child として描画され HTML 注入が起きないこと（`querySelector("img")` が `null` 等）を、外部文字列を扱う component では回帰対象にする。

## 環境設定の注意

- `tests/setup-dom.ts` の `IS_REACT_ACT_ENVIRONMENT` は **`writable: true`** で定義する。testing-library が `render` のたびにこのグローバルを再代入するため、read-only だと `TypeError` になる。

## テストデータ

- fixture・サンプルは架空の商品・HTML・データだけで構成する（実サイト由来を含めない。`tech.md` セキュリティ参照）。
- 候補やビルドの生成はファクトリ関数（例: `candidate()` / `project()`）に寄せ、意図が読める最小データにする。

---
_ツール個別の設定値ではなく、ツール選定とテストコードの書き方の判断を記録する。_
