# Implementation Plan

- [ ] 1. TypeScript拡張プロジェクトと検証基盤を整える
- [x] 1.1 厳密な型検査、ビルド、テストを実行できる開発環境を構成する
  - Node.js 26とpnpm 11で再現可能なTypeScript、ESMバンドル、テスト、Biomeの設定と共通検証コマンドを追加する
  - `any`を許さないstrict型検査と、未パッケージ拡張成果物を生成するbuild契約を確立する
  - typecheck、lint、空でないsmoke test、buildを連続実行する検証コマンドが成功することを完了条件とする
  - _Requirements: 1.1, 1.2, 8.2_

- [x] 1.2 最小Manifest V3契約と生成物検査を構成する
  - Chrome 116以降、storage権限、最小CSPだけを宣言し、application shell所有のservice worker compositionは追加しない
  - 全サイト権限、unlimitedStorage、remote code、動的評価、inline JavaScriptを検出して失敗する検査を追加する
  - 生成物がChromeで読み込み可能な最小MV3拡張となり、禁止権限・禁止コード検査に合格することを完了条件とする
  - _Requirements: 1.1, 1.2, 1.4, 5.5_

- [ ] 2. 共有ドメイン契約と信頼境界の検証を実装する
- [x] 2.1 識別子、日時、schema、結果型の基礎契約を実装する
  - UUID、UTC ISO 8601日時、現行schema version、revision、request IDの生成・検証規約を提供する
  - 検証、破損、移行、修復、競合、保守、容量、アクセス、保存失敗を判別できるcanonical Result契約を定義する
  - 有効値と各失敗が型安全に判別され、初期rootがschemaVersion 1・revision 0で生成されるテストが成功することを完了条件とする
  - _Requirements: 2.5, 3.4, 4.1_

- [x] 2.2 全カテゴリの正規化属性と取得値の共有モデルを実装する
  - 全12カテゴリ、欠損可能な商品情報、出典、元表記、確認値、カテゴリ別正規化属性をJSON直列化可能に表現する
  - 元表記と確認値を別に保持し、生HTML、画像binary、data URL用の保存フィールドを契約へ含めない
  - 架空の全カテゴリ値が型検査とJSON往復を通ることを完了条件とする
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.4_

- [x] 2.3 aggregate rootと永続制御stateの共有モデルを実装する
  - プロジェクト、候補、現在構成、同一プロジェクト内参照、正整数数量を一つの保存rootとして表現する
  - 単調増加revision、有界request dedupe記録、generation・owner・leaseを持つ永続maintenance stateをJSON直列化可能にする
  - 架空rootと初期rootが型検査とJSON往復を通り、参照・制御stateがworkerメモリを必要としないことを完了条件とする
  - _Requirements: 1.3, 2.1, 2.6, 4.1, 7.6_

- [x] 2.4 unknown入力を現行契約へ絞る実行時validatorを実装する
  - 保存root、runtime command、置換候補をunknownから検証し、問題pathと機械判別可能な原因を返す
  - UUID、UTC日時、URL、ID一意性、project内参照、正整数数量、禁止payloadをroot全体で検証する
  - 入力を変更せず、架空の有効値だけを受理し、破損値を正常値として返さないテストが成功することを完了条件とする
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 5.4, 6.2, 7.1_

- [ ] 3. 永続化の純粋な方針とChrome adapterを実装する
- [x] 3.1 (P) 連続schema移行レジストリを実装する
  - NからN+1だけを許す移行stepと、現行版まで順序適用する契約を提供する
  - 各stepと最終rootを検証し、将来版、経路欠落、検証失敗を区別してsourceを変更しない
  - 連続移行、将来版拒否、step失敗、source非変更のテストが成功することを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - _Boundary: MigrationRegistry_

- [x] 3.2 (P) 候補変更に対する参照修復方針を実装する
  - 候補削除とカテゴリ変更で無効になるCurrentBuild itemを除去し、無関係な参照を保持する
  - feature固有の選択数・互換性判断を持たず、修復後rootを同じ保存pipelineで再検証できる形にする
  - 削除、カテゴリ変更、無関係変更の架空rootテストで参照不整合が残らないことを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 2.6, 3.7_
  - _Boundary: ReferenceRepairPolicy_

- [x] 3.3 保存port契約と決定的なin-memory adapterを実装する
  - 単一キーのroot読取・書込、使用量、実行時quota、信頼済みアクセス制限をplatform非依存のtyped portとして定義する
  - worker再生成を模した別instanceから同じ永続rootと制御stateを読めるin-memory adapterを提供する
  - 読取・書込・bytes・quota・アクセス制限の成功失敗を決定的に再現できるcontract testが成功することを完了条件とする
  - _Depends: 2.4_
  - _Requirements: 1.3, 3.5, 5.1, 6.1, 7.6_

- [x] 3.4 (P) 容量評価方針を実装する
  - 実行時quota、設定可能な警告比率、直列化後の必要bytesから保存前後の状態を算出する
  - 既定80%警告を成功metadataとして扱い、10MB超過見込みを識別可能な拒否へ変換する
  - 通常、警告、超過境界の決定的テストが成功することを完了条件とする
  - _Depends: 3.3_
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: CapacityPolicy_

- [ ] 3.5 (P) Chrome Storage adapterと信頼済みアクセス制限を実装する
  - 単一キーのroot読取・書込、使用量、実行時quota、TRUSTED_CONTEXTS制限をtyped portとして提供する
  - Chrome APIのquota、アクセス、一般例外を正規化し、失敗時に成功を報告しない
  - in-memory Chrome stubで読取・書込・bytes取得・アクセス制限と既存root保持を確認できることを完了条件とする
  - _Depends: 3.3_
  - _Requirements: 1.3, 3.5, 5.1, 5.3, 6.1_
  - _Boundary: ChromeStorageAdapter_

- [ ] 4. 単一root transactionと保守・置換を実装する
- [ ] 4.1 永続generation・owner・leaseによる保守fencingを実装する
  - acquire、renew、release、abortをrootと同じ永続単位で扱い、owner外writeとstale generationを拒否する
  - commit直前にgeneration、owner、revisionを再検証し、期限切れownerを暗黙再利用させない
  - coordinatorを再生成しても保守中の競合が拒否され、releaseまたはabort後に通常writeが再開するテストが成功することを完了条件とする
  - _Depends: 3.5_
  - _Requirements: 1.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 4.2 検証・移行付きRepository読取とquery境界を実装する
  - 未保存時は現行版の初期rootを返し、保存値はmigrationと全体validatorを通してからsnapshotとして公開する
  - 破損、未知の将来版、移行失敗では保存値を上書きせず、原因を識別できるtyped failureを返す
  - Repository instanceを再生成しても同じrootを読み、queryが検証済みsnapshotだけを返す統合テストが成功することを完了条件とする
  - _Depends: 3.1, 3.3, 3.5_
  - _Requirements: 1.3, 3.3, 3.4, 4.2, 4.3, 4.4_

- [ ] 4.3 検証・参照修復・容量判定を一括するmutation commit pipelineを実装する
  - 最新root読取、移行、CRUD適用、参照修復、全体検証、容量評価、commit前cursor再検証、revision増分、単一writeを順序実行する
  - expected revision競合、保存失敗、容量超過、保守owner外writeでは既存rootを変更せずtyped failureを返す
  - 有効CRUDと候補変更時の参照修復が一つのcommitで観測され、中間の不整合rootが読めない統合テストが成功することを完了条件とする
  - _Depends: 3.2, 3.4, 4.1, 4.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.7, 3.8, 5.1, 5.2, 5.3, 7.4_

- [ ] 4.4 副作用なし評価と原子的root置換を実装する
  - 置換候補を移行・検証・容量評価し、source schema、target schema、内容digest、必要bytes、評価時revisionを結ぶtokenとassessmentを発行する
  - token、候補内容、maintenance fence、current revisionをcommit直前に照合し、root全体を一回のwriteで置換する
  - 候補差し替え、source・target schemaまたはrequired bytes不一致、stale token、容量不足、保存失敗では旧rootが保持されるテストを完了条件とする
  - _Depends: 4.3_
  - _Requirements: 4.2, 7.1, 7.2, 7.3, 7.5_

- [ ] 5. 単一write authorityと公開runtime境界を統合する
- [ ] 5.1 request ID再試行とrevision競合の永続制御を実装する
  - 永続revisionと有界request記録により同一payload再試行を同じ結果へ、同じrequest IDの異payloadをrequest conflictへ、古いrevisionを競合へ変換する
  - request記録の上限とevictionを固定し、保持期間外の再送はexpected revisionで判定する
  - 制御instance再生成後も同一再試行、異payload、古いrevisionが正しく判定されるcontract testを完了条件とする
  - _Depends: 4.4_
  - _Requirements: 1.3, 3.1, 3.6, 3.8, 7.6_

- [ ] 5.2 command dispatchと直列化を担う単一write authorityを実装する
  - query、mutation、maintenance、replacement commandを検証済みRepositoryとpipelineへdispatchする
  - 同一worker instance内のwriteをqueueで直列化し、各commitは永続revision・request ID・maintenance fenceを再検証する
  - 並行要求で変更を取りこぼさず、競合要求がtyped failureになるcontract testが成功することを完了条件とする
  - _Depends: 5.1_
  - _Requirements: 1.3, 3.1, 3.6, 3.8, 7.4, 7.6_

- [ ] 5.3 shell向けworker registrationとfail-closedなcaller境界を実装する
  - unknown messageとcaller classificationを検証し、shell提供の認可を通ったcommandだけをauthorityへ渡す登録factoryを提供する
  - access restriction成功前はhandlerを公開せず、content scriptへRepositoryまたはStorage portを返さない
  - 不正payload、不許可caller、アクセス制限失敗が永続状態を変えず、具体service worker入口を作成しないcontract testが成功することを完了条件とする
  - _Depends: 5.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 5.4 下流feature向け公開portと境界検査を完成する
  - domain契約、canonical Result、検証済みquery・mutation・maintenance・replacement port、worker登録factoryだけを公開する
  - Chrome adapter内部、未検証write、Storage primitive、shell具体実装への依存を公開境界から除外する
  - 模擬consumerが公開APIだけで型検査でき、featureからのchrome.storage直接importとdeep importを自動検査が拒否することを完了条件とする
  - _Depends: 5.3_
  - _Requirements: 2.1, 3.1, 6.3_

- [ ] 6. 架空データによる基盤全体の回帰検証を完成する
- [ ] 6.1 架空fixtureとdomain・永続化統合テストを完成する
  - 全12カテゴリ、欠損、元表記・確認値、参照整合性、禁止payloadを表す架空builderを用意する
  - CRUD、入力拒否、破損読取、容量不足、移行成功・失敗、アクセス拒否、参照修復、競合拒否、保守fence、root置換をpublic port経由で検証する
  - 実サイト由来HTML、画像、商品データを使わず主要成功・失敗契約の全テストが成功することを完了条件とする
  - _Depends: 5.4_
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 6.2 MV3生成物・境界・容量近傍の最終検証を統合する
  - manifest、権限、CSP、remote import、動的評価、inline JavaScript、公開import境界、fixture資産を一つの検証フローで検査する
  - 10MB近傍の架空rootでread、migration、validation、repair、serialization、writeを計測し、タイムアウトせず結果をtest reportへ残す
  - typecheck、Biome、全test、build、生成物検査が共通検証コマンドで成功することを完了条件とする
  - _Depends: 6.1_
  - _Requirements: 1.1, 1.2, 1.4, 5.1, 5.4, 5.5, 8.1, 8.2, 8.3_
