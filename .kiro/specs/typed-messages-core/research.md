# Research & Design Decisions

## Summary

- **Feature**: `typed-messages-core`
- **Discovery Scope**: Extension（既存システムからのintegration-focused extraction）
- **Key Findings**:
  - 現行`src/ui-messages`の汎用mechanismは`contracts.ts`、`format.ts`、`resolver.ts`、`catalog-parity.ts`に存在するが、resolverとparityが具体的な日本語catalog、`MessageKey`、v0.3 release規則へ結合している。
  - React binding、対応言語、fallback、configured resolverは製品policyであり、汎用packageへ移す必要がない。coreの公開APIを設定する薄いapp adapterを残せば既存consumerの公開面を維持できる。
  - repositoryはまだ単一package構成である。最初のworkspace packageにはpackage単独のbuild/typecheck/test、export map、`workspace:*` consumer、topological build、deep import gateを同時に導入する必要がある。

## Research Log

### 現行message mechanismの分離可能性

- **Context**: 既存実装のどこまでが製品非依存かを判定した。
- **Sources Consulted**: `src/ui-messages/contracts.ts`、`format.ts`、`resolver.ts`、`catalog-parity.ts`、`languages.ts`、`message-context.ts`、`catalog/{ja,en}`、`tests/ui-messages/*`。
- **Findings**:
  - `MessageDefinition`、placeholder/key導出、single/multi plural、interpolationはDOM・React・Chrome APIを使わない純粋なTypeScriptである。
  - `resolver.ts`の型aliasとfactoryは再利用可能だが、具体的な`MESSAGES`と`MessageKey`を直接importしている。factoryをcatalog genericへ閉じれば結合を除去できる。
  - `catalog-parity.ts`のkey・placeholder比較は汎用だが、required v0.3 keyとbilingual hint判定は製品release policyである。
  - 現行`MessageDescriptor`のnominal brandは実行時propertyを持たず、値は`key`と任意`params`だけなのでJSON直列化可能性を維持できる。
- **Implications**: 汎用部分を移植し、具体catalogを設定するresolver/descriptorをapp adapterで再公開する。release固有parityはapp側でgeneric issueへ追加する。

### workspaceと公開境界の現状

- **Context**: 最初のworkspace packageとして必要なrepository変更を特定した。
- **Sources Consulted**: `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`tsconfig.public-consumer.json`、`scripts/build.mjs`、`scripts/validate-boundaries.mjs`、`tests/tooling/public-boundaries.test.ts`、`tests/tooling/public-api-consumer.ts`。
- **Findings**:
  - `pnpm-workspace.yaml`はpackage pathを未登録で、root scriptsはapp単体を直接検証する。
  - 公開consumerとdeep import拒否は既存のTypeScript fixtureとAST boundary scannerで確立済みであり、package境界にも同じ方式を拡張できる。
  - app production buildはesbuildでbundleされるため、packageを先にbuildしてexport mapの公開成果物から解決するtopological順序が必要である。
  - package単独testは既存方針どおり`node:test`、`node:assert/strict`、`tsx`を利用でき、新しいtest runnerは不要である。
- **Implications**: workspace registration、package scripts、root orchestration、consumer fixture、boundary negative fixtureを一つのfoundation waveとして扱う。

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
| 汎用core + app configured adapter | 純粋mechanismだけをpackage化し、製品policyを`src/ui-messages`に残す | 境界が明確で既存表示を維持できる | 一時的にadapterとcoreの2層が必要 | 採用 |
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

### Decision: catalog genericなconfigured factoryを公開する

- **Context**: 現行resolverとdescriptor生成は具体的な`MessageKey`へ結合している。
- **Alternatives Considered**:
  1. `string` keyを受ける非型付きresolver。
  2. 呼び出しごとにcatalog genericを明示する独立関数群。
  3. catalogからresolverとdescriptor factoryを生成するconfigured API。
- **Selected Approach**: `createMessageResolver(catalog)`と`createMessageDescriptorFactory<Catalog>()`を公開し、`MessageResolver<Catalog>`と`MessageDescriptor<Catalog>`を同じ型導出規則へ接続する。
- **Rationale**: app adapterが一度だけ製品catalogを設定し、既存consumerへ具体型を再公開できる。
- **Trade-offs**: descriptor factoryの設定コードはapp側に残るが、coreに製品catalog singletonを持ち込まずに済む。
- **Follow-up**: app移行時に既存の`message()`と`defaultMessageResolver`の公開signatureが維持されることをconsumer fixtureで確認する。

### Decision: parityをmechanismとpolicyへ分ける

- **Context**: key・placeholder整合は汎用だが、required release keyとbilingual hintはPC Build Planner固有である。
- **Alternatives Considered**:
  1. 現行parity optionsをすべてpackageへ移す。
  2. key・placeholder issueだけをpackageへ移し、製品ruleをapp側で合成する。
- **Selected Approach**: packageは`missing-key`、`excess-key`、`placeholder-mismatch`だけを安定codeとして返す。compile-time parity型も同じ構造範囲に限定する。
- **Rationale**: coreの責務を言語・release policy非依存に保てる。
- **Trade-offs**: app側parity検査がgeneric結果とrelease固有結果を合成する必要がある。
- **Follow-up**: `ui-message-catalog`更新時に既存v0.3 ruleの非回帰を検証する。

### Decision: build済み公開成果物をconsumer境界にする

- **Context**: export mapとtopological buildを実際に検証し、source deep importで迂回させない必要がある。
- **Alternatives Considered**:
  1. export mapをpackage sourceへ向ける。
  2. packageをTypeScriptでbuildし、`dist/index.js`と`dist/index.d.ts`だけをexportする。
- **Selected Approach**: package単独buildでESM JavaScriptとdeclarationを生成し、root app build/typecheckはpackage build後に`workspace:*` dependencyのexport mapから解決する。
- **Rationale**: 実際のconsumerと同じ公開境界を開発時にも検証できる。
- **Trade-offs**: root validationにpackage build前提が増えるため、scriptで順序を固定する。
- **Follow-up**: clean checkoutからtopological buildとapp consumer typecheckが再現できることを検証する。

## Risks & Mitigations

- 型導出の移植で既存consumerのparameter判定が変わる — compile-time positive/negative fixtureとapp consumer contractで固定する。
- app adapterへ製品policyを残す際にcore実装が重複する — app側はcatalog設定とpolicy合成だけに限定し、format/resolver/parity実装の重複をboundary testで拒否する。
- export mapをsource deep importで迂回する — package export map、source scanner、negative fixtureの三段で拒否する。
- root commandがpackage buildを暗黙に要求する — package単独commandとtopological root scriptを明示し、clean outputからの検証をtooling testで固定する。
- package変更とcatalog-only変更の検証範囲が再び混ざる —変更種別別scriptをpackage.jsonに置き、tooling testで含まれるgateを検査する。

## References

- `.kiro/specs/typed-messages-core/brief.md` — feature-local scopeと境界候補。
- `.kiro/steering/roadmap.md` — v0.5.0のworkspace制約とdependency order。
- `.kiro/steering/tech.md` — Node、pnpm、TypeScript、ESM、MV3/CSP、検証方針。
- `.kiro/steering/structure.md` —公開入口とdeep import規約。
- `.kiro/steering/security.md` — dynamic/remote code禁止と機械検査方針。
- `.kiro/steering/testing.md` — `node:test`とfixture規約。
