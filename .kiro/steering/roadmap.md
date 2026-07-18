# Roadmap

## Overview

`pc-build-planner` のMVPとして、Web上で見つけたPCパーツをユーザー操作によってローカルへ取り込み、プロジェクト内の候補として整理し、現在の構成と基本的な互換性を確認できるChrome拡張を構築する。

横断レビューで判明した共有ファイルの所有権競合を解消するため、機能境界による垂直分割に `application-shell` を追加する。データ基盤を先に確立し、application shellがside panel host、feature registration、typed navigation、service workerを含むcomposition root、公開API組立、共通maintenance表示を所有する。各featureは自身の `public.ts`、登録モジュール、公開契約だけを所有し、共有runtime入口を直接変更しない。

候補変更とCurrentBuild参照修復は成功後イベントによる別writeへ分離せず、local data foundationが所有する単一write authority内の原子的root mutationとして扱う。共通 `Result<T, E>` もfoundationをcanonical ownerとし、shellと各featureは再定義せず利用する。

## Approach Decision

- **Chosen**: 新規 `application-shell` specと既存spec更新の混合分解。共有UI/runtime統合面、typed feature activation、service worker compositionをapplication shellへ、共通 `Result<T, E>`、参照整合性修復を含む原子的root mutation、置換、全書き込みを覆う排他契約をlocal data foundationへ集約する。
- **Why**: `src/runtime/side-panel.ts`、`src/runtime/service-worker.ts`、root `src/index.ts`、`side-panel.html`のcomposition ownerを一つに定めながら、データ整合性primitiveをUI責務から分離できる。候補変更とCurrentBuild修復を同一commitに含めることでinvalid rootを挟まず、各featureは `public.ts` とregistration portを介して独立実装・検証できる。
- **Rejected alternatives**: application shellをfoundationへ統合する案はデータ基盤へUI責務を混在させるため不採用。共有ファイルを各featureが順番に編集する案は競合原因と依存方向の曖昧さを残すため不採用。候補変更成功後にCurrentBuildを別writeで修復する案は、一括検証されるrootの原子性を破るため不採用。featureごとに共通 `Result` 型を定義する案はcanonical ownerを曖昧にするため不採用。

## Scope

- **In**: PC版Chrome 116以降で動く未パッケージのManifest V3拡張、ローカルデータ基盤、application shellとfeature registration、プロジェクトと候補パーツの管理、ユーザー操作時の商品情報抽出と確認・修正、現在の構成管理、基本的な互換性判定、JSONバックアップと復元、復元中の全書き込み抑止。
- **Out**: Webアプリ、バックエンド、アカウント、同期、Chrome以外のブラウザ、Chrome Web Store公開、AI、サーバー側スクレイピング、価格・在庫監視、商品マスター、サイト別正式対応、価格.com専用アダプター、複数構成案、共通パーツライブラリ、高度な互換性判定、旧ライブラリmajorからの段階的migration。

## Constraints

- 商品取得はユーザーの明示操作を契機とし、`activeTab` と `scripting` の一時権限だけを基本とする。`sidePanel.open()` は有効なユーザージェスチャー内で呼び出す。
- ページDOMの抽出は注入関数またはcontent scriptで行い、MV3 service workerのメモリや寿命だけに処理継続や排他状態を依存させない。
- すべての永続化mutationを単一の信頼済みwrite authorityへルーティングする。復元maintenance stateには世代番号とowner fencingを持たせ、commit直前に再検証し、worker再生成やstale lockで排他を破らない。
- 候補の削除、カテゴリ変更、その他CurrentBuild参照へ影響するmutationは、foundationが所有する参照修復policyを同一root transaction内で適用してから検証・commitする。成功後イベントによる二段階保存へ依存しない。
- cross-feature遷移はshell所有のtyped activation contractを介し、feature ID、遷移先、検証済みpayloadをcomposition rootで解決する。
- `src/runtime/service-worker.ts` を含む共有runtime bootstrapはapplication shellだけがcompositionし、featureはworker登録portまたはruntime adapterを公開する。
- プロジェクト共通 `Result<T, E>` のcanonical ownerはlocal data foundationとし、shellと各featureは同等型を再定義しない。
- 各featureの公開入口はfeature-owned `public.ts` に統一し、root `src/index.ts` はapplication shellだけが組み立てる。
- `chrome.storage.local` の既定10MB上限を前提に、容量監視、書き込み失敗処理、保存データ抑制を行う。生HTMLと商品画像は保存しない。
- ストレージは `TRUSTED_CONTEXTS` へ限定し、ページ由来データとcontent scriptからのメッセージを未信頼入力として検証する。
- 実行コードはすべて拡張へ同梱し、リモートコード、`eval`、インラインJavaScriptに依存しない。
- 実サイト由来のHTML、画像、取得商品データをfixtureやサンプルとして公開リポジトリへ含めない。
- ライブラリは実装開始時点の最新stable majorを採用し、対象Node/Chromeとの互換性を確認する。旧major互換や段階的migrationは行わない。
- 将来のWebアプリや同期への移行を妨げない、バージョン付きデータモデルとエクスポート形式を維持する。

## Boundary Strategy

- **Why this split**: application shellだけがside panelとservice workerを含む共有runtime入口、typed navigation、root public API compositionを編集し、各featureは `public.ts` と登録モジュールを提供する。foundationだけが共通 `Result`、保存primitive、参照修復policy、write authorityを所有し、candidate managementとbackup/restoreはその原子的mutation契約の利用側に限定する。
- **Shared seams to watch**: feature registration port、`ShellNavigator` / `FeatureActivationIntent`、worker registration port、root public API、canonical `Result<T, E>`、write authority messaging、maintenance `(generation, revision)` cursorとowner fencing、Repository原子的置換、候補mutationとCurrentBuild参照修復、商品カテゴリと正規化属性、候補query名、復元時の参照整合性。

## Existing Spec Updates

- [ ] local-data-foundation -- canonical `Result<T, E>`、`assessReplacement`、`replaceRoot`、単一write authority、世代付きmaintenance leaseとowner fencing、候補変更とCurrentBuild参照修復を同一commitで行う原子的root mutation契約を追加する。共有service worker bootstrapの所有はapplication shellへ移し、foundationはwrite authorityのworker adapter/registration contractだけを公開する。Dependencies: none
- [ ] project-candidate-management -- `public.ts` とfeature registration、typed activationで開く `openCandidateEditor(prefill)`、`CandidateDraft.sourceInfo`、公開query名、cross-spec boundary注記を整合する。候補変更はfoundationの原子的root mutationを利用し、成功後の別writeによるbuild修復を要求しない。Dependencies: local-data-foundation, application-shell
- [ ] product-page-capture -- `public.ts` とregistration方式、typed candidate editor activation、maintenance中の保存拒否、Coordinator/DraftMapper境界、worker registration portを明示し、共有service workerを直接編集しない。Dependencies: local-data-foundation, application-shell, project-candidate-management
- [ ] current-build-management -- `public.ts` とregistration方式を採用し、公開候補query名と依存契約を統一する。候補変更成功後のreconcile writeを削除し、foundationの同一transaction内参照修復policyとの責務境界を明示する。Dependencies: local-data-foundation, application-shell, project-candidate-management
- [ ] compatibility-checking -- `public.ts`、`project-candidate-management` へのdirect dependency、registration方式を明示し、共有runtime入口を直接編集しない。Dependencies: local-data-foundation, application-shell, project-candidate-management, current-build-management
- [ ] backup-restore -- `public.ts` を採用し、Repository primitiveの所有をfoundationへ戻す。maintenance leaseとatomic replacementの利用側、shellへの状態通知側へ限定し、共有runtime入口を直接編集しない。Dependencies: local-data-foundation, application-shell, project-candidate-management, current-build-management

## Direct Implementation Candidates

- なし。横断レビューの指摘はすべてspec境界または公開契約へ影響する。

## Specs (dependency order)

- [ ] application-shell -- side panel host、feature registration、`ShellNavigator` / `FeatureActivationIntent`、service worker composition、公開API組立、共通maintenance表示を所有する。root `src/index.ts`、`src/runtime/side-panel.ts`、`src/runtime/service-worker.ts`、`side-panel.html` の単一所有者となり、各featureの `public.ts` とworker registration portをcompositionする。共通 `Result<T, E>` と原子的root mutationはfoundationから利用する。Dependencies: local-data-foundation
