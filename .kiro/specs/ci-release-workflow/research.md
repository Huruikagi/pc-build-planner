# Research & Design Decisions — ci-release-workflow

## Summary

- **Feature**: `ci-release-workflow`
- **Discovery Scope**: Extension（既存リポジトリへの開発基盤追加。アプリケーションコードには触れない）
- **Key Findings**:
  - 当初想定していた「`pnpm validate` がクリーン環境で失敗する」前提バグは**存在しなかった**。`runFinalGate` が内部で `dist` を削除して build するため、`validate` は自己完結している。
  - 参考リポジトリ `table-enhancer-for-github` は zip 生成に外部依存を追加せず、**プラットフォーム別のOS標準ツール**（win32: .NET `ZipFile::CreateFromDirectory` / それ以外: `zip` コマンド）を `spawnSync` する方式を採っている。本リポジトリでもこの方式を踏襲できる。
  - 本リポジトリのマイルストーンは現時点で `v0.1.0`（open 2 / closed 0）、`v0.2.0`（open 1 / closed 0）。マイルストーン連動の前提チェックとリリースノート生成は、この構造の上で成立する。
  - 利用可能な label は GitHub 既定セット（`bug` / `documentation` / `enhancement` / `question` 等）のみ。リリースノートのグルーピングはこの既定 label を前提に設計する。

## Research Log

### `pnpm validate` の build 依存関係

- **Context**: 本 spec 起票時、「`validate` は `validate:final-build`（`dist` を検査）と `playwright test` を含むが `pnpm build` を呼ばないため、`dist/` が gitignore されているクリーンチェックアウトでは必ず失敗する」と仮説を立てていた。CI 導入の前提となる修正項目として扱う予定だった。
- **Sources Consulted**: `scripts/validate-final-gate.mjs`、`scripts/build.mjs`、`package.json`、実際の実行
- **Findings**:
  - `runFinalGate` は `rm(outputDirectory, { recursive: true, force: true })` の直後に `buildUnpackedExtension(outputDirectory)` を呼ぶ。すなわち `validate:final-build` 自身が build 工程を内包する。
  - `dist` を削除した状態で `node scripts/validate-final-gate.mjs dist` を実行し、成功と `dist` の再生成を確認済み。
  - `validate` の実行順序は `... && validate:final-build && test && playwright test` であり、`playwright test` の時点で `dist` は必ず存在する。
- **Implications**: 前提バグ修正は不要。本 spec のスコープから除外した。ただし `playwright test` が「先行する `validate:final-build` が `dist` を残していること」に暗黙依存している事実は残るため、CI 側で `validate` を分割実行しないこと（`validate:ci` と `playwright test` の間で `dist` を破棄しないこと）を設計上の制約として明示する。

### zip パッケージ生成手段

- **Context**: `pnpm build` は `dist/` への unpacked 展開のみで、Chrome ウェブストアへ提出する zip を生成する手段が存在しない。本リポジトリの devDependencies には圧縮ライブラリが含まれていない。
- **Sources Consulted**: `table-enhancer-for-github` の `scripts/package.mjs` および `package.json`、Node.js 標準モジュール（`node:zlib` は deflate は提供するが ZIP コンテナは提供しない）
- **Findings**:
  - 参考リポジトリは依存を追加せず、`process.platform === "win32"` で分岐して PowerShell 経由の .NET `ZipFile::CreateFromDirectory`、それ以外で `zip -r` を `spawnSync` している。
  - `zip` は GitHub Actions の `ubuntu-latest` イメージに標準搭載されている。Windows では PowerShell 経由の .NET API が常に利用できる。
  - ただし参考実装は `dist` ディレクトリをそのまま圧縮するため、内部マーカーの除外ができない。本リポジトリの `buildUnpackedExtension` は `dist/.build-ready` を書き出しており、これは配布物に不要（要件 3.4）。
- **Implications**: 参考実装の「依存を足さずOS標準ツールを使う」方針は踏襲しつつ、**圧縮前に配布対象だけを収めたステージングディレクトリを作る**工程を追加する。

### GitHub Actions のアクションバージョン

- **Context**: 参考リポジトリの `release.yml` が使用するアクションのバージョンが現行かを確認する必要がある。
- **Sources Consulted**: GitHub API の各リポジトリ latest release
- **Findings**: `actions/checkout` は `v7.0.1`、`jdx/mise-action` は `v4.2.3`、`actions/upload-artifact` は `v7.0.1` が最新。参考リポジトリが使う `@v7` / `@v4` / `@v7` はいずれも現行メジャー。
- **Implications**: 参考リポジトリと同じメジャーバージョン指定をそのまま採用する。

### マイルストーン・issue の取得手段

- **Context**: リリース前提チェックとリリースノート生成のために、マイルストーンと配下 issue を CI から取得する必要がある。
- **Sources Consulted**: `gh api repos/{owner}/{repo}/milestones`、`gh issue list --milestone`、リポジトリの実データ
- **Findings**:
  - マイルストーンオブジェクトは `title` / `number` / `state` / `open_issues` / `closed_issues` を持つ。ただし `open_issues` / `closed_issues` は当該マイルストーンに紐づく **pull request も数える**。
  - `gh issue list --milestone <title>` は pull request を除外した issue のみを返し、`--json number,title,labels,url` で構造化取得できる。
  - 現行データ: `v0.1.0` は open 2 / closed 0、`v0.2.0` は open 1 / closed 0。
- **Implications**: 前提チェック（要件 5.3）とリリースノート生成（要件 6.1）はいずれも `gh issue list --milestone` を情報源とし、マイルストーンオブジェクトの集計値は使わない。マイルストーンの `number` と `state` の取得にのみ `gh api .../milestones` を使う。

### 既存テストが `package.json` scripts を検査している

- **Context**: CI 用の検証セットを新しい script として追加する場合、既存テストとの整合を確認する必要がある。
- **Sources Consulted**: `tests/tooling/build-smoke.test.ts`
- **Findings**: `packageJson.scripts.validate` が `/typecheck.*lint.*validate:final-build.*test.*playwright test/` にマッチすることを検査している。`validate` を別 script の合成へ書き換えると、この正規表現は通らなくなる。
- **Implications**: `validate` を再構成する場合、同テストを「合成関係を検査する」形へ更新する必要がある。これは検証内容の変更ではなく検証構造の記述更新であり、要件の Boundary Context が禁じる「既存検証スクリプトの内容変更」には当たらない。

## Architecture Pattern Evaluation

### zip 生成の実装方式

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| OS標準ツール + ステージング（採用） | 配布対象のみを stage へコピーし、win32 は .NET `ZipFile`、他は `zip -r` を `spawnSync` | 依存追加ゼロ、参考リポジトリと同一方針、除外制御が明快 | 生成 zip のバイト列は環境間で一致しない（mtime 等）、`zip` コマンドの存在が前提 | ubuntu-latest には `zip` が標準搭載 |
| 圧縮ライブラリの追加 | `archiver` 等を devDependency に追加 | クロスプラットフォームで統一挙動 | 依存が増える。`tech.md` の「ライブラリの固定より境界契約と決定的テストを優先」に照らして正当化が弱い | 却下 |
| ZIP エンコーダの自前実装 | `node:zlib` の `deflateRawSync` 上に ZIP コンテナを自前構築 | 依存ゼロかつバイト単位で決定的、除外も自由 | ZIP 仕様（local header / central directory / EOCD / CRC32）の自前実装は検証コストが高く、配布物の破損は利用者に直撃する | 決定的バイト列は要件ではないため、リスクに見合わない。却下 |

### 検証 CI の script 構成

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `validate:ci` script を追加し `validate` をその合成にする（採用） | `validate:ci` = e2e 抜きの全検証、`validate` = `validate:ci && playwright test` | 検証内容の単一情報源が `package.json` に残る。ローカルでも `pnpm validate:ci` で同じことを再現できる | `build-smoke.test.ts` の更新が必要 | — |
| ワークフロー YAML に個別 script を列挙 | `ci.yml` に `pnpm typecheck` 等を並べる | `package.json` を触らない | 検証セットの定義が YAML と `package.json` に二重化し、確実に drift する | 却下 |

## Design Decisions

### Decision: 前提バグ修正をスコープから除外する

- **Context**: 起票時に「`pnpm validate` がクリーン環境で失敗する」という前提修正項目を置いていた。
- **Alternatives Considered**:
  1. 仮説どおり修正タスクを残す
  2. 実行して事実を確認し、結果に従う
- **Selected Approach**: `dist` を削除した状態で `node scripts/validate-final-gate.mjs dist` を実行して検証し、成功を確認したためスコープから除外した。
- **Rationale**: 存在しない不具合への修正は、既存の検証フローに不要な変更を持ち込むだけになる。
- **Trade-offs**: 起票時の想定と spec の内容がずれるが、`requirements.md` に確認結果を明記して追跡可能にした。
- **Follow-up**: `playwright test` が `validate:final-build` の副産物 `dist` に暗黙依存する点は、`validate:ci` 分割時に壊さないことを設計制約として扱う。

### Decision: 前提チェックを完全検証より前に置く

- **Context**: 要件 4.3 / 5.5 はいずれも「失敗時にリリースしない」ことだけを求めており、実行順序は指定していない。完全検証は Playwright E2E を含むため数分を要する。
- **Alternatives Considered**:
  1. 参考リポジトリ同様、検証 → パッケージ → メタ情報の順
  2. 安価なゲート（version 整合・tag 重複・マイルストーン状態）を先に実行し、その後で完全検証
- **Selected Approach**: 2 を採る。version 解決 → version 整合チェック → tag 重複チェック → マイルストーン前提チェック → 完全検証 → パッケージ → 公開、の順とする。
- **Rationale**: 運用上もっとも起こりやすい失敗は「version を上げ忘れた」「マイルストーンに残件がある」であり、これらを数秒で弾けると手戻りが軽い。要件の受け入れ基準はいずれも満たす。
- **Trade-offs**: 「検証を通った成果物だけがリリースされる」という保証は順序ではなくジョブの逐次実行で担保される。ステップ間で状態を持ち越さないことが前提。
- **Follow-up**: リリースノート生成は前提チェック通過後（要件 6.1）だが、公開直前に置いても要件は満たす。実装ではパッケージ生成後・公開前に置く。

### Decision: リリースノートの整形を Node script へ切り出す

- **Context**: 要件 6.2 / 6.3 / 6.4 は label グルーピング、リンク付き列挙、label なし issue の既定グループ分類という分岐を持つ。
- **Alternatives Considered**:
  1. `release.yml` 内のシェルスクリプトで `jq` 整形する
  2. `gh issue list --json` の出力を stdin で受ける純関数的な Node script に切り出す
- **Selected Approach**: 2 を採る。`scripts/release-notes.mjs` が JSON を受け取り Markdown を返す。GitHub API アクセスはワークフロー側（`gh`）が担い、script は整形のみを担当する。
- **Rationale**: 整形ロジックが `node:test` で単体検証可能になる。ネットワークにも `gh` にも依存しないため、リリースを実行しないと壊れていることが分からない、という状態を避けられる。本リポジトリは `scripts/*.mjs` + `tests/tooling/*.test.ts` の構成を既に持っており、そこへ素直に乗る。
- **Trade-offs**: ワークフローと script の間に JSON 形状の契約が生まれる。この形状は `gh issue list --json number,title,labels,url` の出力に固定する。
- **Follow-up**: `gh` の JSON 出力形状が変わった場合に備え、script 側は未知フィールドを無視し、必須フィールド欠落は明示的なエラーにする。

### Decision: label グルーピングの分類規則

- **Context**: issue は複数 label を持ちうるため、どのグループへ入れるかの決定規則が必要（要件 6.2 / 6.4）。
- **Alternatives Considered**:
  1. label ごとに issue を重複掲載する
  2. 優先順位付きの label リストで最初に一致したものを採用し、1 issue を 1 グループにのみ掲載する
- **Selected Approach**: 2 を採る。優先順位は `enhancement` → `bug` → `documentation` の順とし、いずれにも該当しない場合と label 未付与の場合は「その他」へ分類する。
- **Rationale**: 同一 issue の重複掲載はリリースノートの読み手を混乱させる。既定 label セットしか存在しないため、優先順位は固定表で十分。
- **Trade-offs**: 将来 label を増やした場合、分類表の更新が必要になる。未知 label は「その他」へ落ちるため欠落はしない（要件 6.4 を満たす）。
- **Follow-up**: 分類表は script 内の定数として一箇所にまとめ、単体テストで「未知 label が欠落しないこと」を回帰対象にする。

## Risks & Mitigations

- **`zip` コマンドが実行環境に存在しない** — `spawnSync` の `error` / 非ゼロ終了を明示的に検知して失敗させ、環境要件をエラーメッセージに含める。CI は `ubuntu-latest` に固定する。
- **マイルストーン close の権限不足でリリース後に手順が中断する** — ワークフローの `permissions` に `contents: write` と `issues: write` を明示する。close 失敗時はワークフローを失敗として報告し、リリース自体は既に成功している旨をログへ出す（要件 7.6）。
- **`validate:ci` と `playwright test` を CI で別ジョブに分割すると `dist` が失われる** — リリースワークフローでは `pnpm validate`（合成済み）を単一ジョブ・単一ステップで実行し、分割しない。
- **検証 CI が 5 分を超える**（要件 2.7） — `jdx/mise-action` の `cache: true` と pnpm store キャッシュを有効にする。E2E を含めない構成を維持する。超過した場合は `validate:final-build` の CI 実行可否を再検討する。
- **`manifest.json` と `package.json` の version がずれたままリリース操作を行う** — リリースワークフローの最初のゲートで不一致を検出して失敗させる（要件 4.5）。

## References

- [table-enhancer-for-github `release.yml`](https://github.com/Huruikagi/table-enhancer-for-github/blob/main/.github/workflows/release.yml) — ベースとする既存ワークフロー
- [table-enhancer-for-github `scripts/package.mjs`](https://github.com/Huruikagi/table-enhancer-for-github/blob/main/scripts/package.mjs) — 依存追加なしの zip 生成方式
- [issue #18](https://github.com/Huruikagi/pc-build-planner/issues/18) — 本 spec の起票元
