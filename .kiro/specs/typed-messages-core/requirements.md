# Requirements Document

## Introduction

typed messages coreは、複数のChrome拡張やWebアプリで再利用できる、カタログ駆動の型安全なメッセージ機構を提供する。PC Build Plannerで実証済みのmessage definition、placeholder型導出、plural選択、interpolation、descriptor、catalog parityを製品policyから分離し、開発者が製品固有のカタログと言語規則を持ち込んで利用できるworkspace packageとして確立する。

## Boundary Context

- **In scope**: 汎用message definition、カタログからのkey・parameter型導出、format、typed resolver factory、generic descriptor、key・placeholder parity、workspace packageの公開境界、package単独検証、公開APIだけを使うconsumer contract、変更種別ごとの検証範囲。
- **Out of scope**: PC Build Planner固有のja/enカタログと具体的なMessageKey、対応言語、source/fallback language、原語表記、bilingual hint、release固有規則、表示言語の選択・保存、browser language解決、React binding、npm公開、3言語目の翻訳。
- **Adjacent expectations**: `ui-message-catalog`は本coreの公開契約を設定するconfigured app adapter、製品カタログ、release規則、製品validation、React bindingを単独で所有し、`ui-internationalization`は言語stateとfallback policyを引き続き所有する。本specのconsumer contractは製品実装を変更しないread-only fixtureに限定する。

## Change Integration Context

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: generic型とresolver/descriptor factoryはRequirements 1・3、formatはRequirement 2、parity primitiveはRequirement 4、package公開入口・workspace build・deep import gate・read-only consumer fixtureはRequirements 5・6で扱う。
- **Out-of-scope preservation**: configured app adapter、ja/en catalog、release固有parity合成、React binding、製品runtime wiring、製品表示回帰は本requirementsへ追加せず、隣接する`ui-message-catalog`の責務として保持する。

## Requirements

### Requirement 1: カタログから導出される型付き契約

**Objective:** As a message catalog developer, I want カタログ定義からkeyとparameterの型が導出されること, so that 文言追加や変更をconsumerの型検査へ即座に反映できる

#### Acceptance Criteria

1. When 開発者が入れ子のmessage catalogを定義する, the typed messages core shall 全leafからdot区切りのmessage key集合を導出する
2. When message定義がplaceholderを含む, the typed messages core shall 対応するparameter名と値の型をresolver呼び出しへ要求する
3. When message定義が単一数量のpluralである, the typed messages core shall 数値の`count` parameterをresolver呼び出しへ要求する
4. When message定義が複数数量のpluralである, the typed messages core shall 宣言された全selectorに数値parameterをresolver呼び出しへ要求する
5. If consumerが未知のkey、欠落parameter、余分なparameter、またはselectorへ非数値を渡す, the typed messages core shall consumerの型検査を失敗させる
6. When message定義がplaceholderもselectorも持たない, the typed messages core shall parameterなしのresolver呼び出しだけを受け入れる

### Requirement 2: 決定的なメッセージ整形

**Objective:** As a message consumer developer, I want 同じdefinitionとparameterから同じ文字列が得られること, so that frameworkや製品policyに依存せず表示結果を予測できる

#### Acceptance Criteria

1. When plain messageが解決される, the typed messages core shall 定義された文字列を変更せず返す
2. When placeholderを持つmessageがparameter付きで解決される, the typed messages core shall 各placeholderを対応する文字列または数値で置換する
3. When 単一数量のplural messageが解決される, the typed messages core shall `zero`、`one`、`other`の順序規則に従い、該当する専用formがなければ`other`へfallbackする
4. When 複数数量のplural messageが解決される, the typed messages core shall selector宣言順のcategory組み合わせに一致するformを選び、一致するformがなければ`other`へfallbackする
5. If 実行時入力に必要なparameterが欠けている, the typed messages core shall 例外を送出せず、選択可能なfallback formと未解決placeholderを保持した決定的な文字列を返す
6. If resolverが実行時に未知のkeyを受け取る, the typed messages core shall 例外を送出せず、そのkey文字列を返す

### Requirement 3: Catalog設定可能なresolverとdescriptor

**Objective:** As an application adapter developer, I want 任意の互換catalogからtyped resolverとmessage descriptorを生成できること, so that 製品固有policyをcoreへ組み込まずロジック層と表示層を接続できる

#### Acceptance Criteria

1. When 開発者がcatalogをresolver factoryへ設定する, the typed messages core shall そのcatalogから導出されたkey・parameter契約を持つresolverを返す
2. When ロジック層がmessage descriptorを生成する, the typed messages core shall catalog由来のkey・parameter契約を同じように適用する
3. When 表示層がdescriptorをresolverへ渡す, the typed messages core shall descriptorのkeyとparameterを使って通常のresolver呼び出しと同じ文字列を返す
4. The typed messages core shall descriptorをkeyと任意parameterだけからなるJSON直列化可能な値として扱う
5. The typed messages core shall 特定製品のcatalog、具体的なmessage key、または言語識別子をresolverとdescriptorの汎用契約へ固定しない

### Requirement 4: 再利用可能なcatalog parity検査

**Objective:** As a localized catalog maintainer, I want catalog間の構造的不一致を汎用的に検出できること, so that 製品固有の翻訳規則とは独立してkeyとplaceholderの整合性を保てる

#### Acceptance Criteria

1. When source catalogとtarget catalogが比較される, the typed messages core shall targetで欠落しているkeyを識別する
2. When source catalogとtarget catalogが比較される, the typed messages core shall targetだけに存在する余分なkeyを識別する
3. When 同じkeyのplaceholder集合がcatalog間で異なる, the typed messages core shall placeholder不一致をkeyと安定したissue codeで識別する
4. When catalog shapeがcompile-time parity契約へ渡される, the typed messages core shall 不一致keyを型検査で識別できる契約を提供する
5. The typed messages core shall required release key、bilingual hint、対応言語、source languageなどの製品固有規則を汎用parity結果へ組み込まない

### Requirement 5: 独立したpackage公開境界

**Objective:** As a workspace consumer developer, I want 明示された公開入口だけからcoreを利用できること, so that package内部の変更と製品policyの変更を分離できる

#### Acceptance Criteria

1. When workspace consumerがtyped messages coreを利用する, the workspace shall packageの公開入口から必要な型とruntime能力を解決する
2. If consumerがpackage内部moduleをdeep importする, the workspace validation shall その依存を拒否する
3. The typed messages core shall React、Chrome API、PCドメイン型、PC Build Planner固有catalogへのruntime依存または型依存を持たない
4. The typed messages core shall dynamic code evaluation、remote code、または実行時downloadを必要としない
5. While typed messages coreが最初のworkspace consumerだけで利用されている, the workspace shall packageをprivateかつ外部stable API未宣言として扱う
6. When read-only consumer contractが型検査される, the workspace shall 製品実装を変更せず、公開入口だけでsynthetic catalogの設定、resolver呼び出し、descriptor生成、parity検査を利用できることを示す

### Requirement 6: 独立検証と変更影響の分離

**Objective:** As a repository maintainer, I want package単独検証とconsumer検証を再現可能に実行できること, so that 変更内容に応じた最小範囲と統合範囲を明確に判断できる

#### Acceptance Criteria

1. When typed messages coreの単独typecheckが実行される, the workspace shall app sourceを同時検査しなくても公開型と内部実装を検証する
2. When typed messages coreの単独testが実行される, the workspace shall plain、interpolation、single plural、multi plural、descriptor、parityの正常系とfallbackを決定的に検証する
3. When workspaceのtopological buildが実行される, the workspace shall consumerより先にtyped messages coreをbuildし、consumerが公開成果物を解決できる状態にする
4. When typed messages coreの公開契約またはruntime実装が変更される, the workspace validation shall package単独検証、read-only consumer contract、公開境界gateを実行する
5. When PC Build Planner固有のcatalog値、release規則、configured adapter、または表示だけが変更される, the workspace validation shall typed messages coreの製品validationを実行せず、隣接する製品ownerが定める検証へ委譲できる
6. If package単独検証、consumer contract、topological build、または公開境界gateのいずれかが失敗する, the workspace validation shall 成功として完了しない
