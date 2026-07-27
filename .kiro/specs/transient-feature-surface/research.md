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

## Open Design Question

完全な`chrome.storage.session`障害時に、ジェスチャー起因openとChrome UIからの直接openをどう識別して通知するかは未確定である。shell specのdesign validationで解決し、下流specへ持ち込まない。

## Validation Focus

- persistent featureの非回帰
- panel closed/open双方の配送
- worker再生成
- watch-ready前後の遷移・閉鎖
- stale generation
- conclude成功/rollback
- storage errorの可視化
