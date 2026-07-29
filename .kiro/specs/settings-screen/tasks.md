# Implementation Plan

- [x] 1. 設定画面の公開契約と実装前提を整える
- [x] 1.1 上流の常設／一過性feature契約を実装前提として検証する
  - 上流`transient-feature-surface`のcanonical判別共用体で常設branchが`presentation: "persistent"`とnavigationを必須とし、一過性branchが`presentation: "transient"`でnavigationを禁止すること、および`product-capture-transient-migration`の一過性登録・常設navigation除外が実装済みであることを公開contractから確認する
  - 常設featureだけがnavigation、通常選択、初期選択、fallbackの対象になる既存contract検証をsettingsの前提gateとして実行する
  - 上流contractが欠ける場合は互換shimを本specへ追加せず、settings実装へ進む前に明示的に失敗させる
  - 公開consumerの型検査とpersistent／transient混在contract testが成功し、settingsをpersistent利用者として追加できる状態を完了条件とする
  - _Requirements: 5.5, 6.6_
  - _Boundary: UpstreamContractGate_

- [x] 1.2 (P) 設定用semantic message consumer・navigation・識別子契約を整える
  - 画面見出し、表示言語区画、backup区画、navigation label、起動例外時の二言語案内について、意味要件、consumer位置、observable guidanceを設定画面側の契約として固定する
  - viewとshell surfaceは`ui-message-catalog`の公開key／resolver契約だけを利用し、exact key名、ja/en値、namespace shape、placeholder、parity、fallback、廃止keyを定義・編集しない
  - settings用の同梱navigation iconと、画面・言語・backup区画を表示文言に依存せず特定する識別子を定める
  - catalog ownerの公開consumer型検査・parity／dead-key gateを再実行し、全semantic messageが両言語で解決され、settings側の識別子contract検証が通る状態を完了条件とする
  - _Depends: 1.1, ui-message-catalog 6.1, ui-message-catalog 6.2_
  - _Requirements: 1.1, 1.5, 3.4, 3.5, 5.3, 5.4, 6.1_
  - _Boundary: SettingsMessageConsumerAndLocatorContract_

- [x] 1.3 (P) canonical backup section mount契約を受け入れる
  - `backup-restore` task 6.1が実装・公開する`BackupRestoreSectionMount`をpublic entryだけから受け取り、settingsの安定hostと既存mount contextを渡すconsumer境界を固定する
  - settingsはsection factory、backup service、restore service、state、file gateway、専用data capability、mount内部cleanupを実装・所有しない
  - 公開mount失敗時のsettings root rollback、返却handleの先行cleanup、二重settings unmountをsettings側のstub／integration contractで検証する
  - backup task 6.1のcontract testとsettings consumer testが成功し、backup内部componentやstateへ触れずhostできる状態を完了条件とする
  - _Depends: 1.1, backup-restore 6.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1_
  - _Boundary: SettingsFeatureRegistration, SettingsReactRootAdapter_

- [ ] 2. 設定画面とshell状態表示を実装する
- [x] 2.1 (P) 言語区画とbackup hostを持つ設定画面を実装する
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
  - settings id、`presentation: "persistent"`、`navigation: { labelKey: "nav.settings", order: 60, icon: "settings" }`、空public API、availability透過を持つ常設registrationを作り、設定rootの後にbackup sectionをmountする
  - backup mount失敗時は取得済み設定rootを解放してshellの既存rollbackへ失敗を返し、正常unmountではbackup、設定rootの順に一度だけcleanupする
  - settingsはfull data capabilityやbackup stateを公開せず、section mount handleだけをlifecycle資源として保持する
  - registration contract testでmetadata、正常mount、部分失敗、二重unmountが検証でき、部分表示や購読が残らない状態を完了条件とする
  - _Depends: 1.3, 2.1_
  - _Requirements: 1.1, 1.2, 2.4, 5.1, 5.5_
  - _Boundary: SettingsFeatureRegistration_

- [ ] 3.2 side panel catalogをsettings中心のcompositionへ原子的に切り替える
  - canonical backup sectionをsettings contributionへ注入し、上流移行後のtransient product-captureを登録に残したままpersistent navigationへsettingsを一度だけ追加する
  - application-shellが所有するproduction tuple、root API composition、navigation fixture／expectationから独立backup参照を外し、settings参照へ切り替える。backup-owned registration／contributionファイルと公開surfaceの削除は`backup-restore` task 6.2へ委ねる
  - exact navigation keyとdead catalog consumerの削除は`ui-message-catalog`のmigration checkpointへ委ね、settings側は公開keyを申告するconsumerだけを切り替える
  - composition ownerだけが専用data capabilityをbackup section factoryへ渡し、settings内部や他featureへ漏らさない
  - production同等のapplication composition snapshot、root API、build smokeでsettingsが存在し、legacy backup実装ファイルが一時的に残っていてもproduction graphに独立entryが存在しない状態を完了条件とする
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
  - _Boundary: SettingsFeatureRegistration, ApplicationComposition_

- [ ] 4. 回帰検証とproduction E2Eを完成する
- [ ] 4.1 (P) settings・backupのcontract／DOM回帰を固定する
  - settings区画構造、言語controlの唯一性、host identity、backup confirmation保持、安全なtext描画を利用者視点のDOM testで覆う
  - backup ownerのsection contract testを再実行し、settings側では公開mountを通したexport、preflight、maintenance可否、分類済みerror、言語変更後の確認・結果stateだけを統合testで覆う
  - 関連node testが全件成功し、settings側にbackup内部contractの再実装や言語変更によるstate破棄が残らない状態を完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.2, 2.1, 2.3, 2.4, 3.2, 4.1, 4.3, 4.4, 4.5, 4.6, 5.4, 6.4_
  - _Boundary: SettingsReactRootAdapter, SettingsView, SettingsFeatureRegistration_

- [ ] 4.2 (P) shell・navigationのcontract／integration回帰を固定する
  - ready、maintenance、feature failure、loading、startup errorの到達または案内と、全状態でheader言語controlが存在しないことを覆う
  - persistent／transient混在navigation、settingsの一意登録、backup独立navigation不在、初期選択、fallbackをcontract／integration testで覆う
  - shell／root snapshotの関連testとcatalog ownerの公開contract gateが全件成功し、settings-owned consumerやapplication compositionに旧backup navigation期待またはheader言語control期待が残らない状態を完了条件とする
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
  - _Boundary: SettingsMessageConsumerAndLocatorContract, ExtensionE2E_

- [ ] 4.4 公開境界と完全検証gateを通す
  - settingsから許可するapplication-shell、ui-language、backup、ui-messagesのpublic依存だけをboundary検証へ反映し、backup内部、catalog定数、storage、Foundationへの直接到達を拒否する
  - 型、lint、catalog ownerのparity／dead-key、UI text、boundary、fixture、build、unit／integration／DOM、Playwrightを含む完全検証を実行する
  - 全gateが成功し、既存利用者データ・backup JSON・manifest権限・runtime messageに変更がないことを差分と検査結果から確認できる状態を完了条件とする
  - _Depends: 4.1, 4.2, 4.3_
  - _Requirements: 2.5, 4.2, 5.1, 6.6_
  - _Boundary: SettingsMessageConsumerAndLocatorContract, ValidationGate_
