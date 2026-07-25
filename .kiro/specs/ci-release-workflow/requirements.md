# Requirements Document

## Project Description (Input)

GitHub Actions による CI / リリースワークフローを整備する（[issue #18](https://github.com/Huruikagi/pc-build-planner/issues/18) 対応）。

### 誰の課題か / 現状 / 何を変えたいか

- **誰**: 本リポジトリの個人開発者（`main` ブランチ一本運用、レビュアーなし）。
- **現状**:
  - CI ワークフローが一切存在せず、検証はすべてローカルの cc-sdd（spec-driven）フローに依存している。そのため、エージェント経由でないコミット（ドキュメント修正、手直し等）や、ローカル環境固有の状態に依存した破壊、lockfile の不整合、Windows ローカルと Linux 環境の差異を検知できない。
  - リリース手順が自動化されておらず、配布用 zip パッケージを生成する手段が存在しない（`pnpm build` は `dist/` への unpacked 展開のみ）。
  - リポジトリはマイルストーン = バージョンで運用している（`v0.1.0` / `v0.2.0`）が、マイルストーンの完了状態とリリースが連動していない。
- **変えたいこと**: 検証 CI とリリースを分離した 2 本のワークフローを整備し、リリースをマイルストーン運用と連動させる。

### スコープ

#### (1) 検証 CI — `ci.yml`

- トリガ: `push` / `pull_request`（`main`）、`docs/**` `.kiro/**` `**/*.md` は `paths-ignore`
- mise セットアップ → `pnpm install --frozen-lockfile` → 軽量な検証セット
- Playwright E2E は**含めない**（push 毎の待ち時間とブラウザインストールのコストを避けるため）

#### (2) リリース — `release.yml`（マイルストーン連動）

- トリガ: `workflow_dispatch`
- E2E を含むフル検証 → build → zip パッケージ生成
- version はリポジトリ直下の `manifest.json` から取得、タグ形式は `v{version}`
- マイルストーン `v{version}` の open issue が 0 でなければ fail、release note は当該マイルストーン配下の closed issue から label グルーピングで生成、リリース成功後にマイルストーンを close

#### (3) 設計で決めること

- zip パッケージ生成の実装方式（`scripts/build.mjs` への追加 or 専用スクリプト）

### 参考

ベースは [table-enhancer-for-github の `release.yml`](https://github.com/Huruikagi/table-enhancer-for-github/blob/main/.github/workflows/release.yml) を踏襲する。差分はスクリプト名の対応（`verify` → `validate` / `package` → `build`）、manifest がリポジトリ直下である点、マイルストーン連動を追加する点。

### 前提の確認結果（調査済み）

当初「`pnpm validate` は `pnpm build` を呼ばないためクリーンチェックアウトで失敗する」と想定していたが、**これは誤りであることを確認した**。`scripts/validate-final-gate.mjs` の `runFinalGate` が内部で `dist` を削除したうえで `buildUnpackedExtension` を実行するため、`pnpm validate` はクリーン環境でも成立する（`dist` を削除した状態で `node scripts/validate-final-gate.mjs dist` が成功し、`dist` が再生成されることを実行確認済み）。したがって前提となるバグ修正は本 spec のスコープに含めない。

なお、`pnpm validate` 末尾の `playwright test` は `validate:final-build` が生成した `dist` に暗黙に依存する（`pnpm test:e2e` と異なり自前で build しない）。この実行順序への依存は設計時に確認する。

### 制約 / 環境

- ツール管理は `mise.toml`（node 26.5.0 / pnpm 11.13.1）
- ローカル開発は Windows、CI は Linux ランナー
- 配布先は Chrome ウェブストア（Manifest V3 拡張）

## Introduction

本 spec は、`main` ブランチ一本・レビュアー不在という開発体制を前提に、2 種類の GitHub Actions ワークフローを整備する。

1 つ目は **検証 CI** で、`main` への push と pull request を契機に軽量な検証セットを自動実行する。目的はローカル検証の再実行ではなく、ローカルでは構造的に検知できない破壊（lockfile の不整合、クリーン環境固有の失敗、OS 差異、検証を通らないコミット）を拾うことにある。この目的に対して寄与が小さく実行コストの高い Playwright E2E は、検証 CI から意図的に除外する。

2 つ目は **リリースワークフロー** で、手動起動によって完全検証・配布用 zip の生成・GitHub Release の作成を一連の手順として実行する。本リポジトリはマイルストーン title をバージョンとして運用しているため、リリースの可否判定とリリースノートの生成をマイルストーンの状態に紐づけ、リリース完了時にマイルストーンを close するところまでを一貫した操作とする。

## Boundary Context

- **In scope**:
  - 検証 CI ワークフローの起動条件、実行する検証の範囲、失敗時の報告
  - リリースワークフローの起動条件、実行順序、前提チェック、リリースノート生成、成果物公開、マイルストーン close
  - 配布用 zip パッケージを生成するコマンドの入出力と失敗条件
- **Out of scope**:
  - Chrome ウェブストアへの自動アップロード・審査提出（生成した zip の手動提出を前提とする）
  - `manifest.json` の version 自動採番・自動 bump（リリース前の手動更新を前提とする）
  - ブランチ保護、PR テンプレート、required status check などのリポジトリ設定変更
  - 既存の検証スクリプト群（`typecheck` / `lint` / `validate:*` / `test`）そのものの内容変更。ワークフローはこれらを呼び出す側に徹する
  - 依存更新の自動化（Dependabot 等）
- **Adjacent expectations**:
  - 検証の実体は既存の `package.json` scripts が提供する。ワークフローはその成否を忠実に伝播することだけを担い、独自の検証ロジックを持たない
  - Node.js / pnpm のバージョンは `mise.toml` を単一の情報源とする
  - リリース対象バージョンは `manifest.json` を単一の情報源とする
  - マイルストーンおよび issue の label 付与は開発者の運用に委ねられ、ワークフローはその状態を読み取るだけで補正しない

## Requirements

### Requirement 1: 検証 CI の自動起動

**Objective:** 開発者として、`main` への変更時に検証が自動で走ってほしい。ローカル検証を経ていない変更や環境差に起因する破壊を、リリース時ではなく変更直後に検知するため。

#### Acceptance Criteria

1. When `main` ブランチへ push が行われた, the 検証CIワークフロー shall 検証ジョブを起動する
2. When `main` ブランチを対象とする pull request が作成または更新された, the 検証CIワークフロー shall 検証ジョブを起動する
3. When 変更されたファイルが `docs/**`、`.kiro/**`、および Markdown ファイルのみである, the 検証CIワークフロー shall 検証ジョブを起動しない
4. The 検証CIワークフロー shall `workflow_dispatch` による手動起動を受け付ける
5. If 同一ブランチに対する検証ジョブが実行中に新たな push が行われた, then the 検証CIワークフロー shall 先行するジョブを打ち切り最新の変更に対する検証だけを残す

### Requirement 2: 検証 CI が実行する検証の範囲

**Objective:** 開発者として、検証 CI が「ローカルでは検知できないもの」を確実に拾いつつ短時間で完了してほしい。push 毎の待ち時間を許容範囲に保つため。

#### Acceptance Criteria

1. The 検証CIワークフロー shall `mise.toml` に固定された Node.js および pnpm のバージョンで検証を実行する
2. If lockfile がコミットされた依存定義と整合しない, then the 検証CIワークフロー shall 依存インストール段階で失敗する
3. The 検証CIワークフロー shall 実装と公開 consumer の型検査、静的検査、公開境界検査、fixture 検査、および unit/contract/integration/DOM test を実行する
4. The 検証CIワークフロー shall production build の生成と生成物の機械的検査を実行する
5. The 検証CIワークフロー shall Playwright による E2E を実行しない
6. If いずれかの検証が失敗した, then the 検証CIワークフロー shall ワークフロー全体を失敗として報告し、失敗した検証の出力を実行ログから参照可能にする
7. The 検証CIワークフロー shall 検証が成功する通常の変更に対して 5 分以内に完了する

### Requirement 3: 配布用 zip パッケージの生成

**Objective:** リリース担当者として、Chrome ウェブストアへ提出可能な zip を再現可能な単一コマンドで生成したい。手作業の圧縮による構造ミスや取り違えを防ぐため。

#### Acceptance Criteria

1. When パッケージ生成コマンドが実行された, the パッケージング処理 shall production build 成果物を生成したうえで、その内容を収めた単一の zip ファイルを出力する
2. The パッケージング処理 shall zip の最上位階層に `manifest.json` を配置し、展開結果がそのまま拡張として読み込める構造にする
3. The パッケージング処理 shall zip のファイル名に `manifest.json` の version を含め、どのバージョンの成果物かを名前から判別可能にする
4. The パッケージング処理 shall 拡張の実行に必要なファイルのみを zip へ含め、ビルド工程が用いる内部マーカーや開発用ファイルを含めない
5. If 生成物の機械的検査に失敗した, then the パッケージング処理 shall zip を出力せず失敗する
6. When 同一バージョンでパッケージ生成コマンドが再実行された, the パッケージング処理 shall 既存の出力を残さず作り直し、前回実行の残骸を混入させない

### Requirement 4: リリースワークフローの起動と完全検証

**Objective:** リリース担当者として、リリースが常に完全な検証を通過した成果物からのみ生まれることを保証したい。検証されていない成果物が配布されることを防ぐため。

#### Acceptance Criteria

1. The リリースワークフロー shall `workflow_dispatch` による手動起動のみを受け付け、push や pull request では起動しない
2. When リリースワークフローが起動された, the リリースワークフロー shall Playwright による E2E を含む完全な検証を実行する
3. If 完全な検証が失敗した, then the リリースワークフロー shall リリースの作成、タグの付与、およびマイルストーンの更新を一切行わずに失敗として終了する
4. The リリースワークフロー shall `manifest.json` の version を単一の情報源としてリリース対象バージョンを決定する
5. If `manifest.json` の version と `package.json` の version が一致しない, then the リリースワークフロー shall リリースを作成せずに失敗し、不一致の内容を報告する
6. The リリースワークフロー shall バージョン `X.Y.Z` に対して `vX.Y.Z` 形式のタグ名を用いる
7. If 決定したタグ名がリポジトリに既に存在する, then the リリースワークフロー shall リリースを作成せずに失敗する

### Requirement 5: マイルストーン連動のリリース前提チェック

**Objective:** リリース担当者として、そのバージョンで予定していた作業が完了していない状態でのリリースを機械的に止めたい。マイルストーンの残件を見落としたままリリースすることを防ぐため。

#### Acceptance Criteria

1. When リリース対象バージョンが決定された, the リリースワークフロー shall タグ名と同一の title を持つマイルストーンを特定する
2. If 該当する title のマイルストーンが存在しない, then the リリースワークフロー shall リリースを作成せずに失敗し、期待した title を報告する
3. If 特定したマイルストーンに open 状態の issue が 1 件以上存在する, then the リリースワークフロー shall リリースを作成せずに失敗し、未完了の issue を一覧として報告する
4. If 特定したマイルストーンが既に close されている, then the リリースワークフロー shall リリースを作成せずに失敗する
5. While 前提チェックを通過していない, the リリースワークフロー shall リリース成果物の公開を行わない

### Requirement 6: マイルストーンからのリリースノート生成

**Objective:** リリースの読み手として、そのバージョンで何が変わったのかを機能単位で把握したい。コミットの羅列よりも、完了した issue の一覧のほうが変更内容を理解しやすいため。

#### Acceptance Criteria

1. When 前提チェックを通過した, the リリースワークフロー shall 対象マイルストーン配下の closed issue からリリースノート本文を生成する
2. The リリースワークフロー shall closed issue を label 単位でグルーピングし、グループごとの見出しの下に列挙する
3. The リリースワークフロー shall 各 issue について、issue 番号とタイトルを、当該 issue へ辿れる形式で記載する
4. If closed issue に label が付与されていない, then the リリースワークフロー shall 当該 issue を既定のグループへ分類し、リリースノートから欠落させない
5. If 対象マイルストーン配下に closed issue が 1 件も存在しない, then the リリースワークフロー shall リリースを作成せずに失敗する

### Requirement 7: リリースの公開とマイルストーンの完了

**Objective:** リリース担当者として、成果物の公開からマイルストーンの締めまでを 1 回の操作で完了させたい。手順の抜けによって、リリース済みなのにマイルストーンが open のまま残る状態を防ぐため。

#### Acceptance Criteria

1. When 完全検証、パッケージ生成、前提チェック、およびリリースノート生成がすべて成功した, the リリースワークフロー shall `vX.Y.Z` タグを付与した GitHub Release を作成し、生成した zip を添付する
2. When パッケージ生成が成功した, the リリースワークフロー shall 生成した zip をワークフローの成果物としてもアップロードし、後続段階が失敗した場合でも実行結果から取得可能にする
3. When GitHub Release の作成が成功した, the リリースワークフロー shall 対象マイルストーンを close する
4. If GitHub Release の作成が失敗した, then the リリースワークフロー shall 対象マイルストーンを close しない
5. The リリースワークフロー shall リリース作成およびマイルストーン更新に必要な最小限の権限のみを要求する
6. When リリースワークフローが途中の段階で失敗した, the リリースワークフロー shall どの段階で失敗したかを実行ログから判別可能にする

### Requirement 8: リリース運用手順の明文化

**Objective:** 開発者として、次回リリース時に手順を思い出せる状態にしておきたい。リリース頻度が低く、手動で行う前提部分の抜けが起きやすいため。

#### Acceptance Criteria

1. The リポジトリ shall リリース手順として、`manifest.json` および `package.json` の version 更新、対象マイルストーンの issue 完了、リリースワークフローの手動起動、という前提操作を文書として記載する
2. The リポジトリ shall 検証 CI が E2E を含まないこと、および E2E がリリースワークフローで実行されることを文書として記載する
3. When ワークフローの構成が変更された, the 開発者 shall 対応する steering ドキュメントの記述を同じ変更内で更新する
