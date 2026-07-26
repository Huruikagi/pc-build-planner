# Brief: settings-screen

出典: GitHub issue [#19](https://github.com/Huruikagi/pc-build-planner/issues/19)（milestone v0.3.0）

## Problem

v0.2.0 の `ui-internationalization` で言語切り替え UI を導入したが、現在は application shell のヘッダに `LanguageSelectControl` が常設されている（`src/application-shell/shell-view.tsx:119`）。

サイドパネルという狭い表示領域に対して、日常操作では触らない設定項目が常時ヘッダを占有しているのは配置として適切でない。

同様に「日常操作ではないメンテナンス系の画面」であるバックアップ・復元は既に独立タブとして存在しており（`nav.backupRestore`, order 60）、言語設定はここと同じ性格の機能である。設定的な性格を持つ機能が、ヘッダと独立タブに分散している状態になっている。

## Current State

- `src/application-shell/shell-view.tsx:119`: ヘッダに `LanguageSelectControl` を常設。
- application-shell 要件8: 「表示言語を切り替える操作面を、読み込み中・通常表示・エラー表示・maintenance 表示のいずれの状態でも利用可能な共通領域として提示する」と規定されている。**設定画面へ移すとこの要件と正面から衝突する**ため、要件の改訂が必須になる。
- `src/features/backup-restore/`: 独立 feature として登録され、ナビに `nav.backupRestore`（order 60）で並ぶ。
- `src/ui-messages/catalog/{ja,en}/nav.ts`: ナビ文言。
- `src/features/settings/` は存在しない。

## Desired Outcome

- 「設定」画面がひとつあり、表示言語の切り替えとバックアップ・復元がそこに集約されている。
- shell ヘッダから言語セレクタが撤去され、狭いサイドパネルの上部が日常操作のために空く。
- 言語切り替えが必要な場面（読み込み中・エラー表示中など）でも操作方法に迷わない。

## Approach

`src/features/settings/` を新設し、設定画面として言語切り替えとバックアップ・復元を集約する。shell ヘッダからは `LanguageSelectControl` を撤去する。

**`transient-feature-surface`（#6）の完了後に着手する。** 両者は狭いサイドパネルの同じナビ面を触る（一方は product-capture を外し、一方は settings を足して backup-restore を畳む）ため、順序を決めないと E2E ロケータとカタログキーを二度触ることになる。capture を外した後の常設ナビ構成が見えている状態で設計する。

**application-shell 要件8 の扱いが最大の設計判断になる。** 「どの画面状態でも言語を切り替えられる」という要件を、設定画面という一箇所へ集約する形とどう両立させるか。読み込み中・エラー表示中に設定画面へ到達できるのか、要件8 の意図（操作方法に迷わない）を別の形で満たすのか、要件そのものを緩めるのかを設計フェーズで決める。

## Scope

- **In**:
  - `src/features/settings/` の新設と feature 登録
  - 表示言語切り替えの設定画面への移設、shell ヘッダからの `LanguageSelectControl` 撤去
  - バックアップ・復元の設定画面内セクションへの再配置
  - `nav.settings` / `nav.backupRestore` のカタログキーと ja / en 文言の整理
  - E2E ロケータおよび `e2e/backup-restore.spec.ts` ほかの更新
  - application-shell 要件8 の再定義
- **Out**:
  - 新しい設定項目の追加（言語とバックアップ復元以外）
  - バックアップ・復元の機能自体の変更（エクスポート形式、復元手順、maintenance lease の扱い）
  - 表示言語の解決・永続化ロジックの変更（ui-language が所有）
  - UI 全面刷新（次リリース）
  - 一過性 feature 契約の変更（`transient-feature-surface` が所有）

## Boundary Candidates

- **settings feature の内部構造**: backup-restore を settings に**内包**するか、settings 配下の**セクションとして統合**するか。feature 登録・`FeatureContribution` catalog・境界検証（`scripts/validate-boundaries.mjs`）への影響が変わる。
- **feature id の扱い**: 既存の feature id `backupRestore` を維持するか改名するか。E2E ロケータと永続化データへの影響を確認する。
- **言語コントロールの設置面**: shell 所有の共通領域（現状）から settings feature 所有の画面内要素へ移る。この所有権移動が application-shell 要件8 / 境界コンテキスト（「表示言語コントロールの設置面を提供するだけ」）とどう整合するか。
- **ナビ項目の構成**: settings のナビ order、backup-restore の項目を残すか畳むか。

## Out of Boundary

- 表示言語の意味・保存・解決（`ui-language` / `ui-internationalization` が所有）
- メッセージカタログの構造（`ui-message-catalog` が所有）
- バックアップの形式・maintenance lease（`backup-restore` / `local-data-foundation` が所有）
- 常設ナビからの product-capture 除去（`transient-feature-surface` が所有）

## Upstream / Downstream

- **Upstream**: `transient-feature-surface`（先行して常設ナビ構成を確定させる）、`application-shell`（feature 登録・ナビ）、`ui-internationalization` / `ui-language`（言語コントロール）、`backup-restore`（再配置対象）、`ui-message-catalog`（文言）
- **Downstream**: UI 全面刷新（次リリース）が設定画面の存在を前提にできる

## Existing Spec Touchpoints

- **Extends**:
  - `application-shell` -- 要件1.6 / 要件8（言語セレクタの設置面）の改訂が必須
  - `ui-internationalization` -- 言語切り替え UI の設置場所に関する記述の改訂
  - `backup-restore` -- 独立タブから設定画面内セクションへの再配置に伴う registration / navigation の改訂
  - `ui-message-catalog` -- `nav.settings` の追加と `nav.backupRestore` の整理
- **Adjacent**:
  - `transient-feature-surface` -- 同じナビ面を触る。**本 spec より先に確定させる**

## Constraints

- サイドパネルの狭い表示領域。設定画面へ到達するまでの操作数を増やしすぎない。
- feature 外からは `public.ts` のみを利用する境界規約を維持し、`scripts/validate-boundaries.mjs` を通す。
- feature は共有 runtime 入口を直接編集せず、公開契約と登録 port を追加して composition される形にする（steering `structure.md`）。
- 表示言語の切り替えが現在 mount 中の feature を不要に再 mount させない（application-shell 要件8.2）。
- ja / en 両方の文言を用意する。3言語目は対象外。
- 既存の永続化データ（feature id を含む可能性）を壊さない。
