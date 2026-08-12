# Implementation Plan

## Change Integration Context

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: Tasks 1–2がgeneric型・format・resolver/descriptor factory・parity primitive、Task 3.1がpackage公開入口、Task 3.2がpackage単独検証、Task 3.3がworkspace link・build・deep import gate・read-only consumer fixture、Tasks 4.1–4.2がgeneric package検証を扱う。
- **Out-of-scope preservation**: configured app adapter、ja/en catalog、release固有parity合成、React binding、製品runtime wiring、製品表示回帰を実装taskまたは検証taskへ含めない。

- [ ] 1. Workspace package基盤を確立する
- [x] 1.1 最小のprivate workspace package scaffoldを追加する
  - `packages/*`をworkspaceへ登録し、typed messages coreのprivate package metadataとstrictなESM build設定を用意する。
  - package単独のbuild、typecheck、testを後続実装から呼び出せるscript枠を設ける。この段階ではroot orchestration、公開export surface、core実装を確定しない。
  - packageはruntime dependencyを持たず、React、Chrome API、PCドメイン、製品catalog、dynamic code、remote codeを取り込まない構成にする。
  - 完了時、pnpm filterがpackageを一意に認識し、packageのTypeScript設定をstrictなNodeNext ESM projectとして解釈でき、後続sourceを追加できる状態になる。
  - _Requirements: 5.3, 5.4, 5.5, 6.1_
  - _Boundary: WorkspaceValidation_

- [x] 1.2 catalog definitionとkey導出の型基盤を実装する
  - plain、single plural、multi plural、nested namespaceのdefinition契約を定義する。
  - 全leafからdot keyとdefinition lookupを導出し、製品catalogや言語識別子へ固定しない。
  - synthetic nested catalogの型fixtureで有効keyが解決され、未知keyが期待したcompile errorになることを完了条件とする。
  - _Requirements: 1.1, 1.5, 3.5_
  - _Boundary: MessageContracts_

- [x] 1.3 parameterとdescriptorの型契約を完成する
  - placeholder、single pluralの`count`、multi pluralの全selectorからparameter引数を導出し、placeholderなしのmessageをparameterなしに限定する。
  - catalog genericなnominal descriptor型を、runtimeではkeyと任意paramsだけになるJSON安全なshapeとして定義する。
  - positive/negative型fixtureで欠落・余分parameter、非数値selector、descriptor契約を検査し、有効呼び出しだけが型検査を通ることを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 3.2, 3.4, 3.5_
  - _Boundary: MessageContracts_

- [ ] 2. Package coreの純粋mechanismを実装する
- [ ] 2.1 (P) 決定的なmessage formatterを実装する
  - plain文字列、string/number interpolation、single pluralのzero/one/other選択、multi pluralのselector順combination選択を実装する。
  - 専用form、selector、parameterが不足する場合は`other`と未解決placeholderへ安全にfallbackし、例外を送出しない。
  - synthetic definitionだけを使うunit testで全選択規則とfallbackを固定し、同じ入力が常に同じ文字列を返して全件成功することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: MessageFormatter_
  - _Depends: 1.3_

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
  - _Depends: 1.3_

- [ ] 2.4 generic catalog parityを実装する
  - source/targetのmissing key、excess key、全formを対象にしたplaceholder集合不一致を、安定したissue codeとkeyで返す。
  - compile-time parity型を提供し、不一致keyだけを型として識別できるようにする。
  - required release key、bilingual hint、対応言語、source languageなどの製品ruleをcore結果へ含めない。
  - runtime issue testが決定的に成功し、compile-time parity不一致fixtureが期待どおり型検査で拒否されることを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: CatalogParity_
  - _Depends: 1.3, 2.2_

- [ ] 2.5 normalizer、formatter、descriptorをtyped resolverへ統合する
  - 任意のliteral catalogからkey・parameter契約を保持するcallable resolverを生成する。
  - 直接keyを解決する経路とdescriptorを解決する経路を同じformat pipelineへ接続する。
  - runtime unknown keyはkey文字列を返し、throwや製品固有fallbackを行わない。
  - nested typed call、parameter制約、descriptor/direct解決の同値性、unknown key fallbackのtestが成功することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.3_
  - _Boundary: ResolverFactory_
  - _Depends: 2.1, 2.2, 2.3_

- [ ] 3. Package公開面とread-only consumerを統合する
- [ ] 3.1 package root exportを確定する
  - packageの唯一のpublic entryから型、formatter、normalizer、resolver、descriptor、parityのconsumer向けsymbolだけをnamed exportする。
  - export mapの`.`をbuild済みESM JavaScriptとdeclarationへ対応させ、source、test、内部subpathを公開しない。
  - packageをprivateかつruntime dependencyなしに保ち、公開成果物へ内部source、test、製品型を含めない。
  - 完了時、build済みroot importだけが公開symbolを解決し、未公開subpathはmodule resolutionで利用できない。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: PackagePublicEntry_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 3.2 package単独検証suiteを完成する
  - packageだけを対象にbuild、typecheck、testを実行するfilter commandとroot-export smoke testを完成させる。
  - plain、interpolation、single plural、multi plural、descriptor、parityの正常系とfallbackをsynthetic fixtureで検証する。
  - 完了時、app sourceを同時検査せずに全package commandがclean outputから成功し、失敗時はnon-zeroで終了する。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.6_
  - _Boundary: WorkspaceValidation_
  - _Depends: 3.1_

- [ ] 3.3 workspace consumer、boundary、topological build gateを接続する
  - root workspaceからpackageへ`workspace:*`でlinkし、lockfileへworkspace解決を記録する。
  - package root exportだけでsynthetic catalogの設定、resolve、descriptor、parityを利用するread-only consumer fixtureを公開consumer型検査へ追加する。
  - fixtureは製品catalog、configured adapter、React binding、製品runtime wiringをimport・変更せず、generic契約だけを読み取る。
  - package内部へのdeep import、packageからapp/React/Chrome/製品catalogへの逆依存、公開外subpathをsource boundary negative fixtureで拒否する。
  - root buildと検証をpackage-firstのtopological順序へ接続し、read-only fixtureがbuild済みpackage exportを解決するようにする。
  - 完了時、clean package outputからtopological buildが成功し、core変更の検証経路がpackage単独gate、consumer contract、boundary gateの失敗を取りこぼさない。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: WorkspaceValidation_
  - _Depends: 3.2_

- [ ] 4. Generic packageの検証境界を確定する
- [ ] 4.1 core変更用の検証scriptを確立する
  - 既存のpackage単独command、read-only consumer contract、boundary gateをcore contract/runtime変更用の一つの集約scriptから順に呼び出す。
  - product catalog、release rule、configured adapter、表示回帰の検証はこのscriptへ取り込まず、`ui-message-catalog`の製品ownerへ委譲する。
  - 既存の完全検証へpackage-first順序を接続し、package側gateの失敗を成功として扱わない。
  - tooling testがcore scriptのgate集合、product-only検証の非所有、失敗伝播を確認することを完了条件とする。
  - _Requirements: 6.4, 6.5, 6.6_
  - _Boundary: WorkspaceValidation_
  - _Depends: 3.3_

- [ ] 4.2 package境界のfresh regressionを実行する
  - package単独build・typecheck・test、read-only public consumer、boundary、topological buildをclean outputから実行する。
  - package sourceと公開成果物にReact、Chrome、製品catalogへの逆依存、dynamic/remote code、未公開subpathが含まれないことを機械検査する。
  - plain、interpolation、plural、descriptor、fallback、generic parityのpackage testを実行し、製品catalogや製品表示の回帰を本taskへ追加しない。
  - 完了時、generic packageの単独性、公開契約、topological build、read-only consumer契約のfresh evidenceが揃う。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Boundary: WorkspaceValidation_
  - _Depends: 4.1_
