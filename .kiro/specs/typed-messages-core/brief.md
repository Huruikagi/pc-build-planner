# Brief: typed-messages-core

## Problem

複数のChrome拡張やWebアプリで型安全なUI messageを利用したい開発者にとって、現在の`src/ui-messages`は汎用resolver・format・catalog parityと、PC Build Planner固有のカタログ、言語、fallback、release検査、React bindingが同じ境界にある。このままでは製品文言の変更と安定したmessage mechanismの変更影響範囲を分離できない。

## Current State

`MessageDefinition`、placeholder型導出、plural・multi-plural、interpolation、descriptor、catalog parityのprimitiveは実装済みである。一方、resolverは具体的な`MESSAGES`と`MessageKey`へ、language registryはja/enと製品fallbackへ、parity検査はv0.3固有規則へ結合している。React Providerとhookも同じ公開面にあり、workspace package、export map、package単独検証は未導入である。

## Desired Outcome

React、Chrome API、PC Build Planner固有カタログに依存しないtyped messages coreがworkspace packageとして独立し、catalog型と設定からtyped resolverを生成できる。製品側は具体的なja/enカタログ、対応言語、fallback、release規則、configured resolver、React bindingを保持し、既存の表示と言語切替を公開API経由で維持する。

## Approach

汎用の型・format・resolver factory・descriptor・catalog parity primitiveだけをworkspace packageへ抽出する。React adapterは2番目のconsumerで再利用性が確認されるまで製品側に残す。最初のpackageとして`packages/*`登録、`workspace:*`依存、export map、単独typecheck/test、app consumer型fixture、変更種別別の検証scriptを確立する。

## Scope

- **In**: `MessageDefinition`、placeholder抽出とparameter型導出、plural・multi-plural、interpolation、namespace flattening、typed resolver factory、generic descriptor、key・placeholder parity primitive、workspace package構成、公開export、単独typecheck/test、consumer contract、deep import gate。
- **Out**: ja/enの具体的カタログ、具体的`MessageKey`、対応言語、source/fallback language、原語表記、bilingual hint、release固有規則、言語設定保存、browser language解決、React adapterの安定化、npm公開、3言語目の翻訳。

## Boundary Candidates

- catalog shapeからresolver型を導出するReact非依存core
- product catalogとconfigured resolverを所有するapp adapter
- React Providerとhookを所有するapp presentation adapter
- package変更と製品文言変更を分ける検証境界

## Out of Boundary

- UI文言の意味・翻訳・namespace設計
- 表示言語の選択、保存、fallback policy
- Chrome manifestの`_locales`とstore listing
- 外部公開やstable API宣言

## Upstream / Downstream

- **Upstream**: 現行`ui-message-catalog`と`ui-internationalization`の型付きmessage契約、pnpm workspace・TypeScript NodeNext・MV3/CSP制約。
- **Downstream**: `ui-message-catalog`のconfigured consumer、将来の2番目のconsumer、`local-data-library-boundaries`が利用するworkspace・export・検証運用。

## Existing Spec Touchpoints

- **Extends**: `ui-message-catalog`は製品カタログ、具体MessageKey、configured resolver、React bindingを保持し、汎用mechanismを本packageへ委譲する。
- **Adjacent**: `ui-internationalization`は対応言語・fallback・保存・切替を引き続き所有し、本packageを直接言語stateのownerにしない。

## Constraints

Node.js 26、pnpm 11、TypeScript NodeNext、ESMを維持する。`pnpm-workspace.yaml`へpackage pathを登録し、内部依存は`workspace:*`を使う。packageはReact、Chrome API、PCドメイン型、製品カタログへ依存せず、実行時dynamic codeとremote codeを導入しない。外部公開は行わず、2番目のconsumerでAPIを再評価する。
