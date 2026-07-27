# Research: transient-feature-surface

## 分割メモ

2026-07-27、旧specがshell/runtime基盤とproduct-capture移行を同時に所有しdesignが約900行へ拡大したため、責務を分割した。本書はshell/runtime側の調査だけを保持する。capture/candidate側は `../product-capture-transient-migration/research.md` を参照する。

## Existing Assets

- `src/application-shell/contracts.ts`: `ApplicationFeatureRegistration`、typed activation、`SidePanelHost`契約
- `src/application-shell/application-composition.ts`: 全登録featureをナビ項目へ変換
- `src/application-shell/side-panel-host.ts`: select/activateの直列transition、activation失敗時rollback
- `src/application-shell/feature-registry.ts`: 登録shape検証とavailability障害分離
- `src/runtime/service-worker.ts`: `action.onClicked`から`sidePanel.open()`を同期開始
- `src/runtime/open-side-panel.ts`: ユーザージェスチャー内の同期呼び出し制約
- `scripts/validate-artifacts.mjs`: 4権限固定
- `scripts/validate-boundaries.mjs`: `chrome.storage`到達点allowlist

## Key Findings

1. 登録済みfeatureと常設ナビ項目が1:1であり、一過性区分を表現できない。
2. `sidePanel.open()`は有効なジェスチャー内で同期開始する必要がある。
3. MV3 workerのメモリや長命portの存在だけを配送保証にできない。
4. `chrome.tabs.onUpdated` / `onRemoved`はURLを読まなければ追加`tabs`権限なしで利用できる。
5. hostの既存activation rollbackは汎用`conclude`の実装基盤として利用できる。
6. worker監視からpanel監視への移管には空白を作らないhandshakeが必要である。

## Selected Boundary

- shell: registration、navigation filtering、controller、return target、generic handoff
- runtime: activation delivery、tab lifecycle event mapping
- downstream feature: business payload、UI、実行状態

## Design Decisions

### Session媒体障害は起動契機を識別せずshell障害として提示する

- `read()`が`err`なら「セッション領域が利用不能」という再操作可能な理由を提示する。
- noticeは常設featureを置換するglobal errorではなく、常設面と併存する一過性起動bannerとして表示する。
- `put()`が`err`なら同じ媒体へ失敗recordを書かず、storage非依存のChrome action badge/titleで理由を残す。
- 2.7は安全に成立しない理由の提示を要求し、ジェスチャー起因かどうかの識別を要求しない。
- Chrome UIからの直接openと媒体障害が重なると不要な障害表示が出る残余リスクを受容する。

### 起動と失効は単調増加seqと墓標で順序付ける

- workerの単一スケジューラがイベント受信時に`seq`を割り当て、session envelopeへ順序状態を保持する。
- `invalidate`はrecord不在でも墓標を残し、後から適用される古いrecordを`invalidated`へ着地させる。
- Promise chain内で後発commandが先発writeを追い越すとは仮定しない。watch-ready後の最終許可を同じschedulerへ通し、panel監視との重複期間で監視空白を閉じる。

### production E2Eは最初の実featureへ委譲する

- shell specはproduction bundleへテスト専用featureを混入させず、in-memory fixtureのcontract/runtime integrationを所有する。
- Chrome 116以降の主要動線は`product-capture-transient-migration`の実product-capture登録と5.5 E2Eで、shell 4.5も合わせて検証する。

### composition循環とwatch-ready transportはshell内部portで閉じる

- feature factoryへは既存`ShellNavigator`と同型のlate-bound lifecycle proxyを渡し、host構築後にcontrollerへbindする。
- watch-readyはpayloadなしの既存worker registrationを流用せず、versioned request/responseとsender検証を持つ専用runtime adapterで配送する。
- controller concrete class、proxyのbind操作、Chrome message payloadは下流へ公開しない。

## Validation Focus

- persistent featureの非回帰
- panel closed/open双方の配送
- worker再生成
- watch-ready前後の遷移・閉鎖
- `put()`保留中の失効墓標と最終許可拒否
- stale generation
- conclude成功/rollback
- storage errorの可視化
- late-bound lifecycleのbind前・unbind後fail-closed
- watch-ready runtime messageのsender/payload/response検証
- production artifactへテスト専用featureが混入しないこと
