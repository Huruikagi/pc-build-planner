# 実装計画

> **実装前提**: product-capture #8が、メーカー登録ドメインの照合をfeature公開入口から利用できる状態であること。マップデータやeTLD+1判定を本spec側へ複製しない。

- [ ] 1. 上流公開前提と複数ソースのドメイン・保存schemaを確立する
- [ ] 1.1 上流メーカー判定の公開seamをconsumer contractで固定する
  - product-capture #8の公開入口だけからメーカー登録ドメイン照合をimportし、candidate-managementのclassifier adapterが依存できる最小shapeを型検査する。
  - product-capture内部map、eTLD+1実装、抽出componentをdeep importせず、一致・非一致を架空URLで呼び分けるcontract fixtureを追加する。
  - 公開seamが未実装またはshape不一致なら後続classifier/compositionへ進まず、このconsumer contract testが明確に失敗することを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 1.2 候補ソースentityとプライマリ参照をcanonical domain契約へ導入する
  - 候補ソース識別子、販売・メーカー紹介の種別、URL・サイト名・取得日時・任意価格を表現する。
  - 候補へソースcollectionと条件付きプライマリ参照を追加し、商品共通値から価格と単数取得元を除く。
  - sourceなし候補と、sourceが存在するときの唯一のprimary参照を型契約で明示する。
  - domain contract testでsourceなし・複数source・取得元別価格の新しい形状が型安全に構築できることを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.5_

- [ ] 1.3 複数ソースとプライマリの実行時検証を実装する
  - sourceの固定field集合、識別子、HTTP/HTTPS URL、UTC日時、価格、種別を未信頼入力として検証する。
  - source ID重複、source有無とprimary有無の不一致、存在しないprimary参照をpath付きで拒否する。
  - 生HTML、data URL、画像・binary相当payloadの既存fail-closed規約をsourceの全外部文字列へ適用する。
  - 正常な欠損sourceと不正なsource collectionを区別するdomain testが成功することを完了条件とする。
  - _Requirements: 1.2, 1.3, 1.4, 7.1, 7.2, 7.5_

- [ ] 1.4 保存schema 1から2への決定的な移行をproduction経路へ登録する
  - 旧単数取得元と商品価格を一件のprimary sourceへ移し、片方だけ・両方なしも値損失なく変換する。
  - 旧候補IDを生成source IDとして再利用し、同じ入力から同じschema 2結果を生成する。
  - 現行schema定数をmigration registry、replacement、初期rootで一元参照し、限定したfoundation公開入口からbackup mapperへ供給してproduction runtimeへ1→2 stepを登録する。
  - 移行失敗時に旧rootが書き換わらず、正常readがschema 2 snapshotを返すことを完了条件とする。
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 1.5 foundation fixtureと保存経路のschema 2回帰を整備する
  - 通常利用fixtureをsource collection形式へ更新し、schema 1 fixtureはmigration専用に分離する。
  - repository read、root transaction、replacement、write authorityが同じ現行schemaとvalidatorを使うことを検証する。
  - 破損旧root、未知の将来版、移行後primary不整合が既存データを上書きしないことを検証する。
  - foundationのdomain・persistence contract test群がschema 2で成功することを完了条件とする。
  - _Requirements: 6.4, 6.5, 6.6, 7.2, 7.4_

- [ ] 2. 独立したソース能力と隣接形式を実装する
- [ ] 2.1 (P) ソースcollection更新と代表値導出policyを実装する
  - 初回追加でprimaryを設定し、追加・更新・primary切替を副作用なしで返す。
  - 非primary削除、primary削除時のreplacement必須、最後のsource削除を区別する。
  - 代表URL・代表価格をprimaryだけから導出し、価格欠損時に他sourceへfallbackしない。
  - 全policy分岐のunit testで入力を変更せず期待projectionを返すことを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.3, 3.4, 3.5_
  - _Boundary: CandidateSourcePolicy_
  - _Depends: 1.2_

- [ ] 2.2 (P) 上流メーカー判定をソース種別へ変換するclassifierを実装する
  - product-capture公開入口のメーカー登録ドメイン照合だけを依存として受ける。
  - 一致をメーカー商品紹介、非一致または安全に判定不能なURLを販売ページへ写像する。
  - 利用者が明示した種別を自動判定で上書きしない契約を検証する。
  - 候補側にマップを複製せず、一致・非一致・明示上書きのtestが成功することを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: SourceKindClassifier_
  - _Depends: 1.1, 1.2_

- [ ] 2.3 (P) HTTP/HTTPS取得元を新規タブで開くruntime portを実装する
  - featureが利用する最小のopen契約と、Chrome Tabs APIを包むadapterを定義する。
  - adapter直前でURLを再検証し、許可schemeだけを一回の新規タブ作成へ渡す。
  - runtime不在・API失敗・無効URLを値や完全URLを含まない判別可能errorへ変換する。
  - 危険schemeでChrome APIが呼ばれず、正常URLで元tab操作を行わないtestが成功することを完了条件とする。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: SourcePagePort_
  - _Depends: 1.2_

- [ ] 2.4 (P) backup交換形式2と旧形式移行を実装する
  - 現行交換候補へ全source、primary参照、取得元別価格、種別、サイト名、日時を含める。
  - format 1の単数取得元と商品価格をformat 2へ連続的かつ決定的に変換する。
  - export/import mapperでsource順序・ID・primary・snapshotを維持し、不正参照をpreflightで拒否する。
  - format 1 migrationとformat 2 round tripのtestが、既存rootを置換する前の検証まで成功することを完了条件とする。
  - _Requirements: 6.1, 6.2, 8.2, 8.3, 8.4_
  - _Boundary: BackupExchangeV2_
  - _Depends: 1.2, 1.3, 1.4_

- [ ] 3. 候補管理serviceと公開source契約を統合する
- [ ] 3.1 候補draft・summary・公開source catalog／mutation契約を複数ソース化する
  - editor draftへsource collectionとprimary参照を追加し、一覧summaryへprimary sourceと導出価格を公開する。
  - source追加・更新・削除・primary変更をsource IDで指定する型付き公開portを定義する。
  - 全候補または指定候補のsource参照列挙と候補・source IDによる再取得を、識別子・任意URL・任意種別・primary状態だけのread-only DTOで定義する。
  - `ManagementError` のnot-found対象でcandidateとsourceを区別し、downstream consumerへmutation revision、保存root、商品値を公開しない。
  - 公開consumerの型検査で単数取得元と商品共通priceへ戻る経路や、foundation rootへ到達する必要がないことを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.5, 2.3, 3.1, 3.2, 3.3, 8.6, 8.7_

- [ ] 3.2 保存済みsourceのread-only catalogを実装する
  - 全候補または指定候補を一回のread snapshotから走査し、sourceごとの候補ID、source ID、任意URL、任意種別、primary状態を投影する。
  - sourceなし候補は成功した空配列とし、未知candidateとcandidate内に存在しないsourceは識別可能なnot-foundとして返す。
  - URL正規化、種別eligibility、重複排除、0件・1件・複数件の一致判定を行わず、同一URLを持つ複数参照も保存順のまま返す。
  - 全catalog・候補限定catalog・ID再取得・not-found・下流の曖昧一致判定に必要な重複保持をcontract testで観測できることを完了条件とする。
  - _Requirements: 8.7_

- [ ] 3.3 candidate serviceへ原子的なsource mutationと代表queryを実装する
  - 新規sourceに有効URLを要求し、種別未指定時だけclassifier結果を保存する。
  - source更新・削除・primary変更をpolicyへ委譲し、候補全体を一回のroot mutationで確定する。
  - queryはprimary sourceから一覧価格・URLを導出し、欠損時の非fallbackを維持する。
  - validation・conflict・maintenance・quota・storage失敗で旧候補が残り、成功時だけ対象sourceが変わるintegration testが成功することを完了条件とする。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 7.3, 7.4_

- [ ] 3.4 candidate-management公開API用のsource facetを実装する
  - feature contributionがread-only catalogとmutation portを `sources: { catalog, mutations }` facetとして構築し、`public.ts` から型と契約を限定exportする。
  - 公開source portの各操作に新しいrequest IDと読取時点revisionをfeature内で付与する。
  - 本taskはsource facetだけを所有し、project-candidate-managementが所有する `query` と `createCandidateEditorIntent(prefill): FeatureActivationIntent` を再実装・変更しない。canonical公開APIに旧capture write portを残さない。
  - 競合時にlost updateせず型付きconflictを返し、feature外consumerがfoundationへ直接到達しないことを検証する。
  - 公開API contract fixtureで `query`、typed intent factory、`sources` facetが共存し、catalogがread portへ、全source変更がserviceへ一度だけ配送されることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.3, 7.4, 8.6, 8.7_

- [ ] 4. 候補管理stateとReact UIへソース操作を追加する
- [ ] 4.1 editor stateへsource操作と再訪結果を統合する
  - source追加・編集・削除・primary選択をdraftへ反映し、primary削除時はreplacement選択を要求する。
  - 一覧primaryと詳細の任意sourceをpage portへ渡し、open失敗を保存状態と分離して表示stateへ保持する。
  - mutation失敗時はeditor入力と既存一覧を保持し、成功時だけ再読込して確定値を表示する。
  - state testでsource操作、保存中gate、open成功・失敗、入力保持が観測できることを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.4, 7.4_

- [ ] 4.2 複数ソースeditorのsnapshot codecをversion 2へ更新する
  - source配列、primary参照、価格、種別を含むdraftだけを未信頼snapshotから復元する。
  - 危険URL、不正source ID、primary不整合、未知versionを永続化へ触れず拒否する。
  - 有効な編集中sourceがfeature切替後に同じdraftへ復元されるcodec testを通す。
  - snapshot失敗で保存済み候補と現在一覧が変わらないことを完了条件とする。
  - _Requirements: 3.2, 3.6, 7.1, 7.2, 7.5_

- [ ] 4.3 (P) ソース操作・種別・再訪の文言を日本語と英語へ追加する
  - source項目、販売・メーカー紹介、primary、追加・削除、開く操作、各失敗のmessage keyを定義する。
  - 両言語catalogのkey集合とplaceholderを一致させ、外部値を安全なtextとして挿入できる形にする。
  - message schemaと言語不変性のtestが新しい全keyで成功することを完了条件とする。
  - _Requirements: 3.4, 3.6, 4.5, 5.4_
  - _Boundary: CandidateSourceView_
  - _Depends: 3.1_

- [ ] 4.4 候補一覧・editorへソース一覧、primary、種別、再訪UIを実装する
  - 一覧にprimary価格状態と代表sourceを開くbuttonを表示し、価格欠損を不明として示す。
  - editorに全sourceのURL・サイト名・日時・価格・種別、primary選択、追加・削除操作を表示する。
  - 通常の外部link遷移を使わずstate経由でpage portを呼び、side panel内のeditor状態を維持する。
  - 販売・メーカー紹介が区別でき、primary変更とsource編集が利用者操作として到達可能なDOMになることを完了条件とする。
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.4, 4.5, 5.1, 5.2, 5.3_

- [ ] 4.5 source UIの利用者操作と安全な描画をDOM testで検証する
  - source追加、種別上書き、primary切替、非primary削除、primary replacement、最後の削除をuser-eventで操作する。
  - field errorが入力へ関連付けられ、不正価格・URLでもraw入力と保存前一覧が残ることを検証する。
  - 悪意あるサイト名・URL文字列がHTML要素やscriptとして解釈されないことを検証する。
  - 一覧とeditorのcritical pathが日本語・英語の両catalogで成功することを完了条件とする。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.4, 4.5, 5.1, 5.2, 5.4, 7.5_

- [ ] 5. compositionと隣接featureを新しいsource契約へ接続する
- [ ] 5.1 application shellからclassifierとChrome tab portを注入する
  - side panel compositionがproduct-capture公開照合をcandidate classifierへ渡し、内部mapを直接importしないようにする。
  - 既存Chrome tabs handleの最小shapeを新規タブ作成へ拡張し、candidate page portへ注入する。
  - Chrome API不在のtest環境には安全に失敗するinert portを供給し、production以外でglobalへ直接到達しない。
  - contribution catalogの順序・公開API・feature mountが循環依存なしで成立するcontract testが成功することを完了条件とする。
  - _Requirements: 4.1, 4.2, 4.3, 5.3, 5.5_
  - _Depends: 1.1, 2.2, 2.3_

- [ ] 5.2 (P) 商品取り込みから候補保存までの初期source統合を検証する
  - 更新済み候補draft契約に合わせ、取り込みページURL、取得日時、取得価格を一件のsourceへ写像し、そのIDをprimaryにした `CandidateEditorPrefill` を構築する。
  - 商品共通値へ価格を残さず、元表記snapshotと他の確認済み商品値を維持し、種別未指定は候補serviceのclassifierへ委ねる。
  - product-captureがprefillを公開 `createCandidateEditorIntent` へ渡し、返された `FeatureActivationIntent` を一過性surfaceの`conclude`へ配送することを検証する。candidate query、source mutation、candidate serviceを直接呼ばない。
  - handoff後に利用者が保存した候補では取得価格がsourceだけに保存され、種別が上流map一致・非一致で解決されることを検証する。
  - 取り込み失敗・handoff失敗・候補保存失敗で部分的なsourceが残らず、失敗時のintent保持と世代管理はproduct-capture側の契約に委ねる。
  - mapper unit testとtyped intent handoffから候補一覧の代表価格・URLまでのintegration testが成功することを完了条件とする。
  - _Requirements: 1.5, 2.1, 4.1, 4.2, 4.3, 7.3, 7.4, 8.1_
  - _Boundary: CaptureSourceMapper_
  - _Depends: 1.1, 3.1, 3.4, 5.1_

- [ ] 5.3 (P) backup復元とfoundation置換の複数source統合を検証する
  - format 2 backupをpreflight、容量評価、atomic replacementまで通して全source関係を復元する。
  - format 1 backupも移行後に同じprimary source規則へ到達することを検証する。
  - 不正sourceまたはprimary参照を持つbackupが既存rootを置き換えないことを検証する。
  - exportした架空データを復元して再exportしたときsource意味が一致するintegration testが成功することを完了条件とする。
  - _Requirements: 6.1, 6.2, 6.5, 8.2, 8.3, 8.4_
  - _Boundary: BackupExchangeV2, CandidateSourceMigration_
  - _Depends: 1.4, 2.4_

- [ ] 5.4 互換性判定と未変更consumerのschema 2回帰を整備する
  - source・取得元別価格だけを変えた候補が同じ正規化属性から同じ互換性結果を返すことを検証する。
  - 現在構成、worker registration、公開consumerなどの候補fixtureを新source契約へ更新する。
  - 隣接featureが商品共通priceや単数取得元へ依存していないことを型検査とcontract testで確認する。
  - compatibilityと未変更consumerの回帰testがschema 2 fixtureで成功することを完了条件とする。
  - _Requirements: 6.4, 8.5, 8.6_

- [ ] 5.5 downstream向けsource catalog consumer契約を検証する
  - 価格更新consumer fixtureが公開catalogから全候補または候補限定のsource参照を取得できることを検証する。
  - 同一URLの複数参照をcatalogが保持し、URL同一性・0件・1件・複数件の一致と曖昧さをconsumer側で判定できることを確認する。
  - source再取得のnot-foundをconsumerがstale targetへ変換でき、foundation rootやcandidate内部moduleをimportしない公開consumer型検査が成功することを完了条件とする。
  - _Requirements: 8.7_

- [ ] 6. 実ブラウザ経路とセキュリティgateを検証する
- [ ] 6.1 複数source管理と新規タブ再訪のE2Eを追加する
  - 架空候補へ複数sourceを追加し、種別上書きとprimary変更を保存・再読込後に確認する。
  - 一覧の代表sourceと詳細の任意sourceを開き、それぞれ新しいtabが作られることを確認する。
  - 再訪後も元tab、side panel、選択project、editorの作業状態が維持されることを確認する。
  - production buildしたunpacked拡張でcritical pathがChrome 116以降相当のPlaywright実行に成功することを完了条件とする。
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.4, 4.5, 5.1, 5.2, 5.3_

- [ ] 6.2 権限・公開境界・架空fixtureの検証gateを拡張する
  - manifestの権限集合に `tabs`、host、optional permissionが追加されていないことを検証する。
  - feature間利用が公開入口とcomposition注入だけで、内部mapやstorage adapterへのdeep importを持たないことを検証する。
  - source catalogの公開consumerがfoundation root、編集draft、内部query実装をimportせず、URL正規化・一致判定をcatalogへ持ち込まないことを検証する。
  - source URL・価格・siteNameを含む新fixtureがすべて架空データで、生HTML・画像・data URLを含まないことを検証する。
  - artifacts、boundaries、fixturesの各gateが新しいsource実装とproduction bundleに対して成功することを完了条件とする。
  - _Requirements: 5.4, 5.5, 7.5, 8.7_

- [ ] 7. 境界別の完全検証で実装完了を確認する
- [ ] 7.1 静的検査とsource契約suiteを実行する
  - typecheck、公開consumer型検査、lint、domain・policy・catalog・serviceのunit／contract／integration testを実行する。
  - candidate source DTO、catalog／mutation facet、not-found、URL照合の下流所有を含む公開契約suiteがすべて成功することを完了条件とする。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.5, 8.6, 8.7_

- [ ] 7.2 保存・交換形式の移行suiteを実行する
  - schema 1保存移行、schema 2通常read／write／replacement、format 1 backup移行、format 2 round trip、不正入力の非置換を実行する。
  - migration、backup／restore、capacityの関連suiteが値損失・重複source・部分更新なしで成功することを完了条件とする。
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 8.2, 8.3, 8.4_

- [ ] 7.3 production build・browser・security gateを実行する
  - production build、artifacts、boundaries、fixtures、新規タブ再訪Playwrightを実行する。
  - `pnpm validate` が成功し、追加権限、実データfixture、feature内部deep import、未関係の公開契約差分がないことを完了条件とする。
  - _Requirements: 3.6, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 7.5, 8.6, 8.7_
