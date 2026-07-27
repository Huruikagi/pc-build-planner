# Implementation Plan

- [ ] 1. 設定画面の公開契約と実装前提を整える
- [ ] 1.1 上流の常設／一過性feature契約を実装前提として検証する
  - 上流`transient-feature-surface`のpersistent既定と、`product-capture-transient-migration`のtransient登録・常設navigation除外が実装済みであることを公開contractから確認する
  - 常設featureだけがnavigation、通常選択、初期選択、fallbackの対象になる既存contract検証をsettingsの前提gateとして実行する
  - 上流contractが欠ける場合は互換shimを本specへ追加せず、settings実装へ進む前に明示的に失敗させる
  - 公開consumerの型検査とpersistent／transient混在contract testが成功し、settingsをpersistent利用者として追加できる状態を完了条件とする
  - _Requirements: 5.5, 6.6_
  - _Boundary: UpstreamContractGate_

- [ ] 1.2 (P) 設定用メッセージ・navigation・識別子契約を加算的に追加する
  - 日本語・英語に同じ設定画面の見出し、区画名、`nav.settings`、起動例外時の二言語案内を追加し、移行切替までは既存backup navigation keyを併存させる
  - settings用の同梱navigation iconと、画面・言語・backup区画を表示文言に依存せず特定する識別子を定める
  - catalog parity、resolver、識別子のcontract検証が通り、設定用の全keyが両言語で解決できる状態を完了条件とする
  - production navigationへの表示と旧key削除はcomposition切替タスクへ委ねる
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.5, 3.4, 3.5, 5.3, 5.4, 6.1_
  - _Boundary: SettingsCatalogAndLocatorContract_

- [ ] 1.3 (P) バックアップ・復元を埋め込み可能な公開sectionへ分離する
  - 既存のbackup service、restore service、状態、file gateway、専用data capabilityの構成をcanonical owner内に保持したまま、任意containerへmountできる最小公開portを追加する
  - export、preflight、確認、restore、maintenance、分類済みerrorの振る舞いを変えず、旧独立registrationとnavigationはcomposition切替まで保持する
  - sectionのmount失敗、正常cleanup、二重cleanupを公開contractとして検証する
  - 新section contractと旧registrationの既存検証が同時に成功し、settingsがbackup内部componentやstateへ触れず表示できる状態を完了条件とする
  - _Depends: 1.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1_
  - _Boundary: BackupRestoreSectionMount_

- [ ] 2. 設定画面とshell状態表示を実装する
- [ ] 2.1 (P) 言語区画とbackup hostを持つ設定画面を実装する
  - 設定画面、表示言語区画、バックアップ・復元区画を見出し階層と安定識別子で描画し、公開言語controlを表示言語区画だけに配置する
  - 初回layoutを同期確定して安定したbackup hostを返し、言語変更でもhost identity、入力途中の内容、スクロール位置、backup状態を保持できるroot lifecycleを実装する
  - 保存失敗時にもその回の表示言語を維持し、domain dataやbackup対象データへ書き込まない既存言語契約を利用する
  - 日本語・英語の切り替えで画面文言だけが即時更新され、設定rootとbackup hostが再mountされないDOM検証が通る状態を完了条件とする
  - _Depends: 1.2, 1.3_
  - _Requirements: 1.2, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 4.5, 4.6, 5.3, 5.4_
  - _Boundary: SettingsReactRootAdapter, SettingsView_

- [ ] 2.2 (P) shellヘッダを撤去し状態別の言語設定案内へ移行する
  - shell共通headerから言語controlと空のlayout行を除去し、通常・maintenance・feature failureではpersistent navigation領域を維持する
  - loadingとglobal startup errorでは操作不能なselectを出さず、表示言語の場所が「設定 / Settings」であることと既存回復操作を判別できる案内を表示する
  - 注入したpersistent settings fixtureを用い、到達可能状態でnavigationが残り、到達不能状態では二言語案内だけが出ることをshell単体で確認する
  - shell状態別DOM検証が全状態でheader select不在を確認できる状態を完了条件とし、production catalogからの到達はcomposition切替へ委ねる
  - _Depends: 1.2_
  - _Requirements: 1.3, 3.1, 3.3, 3.4, 3.5, 3.6, 6.5_
  - _Boundary: ShellLanguageRecoverySurface_

- [ ] 3. 設定featureをproduction compositionへ統合する
- [ ] 3.1 設定registrationと協調mount transactionを実装する
  - settings id、order 60、persistent既定、空public API、availability透過を持つregistrationを作り、設定rootの後にbackup sectionをmountする
  - backup mount失敗時は取得済み設定rootを解放してshellの既存rollbackへ失敗を返し、正常unmountではbackup、設定rootの順に一度だけcleanupする
  - settingsはfull data capabilityやbackup stateを公開せず、section mount handleだけをlifecycle資源として保持する
  - registration contract testでmetadata、正常mount、部分失敗、二重unmountが検証でき、部分表示や購読が残らない状態を完了条件とする
  - _Depends: 1.3, 2.1_
  - _Requirements: 1.1, 1.2, 2.4, 5.1, 5.5_
  - _Boundary: SettingsFeatureRegistration_

- [ ] 3.2 side panel catalogをsettings中心のcompositionへ原子的に切り替える
  - canonical backup sectionをsettings contributionへ注入し、上流移行後のtransient product-captureを登録に残したままpersistent navigationへsettingsを一度だけ追加する
  - この切替で初めて独立backup contribution、registration、root public key、backup navigation key、旧navigation expectationを同時に削除する
  - composition ownerだけが専用data capabilityをbackup section factoryへ渡し、settings内部や他featureへ漏らさない
  - production同等のcatalog snapshot、root API、build smokeでsettingsが存在し`backupRestore`独立entryが存在しない状態を完了条件とする
  - _Depends: 1.1, 2.2, 3.1_
  - _Requirements: 1.1, 1.4, 3.1, 3.2, 4.1, 4.3, 5.1, 5.2, 5.5_
  - _Boundary: SettingsFeatureContribution, ApplicationComposition_

- [ ] 3.3 言語変更とbackup lifecycleのcross-feature統合を完成する
  - maintenance、backup確認中、backup失敗、復元成功の各状態で言語変更を行い、operation policy、ticket、preview、結果、現在言語を保持する
  - 言語保存失敗でも表示とbackup操作を継続し、domain dataを変更しないことを既存言語契約との統合で確認する
  - persistent navigation選択とtransient surface起動・終了でsettingsとbackup rootが正しい順序で解放され、settingsがpersistentな戻り先として扱われることを確認する
  - mount failureとcleanupを含む統合検証が成功し、業務データとbackup交換形式に差分がない状態を完了条件とする
  - _Depends: 3.2_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 3.2, 4.2, 4.4, 4.5, 4.6, 5.4, 5.5_
  - _Boundary: SettingsFeatureRegistration, BackupRestoreSectionMount, ApplicationComposition_

- [ ] 4. 回帰検証とproduction E2Eを完成する
- [ ] 4.1 (P) settings・backupのcontract／DOM回帰を固定する
  - settings区画構造、言語controlの唯一性、host identity、backup confirmation保持、安全なtext描画を利用者視点のDOM testで覆う
  - backup export、preflight、maintenance可否、分類済みerror、言語変更後の確認・結果stateをsection contractと統合testで覆う
  - 関連node testが全件成功し、旧独立registrationへの期待や言語変更によるstate破棄が残らない状態を完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.2, 2.1, 2.3, 2.4, 3.2, 4.1, 4.3, 4.4, 4.5, 4.6, 5.4, 6.4_
  - _Boundary: SettingsReactRootAdapter, SettingsView, BackupRestoreSectionMount_

- [ ] 4.2 (P) shell・navigationのcontract／integration回帰を固定する
  - ready、maintenance、feature failure、loading、startup errorの到達または案内と、全状態でheader言語controlが存在しないことを覆う
  - persistent／transient混在navigation、settingsの一意登録、backup独立navigation不在、初期選択、fallbackをcontract／integration testで覆う
  - shell、catalog、root snapshotの関連testが全件成功し、旧backup navigationやheader言語controlへの期待が残らない状態を完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.3, 3.4, 3.5, 3.6, 5.2, 5.5, 6.5_
  - _Boundary: ShellLanguageRecoverySurface, SettingsFeatureContribution_

- [ ] 4.3 (P) settings経由の言語・backup production E2Eへ移行する
  - settings navigationから言語区画とbackup区画へ到達するlocatorへ既存英語UI、言語不変性、backup restore経路を移行する
  - 英語切り替えと再open後の保持、backup export、復元確認中の言語変更、restore summary、独立backup navigation不在をproduction buildで検証する
  - 一過性商品取り込み面からsettings navigationを選ぶと一過性面が終了してsettingsだけが表示され、settingsを戻り先として一過性面が終了した場合もpersistent画面へ復帰することを検証する
  - Playwrightのsettings、英語UI、backup、transient連携specが成功し、要素特定に表示文言または`backupRestore` feature idを使わない状態を完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 4.1, 4.4, 4.5, 4.6, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4_
  - _Boundary: SettingsCatalogAndLocatorContract, ExtensionE2E_

- [ ] 4.4 公開境界と完全検証gateを通す
  - settingsから許可するapplication-shell、ui-language、backup public依存だけをboundary検証へ反映し、backup内部、storage、Foundationへの直接到達を拒否する
  - 型、lint、catalog parity、UI text、boundary、fixture、build、unit／integration／DOM、Playwrightを含む完全検証を実行する
  - 全gateが成功し、既存利用者データ・backup JSON・manifest権限・runtime messageに変更がないことを差分と検査結果から確認できる状態を完了条件とする
  - _Depends: 4.1, 4.2, 4.3_
  - _Requirements: 2.5, 4.2, 5.1, 6.6_
  - _Boundary: SettingsCatalogAndLocatorContract, ValidationGate_
