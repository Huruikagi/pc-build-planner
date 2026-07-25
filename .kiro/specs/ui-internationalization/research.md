# Research Log — ui-internationalization

## Discovery Scope

Extension discovery（light）。既存アーキテクチャへの追加であり、新規の外部サービス連携も新規依存パッケージも持たない。調査対象は次の4点に絞った。

1. 上流 spec `ui-message-catalog` が確定させたカタログ契約と、そこへ言語次元を足す際の接合面
2. 表示言語設定の保存先の選択肢と、`tech.md` の「単一 write authority」規約との関係
3. `manifest.json` / `_locales/` / ビルド・パッケージ経路と、既存の機械検査への影響
4. 英語UIを E2E で検証する手段と、ブラウザUI言語への依存を持ち込まない方法

## 調査記録

### 1. 上流カタログ契約（`.kiro/specs/ui-message-catalog/design.md`）

- `MessageProvider` は「後続 spec の言語切り替えの唯一の差し替え点」と明記されている。Provider は React root ごとに張る規約であり、**`FeatureMountContext` 経由での供給は禁止**されている。
- `MessageCatalogShape` は「キー集合を平坦化した Record」であり、「後続 spec が `en` を追加する際にキー不足を型検査で検出させるための接合面」として設計されている。
- `PluralDefinition` は `forms.other / one? / zero?` を持ち、`count` パラメータでフォームを選ぶ。日本語カタログではこの分岐を一度も通らず、単体テストで挙動が固定されている。
- カタログは名前空間ごとに1ファイル、`catalog/index.ts` だけが集約する。
- **含意**: 言語次元の追加は「`catalog/` を `catalog/ja/` と `catalog/en/` の2系統へ分け、集約点を言語レジストリへ拡張する」形が最小の歪みで収まる。`MessageProvider` / `useMessages` / `MessageDescriptor` の公開シグネチャは変更しない。

### 2. 表示言語の保存先（`src/persistence/`、`.kiro/specs/backup-restore/`、`tech.md`）

- `src/persistence/chrome-storage-adapter.ts` は `chrome.storage.local` の **単一キー `localDataRoot` だけ**を読み書きする。`getBytesInUse(STORAGE_KEY)` も同キーに閉じている。
- `write-authority.ts` / `root-transaction-runner.ts` / `replacement.ts` が governing しているのは `LocalDataRoot`（`schemaVersion` 付きの版管理ルート）であり、write authority の対象は**ドメインデータのルート**である。
- `src/features/backup-restore/exchange.ts` は `LocalDataRoot` の内容だけを交換形式へ写像する。ルート外のキーは交換形式に現れない。
- `restrictToTrustedContexts()` は `chrome.storage.local` の **storage area 全体**に対する access level 設定であり、キー単位ではない。したがって別キーを使っても content script からの到達可能性は変わらない。
- **含意**: 表示言語をルートへ入れると、(a) バージョン付き交換形式へ混入して他端末のバックアップ復元が UI 言語を書き換える、(b) 保守 fencing 中に言語を変更できなくなる、(c) 容量監視の前提（ルート単独計測）が変わる、という3つの実害が出る。ルート外の専用キーが正しい。
- **非違反性の担保**: 「単一 write authority」の対象は `localDataRoot` であるという解釈を、口約束ではなく機械検査へ落とす（`chrome.storage` への到達点をアダプタ2箇所に限定する検査）。

### 3. manifest / `_locales/` / ビルド経路

- 現状 `manifest.json` に `description` は存在せず、`default_locale` も未指定。`_locales/` は存在しない。
- `scripts/build.mjs` は `manifest.json` と `side-panel.html` を個別に `copyFile` している。ディレクトリの再帰コピーは行っていないため、`_locales/` は**明示的に足さない限り配布物へ入らない**。
- `scripts/package.mjs` は `dist` を `cp -r` 相当でステージングし、basename が `.` で始まるものだけ除外する。`_locales` は `_` 始まりなので除外されない。**build 側の対応だけで足りる**。
- `scripts/validate-artifacts.mjs` の `validateManifest` は現在 `name` / `description` / `default_locale` を検査していない。JSON ファイルはコード検査の対象外（`.js` / `.html` のみ）。
- `tests/runtime/manifest.test.ts` は `assert.deepEqual(manifest, validManifest)` による**完全一致**を課している。`default_locale` / `__MSG_*` の追加は必ずこのテストを落とす。
- `tests/tooling/package.test.ts` の `writeValidBuildOutput` は最小の配布物を合成しており、`validateArtifactDirectory` を強化すると同時に更新が必要。
- `scripts/validate-fixture-assets.mjs` は `dist` を走査し `non-synthetic-url` を検出する。`_locales/*/messages.json` に URL を書かないこと。

### 4. E2E での英語UI検証

- `e2e/extension-fixture.ts` は `launchPersistentContext` に `--disable-extensions-except` / `--load-extension` のみを渡しており、`--lang` も `locale` も指定していない。
- Chromium の `--lang` は Windows のみ有効、Linux は `LANGUAGE` / `LC_*` / `LANG`、macOS は `AppleLanguages` 優先。Playwright の `use: { locale }` は CDP の `Emulation.setLocaleOverride` であり `chrome.i18n` に届かない。CI は Linux 前提。
- **含意**: E2E は言語切り替えUIの操作だけで英語表示を検証する。`chrome.i18n.getUILanguage()` を読む初期値決定ロジックの検証は、純関数の単体テストへ寄せる（実ブラウザ起動を伴わない）。
- `launchPersistentContext` はプロファイルを跨いで保持するため、同一 context 内でサイドパネルを開き直せば永続化の検証も E2E で行える。

## アーキテクチャパターンの評価

| 案 | 内容 | 判断 |
|---|---|---|
| A. 自前カタログ + アプリ内状態 | 言語は単なるアプリ状態。Provider の resolver を差し替える | **採用**。上流が差し替え点を用意済み。切り替えUIとE2Eが素直に成立する |
| B. `chrome.i18n` を表示文言にも使う | 追加コードほぼゼロ | 却下。アプリ内で言語を切り替える手段が仕様上存在しない。E2E が OS 依存になる |
| C. i18next / react-i18next | 実績ある実装 | 却下。2言語・サイドパネル1枚に対し約22KB gz は過剰。5言語以上で再検討 |
| D. 言語状態を `FeatureMountContext` で注入 | shell が feature へ配る | 却下。上流設計が明示的に禁止している。mount/unmount 契約を汚す |
| E. 言語状態を React Context 単独で持つ | 素直 | 却下。React root が shell1 + feature5 の計6本あり、単一 Context では共有できない |

## 設計判断

### D-1. 言語状態は React 外のモジュール単一ストアに置く

React root が6本に分かれているため、Context だけでは状態を共有できない。`testing.md` が既定とする「feature-owned state を React 外に持つ」パターンと一致するため、`useSyncExternalStore` で各 root が同一ストアを購読する。Provider は root ごとに張るという上流規約をそのまま守れる。

### D-2. 表示言語は `chrome.storage.local` のルート外専用キーへ保存する

理由は上記「調査記録 2」のとおり。write authority の対象は `LocalDataRoot` であり、UI 設定はドメインデータではない。ルートへ入れた場合の実害（交換形式への混入・保守中の変更不可・容量監視前提の変化）が具体的であり、外へ出す判断の根拠になる。非違反性は機械検査で担保する。

### D-3. キー集合の一致は型で、パラメータ名の一致も型で保証する

キー集合は `Record<MessageKey, ...>` の網羅性（欠落）と `satisfies` の余剰プロパティ検査（過剰）で双方向に塞ぐ。プレースホルダ名は `PlaceholderNames<S>` が**union** を返すため、`[A] extends [B] ? [B] extends [A] ? ...` の双方向条件型で順序非依存に比較できる。実行時テストではなくコンパイル時に落とせる。

### D-4. `Intl.PluralRules` は導入しない

上流 `formatMessage` の `one` / `other` 選択（`count === 1` で `one`）は英語の複数形規則と厳密に一致し、日本語には複数形が無い。2言語の範囲で `Intl.PluralRules` は純粋な追加コストである。3言語目の追加時に再検討する旨をカタログのコメントへ残す。

### D-5. 複数件数を含む文は複数形分岐で解かない

`復元が完了しました（プロジェクト{n}件、候補{n}件、現在構成{n}件）` は3つの独立した件数を持ち、単一の `count` によるフォーム選択では表現できない。断片連結は上流が禁止している。英語値は「ラベル + 件数」の並置形（`Projects: {n}, candidates: {n}, current builds: {n}`）とし、数の一致を要求しない文型で解く。単一件数のメッセージには従来どおり `PluralDefinition` を使う。

### D-6. `side-panel.html` から `lang` 属性を取り除く

固定値を残すと「静的な既定言語」という誤った事実が生まれ、要件 5.3 に反する。属性を持たない状態で出荷し、bootstrap が最初の描画前に同期的に設定する（`chrome.i18n.getUILanguage()` は同期 API）。「`<html>` に `lang` がハードコードされていないこと」を既存の HTML 検査テストへ追加し、退行を機械的に防ぐ。

### D-7. 言語切り替えUIの所有権を「振る舞い」と「配置」に分ける

コントロールの振る舞い（選択肢の列挙・現在値の提示・切り替えの発火）は言語境界が所有し、画面上のどこへ置くかは `application-shell` が所有する。これにより shell は言語の意味を知らずに配置だけを決められ、`FeatureMountContext` にも mount/unmount 契約にも触れない。

## 統合レンズの適用結果

- **一般化**: 「表示言語」と「文書の言語属性」と「翻訳対象外ロケールデータ」は一見別問題だが、いずれも「対応言語集合 `SUPPORTED_LANGUAGES` を単一の定義から導く」という共通の骨格に載る。言語の追加が選択肢・初期値決定・保存値解釈・カタログ網羅性へ同時に波及する形を型で作る。
- **採用 vs 自作**: 言語タグの正規化に `Intl.Locale` / `Intl.LocaleMatcher` の採用を検討したが、対応言語が2つで、必要な処理が「先頭のサブタグを小文字化して照合する」だけであるため、プラットフォーム API を使うほうが記述量が増える。自作の純関数を採用する。`chrome.i18n` / `_locales` は manifest 表示名の国際化については**プラットフォーム標準の採用**であり、自作しない。
- **簡素化**: 言語ごとのカタログを動的 import する遅延読み込み層、言語ごとのフォーマッタ、`Intl.PluralRules` ラッパ、言語設定の同期 API はいずれも現行要件に不要であり、設計から除いた。永続化ポートも「1キーの読み書き」だけに絞り、汎用の設定ストアにしない。

## リスク

| リスク | 影響 | 緩和 |
|---|---|---|
| 型レベルのプレースホルダ照合がコンパイル時間を悪化させる | `pnpm typecheck` の遅延 | 上流と同じく移行前後で所要時間を比較し、悪化時は照合を単体テストへ後退させる（設計上の代替経路を明記） |
| `catalog/` のディレクトリ移動が上流の機械検査（`validate-ui-text.mjs`）の除外パスとずれる | CJK リテラル検査が誤検出・検出漏れを起こす | 除外パスの更新を同一タスクで行い、意図的に日本語を戻して検査が落ちることを確認する |
| 言語切り替え時に feature の React root が再マウントされる | 入力途中の内容が消える | ストア購読による再レンダーのみで、root の生成・破棄を伴わないことを contract テストで固定する |
| `_locales/` の追加で既存の manifest 完全一致テストが落ちる | 検証フローの赤 | 同一タスクでテストを更新し、`default_locale` と `__MSG_*` の整合を新しい機械検査へ格上げする |
| 保存値の読み取り失敗で起動が止まる | 拡張が使えない | 保存ポートは失敗を `Result` で返し、初期値決定は保存値なしと同じ経路へ落ちる |
