# Brief: candidate-source-bookmarks

出典: GitHub issue [#10](https://github.com/Huruikagi/pc-build-planner/issues/10), [#9](https://github.com/Huruikagi/pc-build-planner/issues/9), [#11](https://github.com/Huruikagi/pc-build-planner/issues/11)（milestone v0.3.0）

## Problem

一つのパーツの検討は本来複数ページにまたがる。同じ商品を A 店の販売ページ、B 店の販売ページ、メーカーの製品紹介ページで見比べるのが自然な行動だが、現在のデータモデルは 1商品 : 1取得元 を前提としているため、この行動を保持できない。

- 価格は「商品」側に1件だけ持つ（`CandidateProductValues.price`、`src/domain/normalized-attributes.ts:61`）
- 取得元は `sourceInfo` として1商品1件（`pageUrl` / `siteName` / `capturedAt`、`src/domain/model.ts:46`）

結果として、別サイトの同一商品を残そうとすると重複した別パーツとして登録するしかなく、価格比較が成立しない。

あわせて、保存済み候補から取得元ページへ戻る導線が UI に無い（#9）。`pageUrl` は保存されているのに使われていないため、steering `product.md` が中核に据える「溜めた候補へは取得元ページを介していつでも戻れるようにし、ブックマークとして機能させる（再訪）」が実現されていない。

さらに、複数ページを束ねられたとしても各ページの性格が区別できないと「価格を見る先」と「公式スペックを見る先」が混ざる（#11）。メーカー商品紹介ページは価格を持たないことが多く、価格を必須として扱うモデルとは噛み合わない。

## Current State

- `src/domain/model.ts`: `CandidatePart` が `sourceInfo` を単数で持つ（:46 付近）。`LocalDataRoot.schemaVersion` は `1` 固定（:90 付近）。
- `src/domain/normalized-attributes.ts`: `SourceInfo` と `CandidateProductValues.price`（:61 付近）。価格は商品側。
- `src/domain/validation.ts`: `sourceInfo` のバリデーションが単数前提。
- `src/features/candidate-management/state-snapshot.ts`: `pageUrl` の保持と `http`/`https` 検証（:134 付近）を実装済み。
- `src/features/candidate-management/view.tsx`: 取得元ページを開く UI が無い。
- 移行機構は local-data-foundation が所有しているが、本プロジェクトは初回リリース前であり、開発中の保存データと旧backupは互換対象にしない。

## Desired Outcome

- 一つの候補パーツに複数の取得元ページ（ソース）を束ねられる。各ソースが URL・価格・取得日時・サイト名を個別に持つ。
- どれか一つをプライマリ（代表）として指定でき、一覧に出る価格・URL はプライマリから導出される。二重管理しない。
- 各ソースに種別（**販売ページ** / **メーカー商品紹介ページ**）が付き、価格を持たないメーカーページを自然に扱える。既定は自動判定し、利用者が上書きできる。
- 候補一覧・詳細から任意のソースページを開き直せる。作業中のタブを潰さず、サイドパネルは開いたまま維持される。
- 初回リリースの保存形式を複数ソース構造へ直接統一し、旧`sourceInfo`と商品共通`price`をcanonical契約へ残さない。

## Approach

**取得元を 1:N のコレクションへ構造変更し、価格を per-source かつ optional へ移す。** 商品側の代表価格は保持せず、表示値はプライマリソースから導出する（#10 の論点1・2の推奨案）。

その構造の上に、#9（再訪導線）と #11（ソース種別）を薄い層として同一 spec 内で載せる。両者は単独では spec としてほぼ空であり、`sourceInfo` の形が決まらないと設計できないため分離しない。

- **#9 の実現方針**: パネル内の素の `<a href>` を辿らせない（サイドパネル自身が外部 URL へ遷移して壊れる）。`onClick` で `preventDefault()` し、`chrome.tabs.create({ url })` で新規タブを開くのを既定とする。`chrome.tabs.create` および URL 指定のみの `chrome.tabs.update` は追加権限不要で、現行 manifest のまま動作する。遷移前に `http`/`https` を検証する（`state-snapshot.ts:134` の既存検証を流用）。
- **#11 の実現方針**: 種別は各ソースエントリの optional フィールド（`retail` / `manufacturer` 相当）。自動判定は `product-page-capture` が #8 で持つ**ドメイン→メーカー名マップを参照**する（eTLD+1 がヒット → `manufacturer`、外れ → `retail` 既定）。マップを本 spec 側で二重に持たない。手動での上書きを許可する。

**2ページ目を既存商品へ紐づける手段は本 spec では手動操作に寄せる。** 取り込み時の自動検知・統合提示は `duplicate-product-merge`（#13）が所有する。本 spec は「統合先となるデータ構造と手動での追加操作」までを提供する。

## Scope

- **In**:
  - `sourceInfo` の 1:N 化（各エントリが URL / 価格 / 取得日時 / サイト名 / 種別を持つ）
  - 価格の per-source かつ optional 化、商品側代表価格の廃止とプライマリからの導出
  - プライマリソースの指定・変更
  - 初回リリースの`schemaVersion`と保存形式を複数ソース構造へ統一
  - 実行時検証（`validation.ts`）の複数ソース対応
  - 既存パーツへのソース手動追加・削除
  - ソースページを開く導線（`chrome.tabs.create` 経由、新規タブ既定）
  - ソース種別の自動判定（#8 のマップ参照）と手動上書き、一覧・詳細での出し分け
  - backup/restore のエクスポート・インポート形式との整合確認
- **Out**:
  - 取り込み時の同一商品自動検知と統合提示（`duplicate-product-merge` / #13）
  - 再訪してからの価格再取得（`source-price-refresh` / #12）
  - ドメイン→メーカー名マップそのものの定義・保守（`product-page-capture` の #8 更新が所有）
  - 抽出ロジック・ランカーの変更
  - 価格の履歴保持、通貨換算

## Boundary Candidates

- **ドメインモデル**（local data foundation 所有）: ソースコレクションの型、プライマリの表現（フラグか ID 参照か）、種別フィールド、検証規則。
- **初期schema確定**（local data foundation 所有）: 現行`schemaVersion`、初期root、validator、Repository、replacementを同じ複数ソース契約へ統一すること。
- **導出ロジック**: 一覧表示の代表価格 / 代表 URL をプライマリから導く純粋関数。プライマリ不在・価格なしプライマリのフォールバック規則。
- **タブ遷移 adapter**（feature 所有 runtime adapter）: `chrome.tabs.create` を呼ぶ境界。URL 検証をこの手前で行う。
- **種別推定**: ドメイン→メーカー名マップの参照点。`product-page-capture` の `public.ts` を通す形にし、deep import しない。
- **UI**: 候補詳細でのソース一覧・プライマリ切替・種別表示 / 切替（`candidate-management` 所有）。

## Out of Boundary

- 取得値の抽出精度と優先順位（product-page-capture）
- 候補の CRUD そのもの（project-candidate-management。本 spec はその契約を拡張する形になる）
- 互換性判定への影響（compatibility-checking は正規化属性のみを見るため、価格・ソースの変更は本来影響しないはず。設計で確認する）
- 一過性ビューの起動・終了契約（transient-feature-surface）

## Upstream / Downstream

- **Upstream**: `local-data-foundation`（ドメインモデル・検証・Repository・将来の移行基盤）、`project-candidate-management`（候補 CRUD・詳細編集契約）、`product-page-capture`（保存時に渡す取得元情報、および #8 のドメインマップ）
- **Downstream**: `source-price-refresh`（更新先ソースの特定に本 spec のコレクションを使う）、`duplicate-product-merge`（統合先として本 spec のソース追加契約を使う）、`backup-restore`（新しい `schemaVersion` の入出力）

## Existing Spec Touchpoints

- **Extends**:
  - `local-data-foundation` -- ドメインモデル・検証・初回リリースの`schemaVersion`確定
  - `project-candidate-management` -- 要件2（候補の作成と所属）、要件4（候補情報の編集）、要件6（隣接機能向け契約）。価格が per-source になることで候補作成契約の形が変わる
  - `product-page-capture` -- 要件5.3（確認値・元表記・取得元・取得日時を候補作成契約へ渡す）。渡す取得元がソース1件として扱われる
  - `backup-restore` -- 新 `schemaVersion` の互換
- **Adjacent**:
  - `compatibility-checking` -- 正規化属性のみを参照するため影響は無いはずだが、候補参照契約の変更が波及しないことを確認する
  - `transient-feature-surface` -- 独立して進行可能。ナビ面には触らない

## Constraints

- 開発中の旧保存データと旧backupは互換対象にしない。初回リリース形式の不正なroot・backupは、local-data-foundationの原子的mutation / atomic replacement規約に従って既存値を置換せず拒否する。
- 永続化 mutation は単一 write authority へ集約する（steering `structure.md`）。成功後イベントによる別 write で参照整合性を修復しない。
- サイドパネルを外部 URL へ遷移させない。`<a href>` を素で辿らせず必ず `chrome.tabs.*` 経由にする。
- タブ操作に追加権限を要求しない（`chrome.tabs.create` / URL 指定のみの `chrome.tabs.update` は権限不要。`"tabs"` 権限は追加しない）。
- 遷移先 URL は `http`/`https` のみ許可する。
- 価格・通貨は取得値を尊重し、通貨未確定は「不明」として保持する（steering `product.md`）。
- feature 外からは `public.ts` のみを利用する境界規約を維持する。
- テスト資産は架空データのみ。

## Change Brief: v0.5.0

### Problem

CandidateSourceのcatalog・照合・変異責務がcandidate-managementとsource-price-refreshへ分散し、両featureが相互に型と値をimportする循環依存になっている。source概念のcanonical ownerと公開portが実際の配置に反映されていない。

### Current State

本specはsource collection、primary導出、catalog/mutation facet、条件付きprice patchを所有するが、実装の一部はcandidate-management配下にあり、URL identity・locator・match scopeはsource-price-refreshが所有する。shellは遅延proxyで構築循環を回避している。

### Desired Outcome

source collection policy、catalog、reference、mutation、URL identity、scope/matcher、条件付きprice patchを本specの独立共有coreへ集約する。candidate-managementはsource editor UI、source-price-refreshは価格取得workflow、duplicate-product-mergeはsource照合consumerとなり、feature間循環と遅延proxyを解消する。

### Scope

- **In**: 独立共有coreと`public.ts`、source catalog/reference/mutation、URL normalization/identity、一意照合・ambiguity、match scope、条件付きprice patch、既存source policy、consumer移行、export/deep import gate、contract/integration test。
- **Out**: 価格抽出・context menu・一過性表示、商品同一性判定、source editor UIの再設計、保存schemaの意味変更、価格履歴・監視。

### Boundary Impact

- **Extends**: 既存のsource collection ownerを、catalog・照合・変異を含む独立共有coreへ明確化する。
- **Preserves**: 1:N source構造、primary導出、原子的mutation、URL安全性、candidate UIと価格更新の利用者挙動。
- **Adjacent**: `source-price-refresh`はmatch ownershipを手放してworkflow consumerとなり、`project-candidate-management`はsource editor UIだけを保持する。

### Dependencies

- **Upstream**: `implementation:project-candidate-management`のproject/error ownership整理。
- **Downstream**: `source-price-refresh`の責務縮小、`duplicate-product-merge`の循環解消、shell遅延proxy撤去。

### Source

- Milestone v0.5.0、GitHub Issue #46。

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

source core化の方向は正しいが、実装完了をspec更新の前提にした依存と、共有error ownerへの依存がroadmapに表現されていない。

### Current State

source catalog/mutationはcandidate-management、URL identity/matchはsource-price-refreshに分散し、両者をshellの遅延proxyが接続する。

### Desired Outcome

本specがsource model policy、catalog/reference/mutation、URL identity、match scope、一意照合、条件付きprice patchを共有coreとして所有し、共有`AppDataError`を利用する。specは確定契約を前提に更新でき、実装順はtasksで制御する。

### Scope

- **In**: source共有core/public entry、candidate/source-price consumer contract、共有error利用、循環解消、contract/tooling test。
- **Out**: price extraction、source editor UI、商品identity、保存schema意味変更、shell composition実装。

### Boundary Impact

- **Extends**: sourceに関する唯一のdomain/public ownerを確定する。
- **Preserves**: 1:N、primary導出、原子的mutation、URL安全性、既存UI/価格更新挙動。
- **Adjacent**: candidate-managementはeditor UI、source-price-refreshはworkflow、application-shellは公開port compositionだけを所有する。

### Dependencies

- **Upstream**: `spec:project-candidate-management`、`spec:local-data-foundation`。
- **Downstream**: `spec:source-price-refresh`、`spec:duplicate-product-merge`、`spec:application-shell`。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。
