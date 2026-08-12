# Research & Design Decisions

## Summary

- **Feature**: `typed-messages-core`
- **Discovery Scope**: Extension（既存システムからのintegration-focused extraction）
- **Key Findings**:
  - 現行`src/ui-messages`の汎用mechanismは`contracts.ts`、`format.ts`、`resolver.ts`、`catalog-parity.ts`に存在するが、resolverとparityが具体的な日本語catalog、`MessageKey`、v0.3 release規則へ結合している。
  - React binding、対応言語、fallback、configured resolver、製品parityは`ui-message-catalog`の製品policyであり、本specでは移行・変更しない。
  - repositoryはまだ単一package構成である。最初のworkspace packageにはpackage単独のbuild/typecheck/test、export map、syntheticなread-only consumer、topological build、deep import gateを同時に導入する必要がある。
  - **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`。generic packageとread-only fixtureだけをIn scopeとし、製品adapter・catalog・validation・runtime wiring・表示回帰をOut of scopeとして確定した。

## Research Log

### 現行message mechanismの分離可能性

- **Context**: 既存実装のどこまでが製品非依存かを判定した。
- **Sources Consulted**: `src/ui-messages/contracts.ts`、`format.ts`、`resolver.ts`、`catalog-parity.ts`、`languages.ts`、`message-context.ts`、`catalog/{ja,en}`、`tests/ui-messages/*`。
- **Findings**:
  - `MessageDefinition`、placeholder/key導出、single/multi plural、interpolationはDOM・React・Chrome APIを使わない純粋なTypeScriptである。
  - `resolver.ts`の型aliasとfactoryは再利用可能だが、具体的な`MESSAGES`と`MessageKey`を直接importしている。factoryをcatalog genericへ閉じれば結合を除去できる。
  - `catalog-parity.ts`のkey・placeholder比較は汎用だが、required v0.3 keyとbilingual hint判定は製品release policyである。
  - 現行`MessageDescriptor`のnominal brandは実行時propertyを持たず、値は`key`と任意`params`だけなのでJSON直列化可能性を維持できる。
- **Implications**: 汎用部分は独立packageへ実装するが、具体catalogを設定するresolver/descriptor、release固有parity、既存app公開面の変更は`ui-message-catalog`へ委譲する。本specのconsumer evidenceは製品実装を変更しないfixtureに限定する。

### workspaceと公開境界の現状

- **Context**: 最初のworkspace packageとして必要なrepository変更を特定した。
- **Sources Consulted**: `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`tsconfig.public-consumer.json`、`scripts/build.mjs`、`scripts/validate-boundaries.mjs`、`tests/tooling/public-boundaries.test.ts`、`tests/tooling/public-api-consumer.ts`。
- **Findings**:
  - `pnpm-workspace.yaml`はpackage pathを未登録で、root scriptsはapp単体を直接検証する。
  - 公開consumerとdeep import拒否は既存のTypeScript fixtureとAST boundary scannerで確立済みであり、package境界にも同じ方式を拡張できる。
  - root build orchestrationにはpackageを先にbuildするtopological順序が必要だが、製品message runtimeをpackageへ切り替える必要はない。
  - package単独testは既存方針どおり`node:test`、`node:assert/strict`、`tsx`を利用でき、新しいtest runnerは不要である。
- **Implications**: workspace registration、package scripts、root orchestration、read-only consumer fixture、boundary negative fixtureを一つのfoundation waveとして扱い、`src/ui-messages/**`を変更対象に含めない。

### 依存・セキュリティ適合性

- **Context**: MV3/CSPと汎用性を損なう依存が必要か確認した。
- **Sources Consulted**: `.kiro/steering/tech.md`、`security.md`、`testing.md`、現行message実装とroot dependency一覧。
- **Findings**:
  - 抽出対象は標準JavaScriptとTypeScript型だけで完結し、新しいruntime dependencyは不要である。
  - dynamic code、remote code、DOM、storage、Chrome namespaceを必要としない。
  - package test fixtureは短い架空messageだけで構成でき、実サイト由来データを必要としない。
- **Implications**: packageの`dependencies`は空にし、development toolingだけをdevDependencyに置く。CSP上の新規riskを導入しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 現行moduleをそのまま移動 | `src/ui-messages`全体をpackage化 | 移動が単純 | React、言語、製品catalogまで公開境界へ混入する | 不採用 |
| 汎用core + read-only fixture | 純粋mechanismだけをpackage化し、製品policyとruntimeは変更しない | owner重複なしでpackage契約を独立検証できる | 製品採用は後続specまで発生しない | 採用 |
| 多数の小packageへ分割 | format、resolver、parityを別package化 | package単位の分離が最大 | 最初のconsumerに対して運用とversion面が過剰 | 不採用 |

## Design Decisions

### Decision: 単一private workspace packageを汎用mechanismのownerにする

- **Context**: 最初のworkspace運用を確立しつつpackage数を先に固定しない必要がある。
- **Alternatives Considered**:
  1. `src/ui-messages`のまま内部moduleを整理する。
  2. mechanism全体を一つのprivate workspace packageへ抽出する。
  3. format、resolver、parityを別packageにする。
- **Selected Approach**: `packages/typed-messages-core`を単一ownerとし、package nameを`@pc-build-planner/typed-messages-core`、`private: true`とする。
- **Rationale**: roadmapの先行実証目的を満たし、外部stable APIを約束せずにworkspace、export map、独立検証を確立できる。
- **Trade-offs**: package内では複数の密接なprimitiveをまとめるが、すべて「catalogから型付きmessageを解決する」という一責務に閉じる。
- **Follow-up**: 2番目のconsumer導入時にpackage名、公開symbol、semver方針を再評価する。

### Decision: catalog genericなfactoryを公開し、製品設定は後続ownerへ委譲する

- **Context**: 現行resolverとdescriptor生成は具体的な`MessageKey`へ結合している。
- **Alternatives Considered**:
  1. `string` keyを受ける非型付きresolver。
  2. 呼び出しごとにcatalog genericを明示する独立関数群。
  3. catalogからresolverとdescriptor factoryを生成するconfigured API。
- **Selected Approach**: `createMessageResolver(catalog)`と`createMessageDescriptorFactory<Catalog>()`を公開し、`MessageResolver<Catalog>`と`MessageDescriptor<Catalog>`を同じ型導出規則へ接続する。synthetic fixtureだけで公開契約を検証する。
- **Rationale**: generic APIを製品catalogから独立して証明でき、configured app adapterのcanonical ownerと競合しない。
- **Trade-offs**: 本spec完了時点では製品runtimeはpackageを採用しないが、package境界と型契約は独立して検証できる。
- **Follow-up**: `ui-message-catalog`が採用時に既存の`message()`と`defaultMessageResolver`の公開signatureを維持する。

### Decision: parityをmechanismとpolicyへ分ける

- **Context**: key・placeholder整合は汎用だが、required release keyとbilingual hintはPC Build Planner固有である。
- **Alternatives Considered**:
  1. 現行parity optionsをすべてpackageへ移す。
  2. key・placeholder issueだけをpackageへ移し、製品ruleをapp側で合成する。
- **Selected Approach**: packageは`missing-key`、`excess-key`、`placeholder-mismatch`だけを安定codeとして返す。compile-time parity型も同じ構造範囲に限定し、製品ruleの合成や検証scriptは実装しない。
- **Rationale**: coreの責務を言語・release policy非依存に保てる。
- **Trade-offs**: 製品側parity検査の統合は`ui-message-catalog`の更新まで延期される。
- **Follow-up**: `ui-message-catalog`更新時に既存v0.3 ruleの非回帰を検証する。

### Decision: build済み公開成果物をconsumer境界にする

- **Context**: export mapとtopological buildを実際に検証し、source deep importで迂回させない必要がある。
- **Alternatives Considered**:
  1. export mapをpackage sourceへ向ける。
  2. packageをTypeScriptでbuildし、`dist/index.js`と`dist/index.d.ts`だけをexportする。
- **Selected Approach**: package単独buildでESM JavaScriptとdeclarationを生成し、read-only fixtureはpackage build後に`workspace:*` dependencyのexport mapから解決する。
- **Rationale**: 製品実装を書き換えず、実consumerと同じroot export境界を検証できる。
- **Trade-offs**: root validationにpackage build前提が増えるため、scriptで順序を固定する。
- **Follow-up**: clean checkoutからtopological buildとread-only consumer typecheckが再現できることを検証する。

## Risks & Mitigations

- 型導出の移植で公開parameter判定が誤る — compile-time positive/negative fixtureとread-only consumer contractで固定する。
- 製品実装とpackage実装が一時的に重複する — 本specでは製品側を変更・削除せず、後続`ui-message-catalog`が移行責任を持つことを境界とtaskで固定する。
- export mapをsource deep importで迂回する — package export map、source scanner、negative fixtureの三段で拒否する。
- root commandがpackage buildを暗黙に要求する — package単独commandとtopological root scriptを明示し、clean outputからの検証をtooling testで固定する。
- package変更とcatalog-only変更の検証範囲が再び混ざる — core scriptはpackage・read-only fixture・boundaryだけを含め、product-only検証は`ui-message-catalog`へ委譲する。

## References

- `.kiro/specs/typed-messages-core/brief.md` — feature-local scopeと境界候補。
- `.kiro/steering/roadmap.md` — v0.5.0のworkspace制約とdependency order。
- `.kiro/steering/tech.md` — Node、pnpm、TypeScript、ESM、MV3/CSP、検証方針。
- `.kiro/steering/structure.md` —公開入口とdeep import規約。
- `.kiro/steering/security.md` — dynamic/remote code禁止と機械検査方針。
- `.kiro/steering/testing.md` — `node:test`とfixture規約。
