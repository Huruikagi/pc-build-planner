# Cross-Spec Consistency Review

- Review date: 2026-07-18
- Scope: `local-data-foundation`, `project-candidate-management`, `product-page-capture`, `current-build-management`, `compatibility-checking`, `backup-restore`
- Result: **BLOCKED — roadmap / spec boundary revision required**
- Roadmap status: 未更新（生成済みspecを完了扱いにしていない）

## Summary

全6specについて、データモデル、インターフェース、依存関係、共有基盤、タスク境界、ロードマップとの連続性を横断確認した。

コアデータモデルと責務分離の方向性は概ね一貫している。一方で、side panel、公開API、Repository拡張という共有統合面の所有権が複数specへ分散している。この問題は個別spec内の軽微な修正では解消できず、roadmapまたはdiscovery段階で境界を再整理する必要がある。

## Critical Issues

### 1. 共有統合面の所有権が複数specへ分散している

Affected specs:

- `local-data-foundation`
- `project-candidate-management`
- `product-page-capture`
- `current-build-management`
- `compatibility-checking`
- `backup-restore`

Evidence:

- `src/runtime/side-panel.ts` を次の5specが直接変更対象としている。
  - `project-candidate-management`
  - `product-page-capture`
  - `current-build-management`
  - `compatibility-checking`
  - `backup-restore`
- `src/index.ts` を全6specが変更対象としている。
- `backup-restore` が `local-data-foundation` 所有の `src/persistence/repository.ts` を直接拡張し、`replaceRoot` / `assessReplacement` を追加する設計になっている。

Impact:

- 実装時に同じファイルの所有権が競合する。
- spec単位の独立実装と独立検証が難しくなる。
- 下流機能の追加がfoundationの内部変更を要求し、依存方向が不安定になる。

Recommended action:

- side panel、公開API、Repository拡張を、明示的なshared shellまたはfoundation update seamとしてロードマップ上に切り出す。
- `src/runtime/side-panel.ts` はfeature registration方式へ変更し、各feature specは自身の登録モジュールだけを所有する。
- `replaceRoot` / `assessReplacement` は `backup-restore` からfoundation側の契約へ移すか、明示的なfoundation更新specとして扱う。

この指摘は分解境界そのものに関わるため、既存specへ局所的な修正を加えて解決したことにはしない。

## Important Issues

### 2. Roadmapの依存関係とdesignの直接依存が一致していない

Affected specs:

- `compatibility-checking`
- `backup-restore`

Details:

- roadmapでは `compatibility-checking` の依存先は `current-build-management` のみだが、designは `project-candidate-management` の `CandidateQuery` も直接使用する。
- roadmapでは `backup-restore` の依存先に `local-data-foundation` がないが、designは `SchemaValidator` と `LocalDataRepository` に直接依存する。

Recommended action:

- roadmapへ実際のdirect dependencyを追加する。
- または `compatibility-checking` が `current-build-management` の集約済み読み取り契約だけを利用するようdesignを変更する。

### 3. 商品取り込みから候補詳細編集への受け渡し契約が未定義

Affected specs:

- `product-page-capture`
- `project-candidate-management`

Details:

- capture側は、確認したドラフトを候補管理の詳細編集へ渡す前提になっている。
- candidate management側の公開契約は候補の作成、更新、削除、照会までであり、詳細編集画面を開く明示的なポートがない。

Recommended action:

- `openCandidateEditor(prefill)` のような明示的な公開ポートをcandidate managementへ追加する。
- または詳細編集導線をcapture側の責務として完結させる。

### 4. 復元中の書き込み停止が全保存入口を網羅していない

Affected specs:

- `backup-restore`
- `product-page-capture`

Details:

- backup側は復元中に候補・構成操作を停止するが、captureの `CaptureCandidatePort` を経由した候補保存も書き込み入口になる。
- 現在の契約では、restore ticket有効中のcapture保存停止が明示されていない。

Recommended action:

- side panel全体で共有するwrite lockまたはmaintenance modeを定義する。
- captureセッションの保存も復元中の停止対象へ含める。

## Minor Issues

### 5. `CandidateDraft.sourceInfo` の契約記述が一致していない

Affected specs:

- `local-data-foundation`
- `project-candidate-management`
- `product-page-capture`

Details:

- foundationの `CandidatePart` は `sourceInfo` を持つ。
- captureは `CandidateDraft` に `sourceInfo` を渡す前提である。
- candidate managementの `CandidateDraft` 説明には `sourceSnapshot` しか明記されていない。

Recommended action:

- `CandidateDraft` の正式なフィールド定義へ `sourceInfo` を追加する。
- 別の契約である場合は、その変換責務と型を明示する。

### 6. Task boundary annotationの粒度がspec間で揃っていない

Affected specs:

- `project-candidate-management`
- `product-page-capture`

Details:

- cross-spec interfaceを持つ一部componentに `_Boundary:_` 注記がない。
- `Coordinator`、`DraftMapper`、side-panel integrationなどの所有境界を機械的に比較しにくい。
- `BuildCandidateQuery` と `CandidateQuery.listBuildEligible` の命名も統一されていない。

Recommended action:

- cross-spec interfaceを持つcomponentごとに `_Boundary:_` を追加する。
- query名を公開契約上の名称へ統一する。

## Consistent Areas

- `LocalDataRoot`、`Project`、`CandidatePart`、`CurrentBuild` はfoundationが所有し、下流specが再利用する方向で概ね一貫している。
- `confirmed` と `sourceSnapshot` を分離し、実サイト由来のHTMLや画像を保存しない方針はfoundation、capture、backupで一致している。
- 永続化責務をfoundationのRepositoryへ集約し、下流specがChrome Storage APIを直接使用しない方針は一致している。
- captureは候補保存をcandidate managementへ委譲し、compatibilityは派生判定、backupは交換形式と原子的置換へ責務を限定している。大きな機能重複はない。

## Required Next Step

`$kiro-discovery` で次の境界を再検討する。

1. shared shell / feature registrationの所有spec
2. 公開API composition rootの所有者
3. Repository置換・復元契約をfoundationへ含める方法
4. 実際のdirect dependencyを反映したroadmap
5. 復元中の共通write lock契約

境界更新後に `$kiro-spec-batch` を再実行し、横断レビューを再度通過させる。Critical issueが解消されるまでは、roadmapの対象specを完了済みへ変更しない。

---

# Application Shell追加後の再レビュー

- Review date: 2026-07-18
- Scope: `application-shell` および既存6spec
- Result: **BLOCKED — spec分解と公開契約の追加修正が必要**
- Roadmap status: `application-shell` は未完了のまま

## Summary

`application-shell` のrequirements、design、tasks生成後、全specとのデータモデル、公開インターフェース、共有runtime所有権、task boundaryを再確認した。

side panel host、feature registration、composition rootをshellへ集約する方向は妥当であり、shell内部も `FeatureRegistry`、`PublicApiRegistry`、`CompositionRoot`、`RuntimeAdapters` に分割されている。一方、候補変更時の原子的な参照整合性、cross-feature navigation、service worker compositionの境界が閉じていない。これらは局所的な文言修正ではなく、roadmapまたはdiscovery段階で再整理すべき分解問題である。

## Critical Issues

### 7. 候補変更とCurrentBuild修復を同一保存内で実行できない

Affected specs:

- `local-data-foundation`
- `project-candidate-management`
- `current-build-management`

Details:

- `current-build-management` は候補変更の成功後に `CurrentBuild` をreconcileする設計である。
- foundationはroot全体の参照整合性を検証して一括保存するため、候補の削除または未分類化とbuild修復を別writeにすると、両writeの間にinvalid rootが生じる。
- `project-candidate-management` には、build修復を同一commitへ参加させるpre-commit lifecycle portがない。

Impact:

- 候補削除やカテゴリ変更がfoundationの整合性検証で失敗するか、一時的に不正なrootを保存する実装になり得る。
- feature間のイベントを成功後に連鎖させるだけでは原子性を保証できない。

Recommended action:

- 候補変更とbuild修復をsingle write authority内の1トランザクションとして扱う。
- またはfoundationがpre-commit lifecycle portを公開し、参照修復をcommit前の同一mutationへ参加させる。
- この契約の所有者と依存方向をroadmapへ明記する。

## Important Issues

### 8. Cross-feature navigationとeditor activationのshell契約がない

Affected specs:

- `application-shell`
- `project-candidate-management`
- `product-page-capture`

Recommended action:

- shell所有の `ShellNavigator` または `FeatureActivationIntent` を追加する。
- feature ID、遷移先、検証済みprefill/deep-link payloadをtyped contractとして定義する。
- captureとcandidate managementは共有runtimeを直接操作せず、このportだけを利用する。

### 9. Service workerのcomposition ownershipが閉じていない

Affected specs:

- `application-shell`
- `local-data-foundation`
- `product-page-capture`

Recommended action:

- service worker compositionの所有権をapplication shellへ明示的に移管する。
- またはfoundation-owned bootstrap seamを定義し、各featureが登録モジュールだけを提供する構造にする。
- feature specから共有service workerファイルの直接編集を除く。

### 10. 共通 `Result<T, E>` の所有権が重複している

Affected specs:

- `application-shell`
- `local-data-foundation`

Recommended action:

- canonical ownerをfoundationの `src/domain/result.ts` に統一する。
- shellは共通型をimportして使用し、同等型を再定義しない。

## Minor Issues

### 11. Feature公開入口の命名が一致していない

Affected specs:

- `application-shell`
- `project-candidate-management`
- `product-page-capture`
- `current-build-management`
- `compatibility-checking`
- `backup-restore`

Recommended action:

- shell側の契約を「feature-owned public entry module」としてファイル名非依存にする。
- または全featureを `public.ts` へ統一する更新をroadmapに明記する。

## Existing Spec Updatesとの関係

次の課題はroadmapの `## Existing Spec Updates` に既に含まれているため、その更新waveで解消する。

- foundationへの `assessReplacement`、`replaceRoot`、single write authority、世代付きmaintenance leaseとowner fencingの追加
- `src/index.ts`、`src/runtime/side-panel.ts`、`side-panel.html` の重複所有解消
- `BuildCandidateQuery` / `CandidateQuery.listBuildEligible` の命名統一
- `openCandidateEditor(prefill)` と `CandidateDraft.sourceInfo` の正式な公開契約化

## Consistent Areas after Application Shell

- `CurrentBuildQuery` と `CandidateQuery.listBuildEligible` を介した読み取り連携の方向性は一致している。
- `confirmed` と `sourceSnapshot` / `sourceInfo` の分離、ページ由来入力を `unknown` から検証する方針は維持されている。
- shell内部のregistry、public API assembly、composition root、runtime adapterの責務分離は明確である。
- maintenance eventを単調増加する `(generation, revision)` cursorで扱う設計により、stale通知と正当な終了通知を識別できる。

## Required Next Step after Re-review

`$kiro-discovery` またはroadmap更新で、次を確定する。

1. 候補mutationとCurrentBuild修復を同一commitへ参加させるtransactional lifecycle seam
2. `ShellNavigator` / `FeatureActivationIntent` によるcross-feature navigation
3. service worker compositionの単一所有者
4. 共通 `Result<T, E>` のcanonical owner
5. feature公開入口の命名規約

上記の境界更新後に既存6specと `application-shell` を更新し、`$kiro-spec-batch` の横断レビューを再実行する。Critical issueおよびarchitecture boundary issueが解消されるまで、`application-shell` を完了済みにしない。
