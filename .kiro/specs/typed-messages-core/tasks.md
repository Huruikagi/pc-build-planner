# Implementation Plan

- [ ] 1. Workspace package基盤を確立する
- [ ] 1.1 最小のprivate workspace package scaffoldを追加する
  - `packages/*`をworkspaceへ登録し、typed messages coreのprivate package metadataとstrictなESM build設定を用意する。
  - package単独のbuild、typecheck、testを後続実装から呼び出せるscript枠と、rootからpackageを先行実行するorchestration入口を設ける。この段階では公開export surfaceやcore実装を確定しない。
  - packageはruntime dependencyを持たず、React、Chrome API、PCドメイン、製品catalog、dynamic code、remote codeを取り込まない構成にする。
  - 完了時、pnpm filterがpackageを一意に認識し、packageのTypeScript設定をstrictなNodeNext ESM projectとして解釈でき、後続sourceを追加できる状態になる。
  - _Requirements: 5.3, 5.4, 5.5, 6.1_
  - _Boundary: WorkspaceValidation_

- [ ] 1.2 catalog駆動のmessage型契約を実装する
  - plain、single plural、multi plural、nested namespaceのdefinition契約と、dot key、definition lookup、placeholder、parameter引数の型導出を実装する。
  - single pluralの`count`とmulti pluralの全selectorを数値として必須化し、placeholderなしのmessageはparameterなしに限定する。
  - catalog genericなnominal descriptor型を、runtimeではkeyと任意paramsだけになるJSON安全なshapeとして定義する。
  - positive/negative型fixtureを追加し、有効な呼び出しは型検査を通り、未知key、欠落・余分parameter、非数値selectorは期待したcompile errorになることを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.2, 3.4, 3.5_
  - _Boundary: MessageContracts_

- [ ] 2. Package coreの純粋mechanismを実装する
- [ ] 2.1 (P) 決定的なmessage formatterを実装する
  - plain文字列、string/number interpolation、single pluralのzero/one/other選択、multi pluralのselector順combination選択を実装する。
  - 専用form、selector、parameterが不足する場合は`other`と未解決placeholderへ安全にfallbackし、例外を送出しない。
  - synthetic definitionだけを使うunit testで全選択規則とfallbackを固定し、同じ入力が常に同じ文字列を返して全件成功することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: MessageFormatter_
  - _Depends: 1.2_

- [ ] 2.2 (P) nested catalog normalizerを実装する
  - 入れ子のnamespaceをdot keyのflat catalogへ変換し、plainとstructured definitionをleafとして保持する。
  - catalog objectを変更せず、空namespaceを含む入力でも決定的な結果を返す。
  - nested、structured、emptyのsynthetic catalogが期待するdot key集合へ変換されるunit testが成功することを完了条件とする。
  - _Requirements: 1.1, 3.1_
  - _Boundary: CatalogNormalizer_
  - _Depends: 1.2_

- [ ] 2.3 (P) catalog genericなdescriptor factoryを実装する
  - catalogから導出されたkeyとparameter契約を適用するconfigured descriptor factoryを提供する。
  - parameterなしではkeyだけ、parameterありではkeyとparamsだけを持つplain valueを返し、製品catalogや言語識別子を埋め込まない。
  - 型fixtureとruntime testでparameter制約、JSON直列化後のplain shape、製品非依存性を観測できることを完了条件とする。
  - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - _Boundary: DescriptorFactory_
  - _Depends: 1.2_

- [ ] 2.4 generic catalog parityを実装する
  - source/targetのmissing key、excess key、全formを対象にしたplaceholder集合不一致を、安定したissue codeとkeyで返す。
  - compile-time parity型を提供し、不一致keyだけを型として識別できるようにする。
  - required release key、bilingual hint、対応言語、source languageなどの製品ruleをcore結果へ含めない。
  - runtime issue testが決定的に成功し、compile-time parity不一致fixtureが期待どおり型検査で拒否されることを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: CatalogParity_
  - _Depends: 1.2, 2.2_

- [ ] 2.5 normalizer、formatter、descriptorをtyped resolverへ統合する
  - 任意のliteral catalogからkey・parameter契約を保持するcallable resolverを生成する。
  - 直接keyを解決する経路とdescriptorを解決する経路を同じformat pipelineへ接続する。
  - runtime unknown keyはkey文字列を返し、throwや製品固有fallbackを行わない。
  - nested typed call、parameter制約、descriptor/direct解決の同値性、unknown key fallbackのtestが成功することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.3_
  - _Boundary: ResolverFactory_
  - _Depends: 2.1, 2.2, 2.3_

- [ ] 3. Package公開面と製品consumerを統合する
- [ ] 3.1 package root exportと単独検証suiteを確定する
  - packageの唯一のpublic entryから型、formatter、normalizer、resolver、descriptor、parityのconsumer向けsymbolだけをnamed exportする。
  - export mapの`.`をbuild済みESM JavaScriptとdeclarationへ対応させ、source、test、内部subpathを公開しない。
  - package単独のbuild、typecheck、testとroot-export smoke testを完成させる。
  - 完了時、全package filter commandとroot importがclean outputから成功し、未公開subpathはmodule resolutionで利用できない。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2_
  - _Boundary: PackagePublicEntry_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 3.2 PC Build Plannerのconfigured message adapterをpackage公開APIへ移行する
  - 製品catalogから具体的な`MessageKey`、resolver、descriptor、`message()`を設定し、既存app公開signatureを維持する。
  - ja/en resolver registry、source/fallback language、原語表記、React Provider/hookを製品側に残し、package root以外をdeep importしない。
  - generic parity issueへrequired release keyとbilingual hintだけを製品側で合成し、旧generic formatter/resolver/parity実装の重複を除去する。
  - app public consumer型検査と既存ui-messages testが成功し、ja/enのresolver結果、descriptor表示、言語切替、React bindingが移行前と同じであることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.5, 5.6, 6.5_
  - _Boundary: AppMessageAdapter_
  - _Depends: 3.1_

- [ ] 3.3 workspace consumer、boundary、topological build gateを接続する
  - package root exportだけでcatalog設定、resolve、descriptor、parityを利用するstrict app consumer fixtureを公開consumer型検査へ追加する。
  - package内部へのdeep import、packageからapp/React/Chrome/製品catalogへの逆依存、公開外subpathをsource boundary negative fixtureで拒否する。
  - root buildと検証をpackage-firstのtopological順序へ接続し、app bundleがbuild済みpackage exportを解決するようにする。
  - 完了時、clean package outputからtopological buildが成功し、core変更の検証経路がpackage単独gate、consumer contract、boundary gateの失敗を取りこぼさない。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4, 6.6_
  - _Boundary: WorkspaceValidation_
  - _Depends: 3.1, 3.2_

- [ ] 4. 変更種別別の検証と完全回帰を確定する
- [ ] 4.1 core変更とproduct catalog変更の検証scriptを分離する
  - core contract/runtime変更用scriptにpackage build・typecheck・test、app consumer contract、boundary gateを含める。
  - product catalog/release rule変更用scriptに製品parity、configured adapter、表示回帰を含め、generic coreの無関係なapp-wide統合検証を最小経路の必須条件にしない。
  - 既存の完全検証は両経路を包含し、どちらかの失敗を成功として扱わない。
  - tooling testが各scriptの構成と失敗伝播を確認し、core経路とcatalog-only経路が意図したgate集合を実行することを完了条件とする。
  - _Requirements: 6.4, 6.5, 6.6_
  - _Boundary: WorkspaceValidation, AppMessageAdapter_
  - _Depends: 3.2, 3.3_

- [ ] 4.2 packageとappの完全回帰を実行する
  - package単独build・typecheck・test、root typecheck、public consumer、lint、boundary、runtime schema、fixture、build、unit/integration、既存ja/en E2Eを実行する。
  - app bundleにReact/Chrome/製品catalogへのpackage逆依存、dynamic/remote code、未公開subpath、重複generic implementationが含まれないことを機械検査する。
  - PC Build Plannerの表示、言語切替、plural、descriptor、fallbackが変わらず、package parityと製品release parityの両方が成功することを確認する。
  - 完了時、`pnpm validate`が成功し、package単独性、topological build、consumer契約、既存UI非回帰のfresh evidenceが揃う。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: WorkspaceValidation, AppMessageAdapter_
  - _Depends: 4.1_
