# Requirements Document

## Project Description (Input)

UI 文言が各 view コンポーネントへ直接埋め込まれており、文言が「表示以外の役割」まで担ってしまっている。CSS の属性セレクタが日本語 `aria-label` を参照し、E2E・単体テストのロケータとアサーションが表示文言そのものに依存し、同じ文言が複数箇所で重複定義されている。さらに日本語の助詞を前提とした文字列連結があり、文構造として翻訳が原理的に不可能な箇所が存在する。

本 spec は、UI に表示される全ての文言を単一の型付きカタログから解決する基盤と、その後に追加・移動された利用者向け文言の canonical owner である。初回移行で確立した文言非依存のスタイル・テスト、文単位メッセージ、型付きキー契約、およびv0.3.0で追加した日本語・英語文言とdead key撤去を維持する。Change Brief `v0.5.0`では、製品固有のカタログ・言語policy・React bindingを保持しつつ、汎用message mechanismを`typed-messages-core`の公開契約へ委譲した。最新の Change Brief `v0.5.0-boundary-reconciliation` では、`project-context` が定義する project lifecycle message の意味・発火条件・必要parameterを受け取り、具体的な`MessageKey`、日本語・英語の値、descriptor-to-key mapping、catalog集約、parityを本specの単独所有へ統合する。

カタログのキー体系と参照方法は `ui-internationalization` が導入した日本語・英語の静的カタログと resolver を維持する。機能側は表示文言や言語状態を所有せず、catalog owner がキー、プレースホルダ、ロケール間parity、廃止計画を一貫して管理する。

## Introduction

本 spec の利用者は拡張の利用者と開発者である。受け入れの中心は、承認済みの機能変更に必要な案内が日本語・英語で欠落なく提供されること、既存の型付きカタログ契約と文言非依存の利用側を壊さないこと、および廃止された画面構造を示すdead keyを残さないことである。

要件は次の3群に分かれる。

1. **カタログ基盤** — キー体系、型による保護、パラメータ表現、日本語・英語のparity（要件1、要件10）
2. **参照側の契約** — view、shell、ナビゲーション、重複定義、動的合成文（要件2〜7）
3. **文言依存の剥離** — スタイルとテストが文言を識別子として使わないこと（要件8、要件9）
4. **v0.3.0の追加・移行** — 一過性起動、権限再付与、新世代起動、設定画面、shell回復案内、dead navigation keyの撤去（要件11）
5. **v0.5.0のgeneric core委譲** — package公開APIを設定して利用する製品adapterと既存consumerの非回帰（要件12）
6. **v0.5.0のowner境界調整** — project lifecycle messageの物理catalog、descriptor mapping、ja/en parityの単独所有（要件13）

## Change Brief Integration

- **Integrated Change Brief**: `v0.5.0-boundary-reconciliation`
- **In-scope trace**: configured app adapter、project lifecycleの具体`MessageKey`とja/en値、descriptor-to-key mapping、catalog aggregation、placeholder parity、既存message consumer/public contract、製品validationを本specへ統合する。
- **Preserved behavior**: `v0.5.0`で確定したgeneric core委譲、全表示文言の唯一のsource of truth、configured resolver、React binding、既存表示、文言非依存consumerを維持する。
- **Out-of-scope preservation**: project lifecycle command/state/意味/発火判断、言語保存・切替、React package化、UI layout、generic core実装を取り込まない。

## Boundary Context

- **In scope**:
  - UI に表示される全ての文言（JSX テキストノード、`aria-label` / `placeholder` / `title` などの表示属性値、ロジック層が生成して画面へ届く診断メッセージ）のカタログ経由での解決
  - スタイル定義が日本語文言を要素の識別子として参照している構造の解消
  - E2E および単体・統合テストが表示文言を要素の識別子として使っている構造の解消
  - 重複定義されている文言テーブル（カテゴリ表示名、永続化エラー、起動エラー）の単一定義化
  - 助詞連結・テンプレート合成で組み立てられていた文言の、文単位で完結するメッセージへの再設計
  - 各機能のナビゲーションラベルのカタログ化
  - 一過性featureの起動失敗・失効案内、商品取り込みの権限再付与・新世代起動・引き渡し再試行案内
  - 設定画面のナビゲーション、見出し、表示言語・バックアップ区画の説明、およびloading・startup failure時の二言語回復案内
  - 廃止されたproduct-capture常設navigationと独立backup navigationのキー撤去
  - `typed-messages-core`の公開APIだけを用いたconfigured resolver、descriptor factory、generic parity primitiveへの接続
  - 製品固有の具体`MessageKey`、ja/enカタログ、source/fallback language、release固有検査、React binding、既存app consumer contractの維持
  - project lifecycleの意味・発火条件・必要parameterに対応する具体`MessageKey`、日本語・英語の値、descriptor-to-key mapping、catalog集約、placeholder parity
- **Out of scope**:
  - 言語状態、言語切り替え、言語の永続化、ブラウザ言語からの初期値決定（`ui-internationalization` が所有）
  - `_locales/` の導入、`chrome.i18n` の利用、拡張マニフェストの `name` / `description` の国際化（同上）
  - ロケール別の日付・数値・通貨フォーマット
  - **表示文言の文面そのものの改善**。誤字修正、言い回しの改善、表記ゆれの統一は行わない。助詞連結箇所の再設計は文構造の変更であって文面の改善ではなく、これは In に含む
  - 商品カテゴリ推定のキーワード辞書、および価格表記のパースロジック。いずれも表示文言ではなくロケール別のデータ・ロジックである
  - テストフィクスチャ内の日本語データ値（架空の商品名など）。表示文言ではない
  - ドメイン層および互換性判定ルールへの変更。既に文言を持たず列挙コードで結果を返しているため対象外
  - 一過性featureの寿命・activation配送、商品取り込みの抽出・handoff、設定画面のlayout・mount、言語state、backup/restore業務処理
  - 汎用message型・format・resolver factory・descriptor factory・parity primitiveの再実装、package内部moduleへの依存、React adapterのpackage化、npm公開
  - project lifecycle command、state、意味、発火条件、descriptor生成、候補一覧・editorのlayoutまたはCSS
- **Adjacent expectations**:
  - 各機能 spec が定める利用者向け状態と回復操作は本 spec の入力であり、本 spec は対応するmessage keyとロケール値だけを所有する
  - アプリケーションシェルが所有する画面合成と機能の搭載・解放のライフサイクルの責務境界は変更しない
  - `ui-internationalization` は本 spec が確定したキー体系を利用し、言語状態とresolver選択だけを所有する
  - `typed-messages-core` はReact・Chrome・製品catalog非依存の汎用mechanismを所有し、本specはそのroot公開APIを設定する最初のapp consumerになる
  - `project-context` はproject lifecycle messageの意味・発火条件・必要parameterをkey非依存descriptorとして提供し、本specはそのdescriptorを具体keyとja/en値へ写像する

## Requirements

### Requirement 1: UIメッセージカタログ基盤

**Objective:** As a 拡張の開発者, I want 全ての表示文言が単一のカタログから型に守られた形で解決されること, so that 文言の変更が一箇所で完結し、参照の誤りが検証フローで機械的に検出される

#### Acceptance Criteria

1. The UIメッセージカタログ shall 全ての表示文言を、機能単位で名前空間化された一意のキーで識別する。
2. If 存在しないキーを参照するコードが含まれる, then the 検証フロー shall 型検査の段階で失敗する。
3. If パラメータを持つメッセージに対して必要なパラメータが不足している、または不要なパラメータが渡されている, then the 検証フロー shall 型検査の段階で失敗する。
4. The UIメッセージカタログ shall パラメータをメッセージ値の内部にプレースホルダとして保持し、参照側での文字列連結を要求しない。
5. The UIメッセージカタログ shall 実行時の動的読み込みを行わず、配布物へ静的に含まれる。
6. The UIメッセージカタログ shall 未検証の外部由来文字列をパラメータとして受け取った場合も、それを通常のテキストとして描画し、マークアップとして解釈させない。

### Requirement 2: 既存能力の非回帰と承認済み文言変更

**Objective:** As a 拡張の利用者, I want 新しい案内と配置変更が追加されても既存機能の意味と操作結果が保たれること, so that カタログ更新によって無関係な利用経路が壊れない

#### Acceptance Criteria

1. The 拡張 shall 承認済みfeature specで追加・変更・廃止が指定された文言を除き、既存キーの意味、パラメータ、利用者向け結果を維持する。
2. The 拡張 shall カタログ更新を理由に、各featureが所有するDOM構造、操作、保存結果、エラー分類を変更しない。
3. When 承認済みfeature specが新しい状態または回復操作を導入した場合, the UIメッセージカタログ shall その状態を誤認させず次の操作を判別できる文言を提供する。
4. The 検証フロー shall 型検査、静的検査、公開境界検査、フィクスチャ検査、最終ビルドゲート、単体・統合テスト、E2E の全てを本 spec 完了時点で成功させる。
5. Where 承認済みfeature specと関係しない文面改善の余地が見つかった場合, the 開発作業 shall その改善を本更新へ混在させない。

### Requirement 3: view 層の文言のカタログ移行

**Objective:** As a 拡張の開発者, I want view コンポーネントに表示文言のリテラルが残っていないこと, so that 表示文言の所在が一意になり、view が文言の所有者でなくなる

#### Acceptance Criteria

1. The 各機能の view shall 表示する全てのテキストを、カタログから解決した値として描画する。
2. The 各機能の view shall `aria-label`・`placeholder`・`title` など利用者が知覚しうる属性値を、カタログから解決した値として設定する。
3. The アプリケーションシェルの view shall 読み込み中・エラー・保守中・利用可能機能なしの各状態表示、および再試行操作のラベルを、カタログから解決した値として描画する。
4. If view のソースに表示文言としての自然言語リテラルが残っている, then the 検証フロー shall 失敗する。
5. The 各機能の view shall カタログを、機能の搭載時に外部から注入される依存としてではなく、表示層自身の関心として解決する。
6. The 設定画面 shall 画面見出し、表示言語区画、バックアップ・復元区画および各説明を、カタログから解決した値として描画する。
7. The 一過性商品取り込み面 shall 実行、実行中、失敗、再起動および引き渡し再試行の案内だけを、カタログから解決した値として描画する。

### Requirement 4: 動的合成メッセージの文単位再設計

**Objective:** As a 拡張の開発者, I want 助詞や語順を前提に断片を連結して組み立てられていた文言が、文として完結した単一のメッセージになっていること, so that 文構造が言語の文法に依存しなくなる

#### Acceptance Criteria

1. The UIメッセージカタログ shall 部品名や項目名を含む文を、断片の連結ではなく、その名前をパラメータとして受け取る1つの完結した文として保持する。
2. The 各機能の view shall 表示文言を組み立てるために文字列連結・テンプレート合成を行わない。
3. When 再設計されたメッセージが描画された場合, the 拡張 shall 変更前と同一の文字列を表示する。
4. Where 同一の意味の文が複数の条件分岐から生成されていた場合, the UIメッセージカタログ shall 条件ごとに独立したキーを与え、分岐は参照側のキー選択として表現する。
5. Where 件数を含む文が存在する場合, the UIメッセージカタログ shall その件数をパラメータとして受け取り、将来の言語で数量に応じた表現の切り替えが必要になっても参照側を変更せずに済む形で保持する。

### Requirement 5: 重複文言定義の単一化

**Objective:** As a 拡張の開発者, I want 同じ意味の文言が一箇所でだけ定義されていること, so that 片方だけを直す事故が構造的に起こらなくなる

#### Acceptance Criteria

1. The UIメッセージカタログ shall パーツカテゴリの表示名を単一の定義として保持し、複数の機能がそれを共有する。
2. The UIメッセージカタログ shall 永続化に起因する失敗の表示文言を、意味と文面が一致する範囲で単一の定義として保持する。
3. The UIメッセージカタログ shall 起動失敗の表示文言を単一の定義として保持する。
4. If パーツカテゴリの定義が増減した, then the 検証フロー shall 表示名の定義に漏れがある場合に型検査の段階で失敗する。
5. Where 同一の文面が異なる意味で複数箇所に現れる場合, the UIメッセージカタログ shall 意味ごとに独立したキーを与え、文面が一致することを理由に統合しない。
6. Where 同じエラーコードでも機能ごとに利用者が取る回復操作が異なる場合, the UIメッセージカタログ shall 回復操作ごとに独立したキーを保持する。

### Requirement 6: ロジック層のメッセージ識別子化

**Objective:** As a 拡張の開発者, I want アプリケーションシェルのロジックが文言そのものではなくメッセージの識別子とパラメータを扱うこと, so that 表示言語の決定が表示層だけの関心に閉じる

#### Acceptance Criteria

1. The アプリケーションシェルのロジック shall 画面へ届く失敗・保守・起動の各通知を、文言ではなくメッセージ識別子とパラメータの組として表現する。
2. The アプリケーションシェルの view shall 受け取ったメッセージ識別子とパラメータを、カタログを用いて表示文言へ解決する。
3. When ロジックが失敗を報告した場合, the 拡張 shall 変更前と同一の文言を画面に表示する。
4. The アプリケーションシェルのロジック shall 診断ログへ出力する内容として、利用者の閲覧履歴や検討内容に相当する値を含めない。
5. Where 機能側が申告した利用不可の理由など、カタログで表現できない自由文字列が存在する場合, the アプリケーションシェル shall それを翻訳対象の文言ではなくパラメータとして扱う。

### Requirement 7: ナビゲーションラベルのカタログ化

**Objective:** As a 拡張の開発者, I want 各機能が保持するナビゲーションラベルがカタログ由来になること, so that 機能登録が表示文言を所有しなくなる

#### Acceptance Criteria

1. The 各機能の登録 shall ナビゲーションラベルを、文言そのものではなくカタログのキーとして申告する。
2. The アプリケーションシェル shall 申告されたキーを表示直前にカタログで解決し、ナビゲーションに表示する。
3. When ナビゲーションが描画された場合, the 拡張 shall 承認済みfeature構成に対応するラベル文字列を、そのfeatureの順序・役割・アクセシブル名を保って提供する。
4. If 登録が未定義のキーを申告している, then the 検証フロー shall 型検査の段階で失敗する。
5. The UIメッセージカタログ shall 常設設定画面の登録に `nav.settings` を提供する。
6. The UIメッセージカタログ shall 常設navigationから除外されたproduct-captureと設定画面へ統合されたbackup-restoreの独立navigation keyを提供しない。

### Requirement 8: スタイルの文言非依存化

**Objective:** As a 拡張の開発者, I want スタイル定義が表示文言を要素の識別子として参照していないこと, so that 文言の変更でスタイルが黙って壊れなくなる

#### Acceptance Criteria

1. The 各機能のスタイル定義 shall 表示文言を含む属性値を用いて要素を選択しない。
2. The 各機能の view shall スタイルが要素を選択するための、文言に依存しない安定した識別属性を要素へ付与する。
3. The 各機能の view shall 既存の `aria-label` の値を、識別属性の追加を理由に変更・削除しない。
4. When 本 spec の完了後に画面を表示した場合, the 拡張 shall 変更前と同一の視覚表現を提供する。
5. If スタイル定義に自然言語を含む属性セレクタが残っている, then the 検証フロー shall 失敗する。

### Requirement 9: テストの文言非依存化

**Objective:** As a 拡張の開発者, I want テストが表示文言を要素の識別子として使っていないこと, so that 文言や言語が変わってもテストが壊れなくなる

#### Acceptance Criteria

1. The E2E テスト shall 操作対象の要素を、表示文言ではなく安定した識別子または役割で特定する。
2. The 単体・統合テスト shall 検証対象の要素を、表示文言ではなく安定した識別子または役割で特定する。
3. Where テストの目的が「特定の文言が表示されること」そのものである場合, the テスト shall 期待値をカタログから解決して比較し、文言リテラルを埋め込まない。
4. The テスト shall 承認済みfeature specが追加・変更・廃止した振る舞いを除き、検証している既存振る舞いの集合を変えない。
5. The E2E テスト shall 要素特定の手順を共有のヘルパへ集約し、各仕様ファイルが個別に識別子の組み立て規約を持たない。

### Requirement 10: 日本語・英語カタログの整合性

**Objective:** As a カタログ保守者, I want 日本語と英語が同じキー・パラメータ契約を持つこと, so that どちらの表示言語でも同じ状態と回復操作を案内できる

#### Acceptance Criteria

1. The UIメッセージカタログ shall キーの集合と、各キーが受け取るパラメータの名前・個数を、日本語と英語で一致させる。
2. If 日本語または英語の値にキーの欠落または余剰がある, then the 検証フロー shall 型検査またはカタログparity検査の段階で失敗する。
3. The 参照側 shall 表示直前にカタログを解決する経路を用い、実行中に解決結果が切り替わる余地を塞がない。
4. The UIメッセージカタログ shall プレースホルダの個数に上限を設けず、数量に応じた表現の切り替えを表現できる形式を許容する。
5. The 本 spec shall 言語状態、初期値決定、保存または切り替え操作の実装を提供しない。
6. The UIメッセージカタログ shall 外部由来文字列を両言語で同じ名前のプレースホルダとして扱い、翻訳対象の固定文言へ埋め込む。

### Requirement 11: 一過性表示面と設定画面の文言移行

**Objective:** As a 拡張の利用者, I want 一過性の取り込みと設定画面の新しい情報設計に合った案内を表示言語で読めること, so that 失敗する常設導線に誘導されず回復方法と設定場所を判断できる

#### Acceptance Criteria

1. If 一過性featureの起動要求を安全に提示できない, then the UIメッセージカタログ shall 新しい付与ジェスチャーで再起動できることを日本語と英語で案内する。
2. If 一過性featureの対象タブまたは起動世代が失効した, then the UIメッセージカタログ shall 古い面から再実行せず新しい付与ジェスチャーで新世代を起動する必要があることを日本語と英語で案内する。
3. If 商品取り込みのページアクセス権限が失効した, then the UIメッセージカタログ shall ページを再表示した後に拡張アイコンを再操作して権限を付与し直す回復方法を日本語と英語で案内する。
4. If 商品取り込み結果の候補管理への引き渡しが失敗した, then the UIメッセージカタログ shall 結果が現行世代に保持されていること、同世代で引き渡しを再試行できること、および新しい起動では保持結果が置き換わることを日本語と英語で案内する。
5. The UIメッセージカタログ shall `nav.settings`、設定画面の見出し、表示言語区画とバックアップ・復元区画の見出し・説明を日本語と英語で提供する。
6. While 常設navigationを利用できないloadingまたはglobal startup failure状態, the UIメッセージカタログ shall 表示言語の変更場所が「設定 / Settings」であることと利用可能な回復操作を、現在の表示言語にかかわらず判別できる短い二言語案内として提供する。
7. The UIメッセージカタログ shall product-captureを常設navigationへ戻す文言、shell headerの言語controlを前提とする文言、またはbackup-restoreの独立navigationを前提とする文言を提供しない。
8. The 検証フロー shall Requirement 11の全キーが日本語・英語の両方で解決でき、プレースホルダが一致し、廃止キーがcatalogとconsumerに残らないことを確認する。

### Requirement 12: generic coreを設定する製品メッセージadapter

**Objective:** As a 拡張の開発者, I want 製品固有のカタログ契約が汎用message packageの公開APIだけを設定して提供されること, so that 製品文言だけの変更と安定したresolver coreの変更影響を分離できる

#### Acceptance Criteria

1. The UIメッセージカタログ shall `typed-messages-core`の公開入口だけを用いて、製品カタログに対応するconfigured resolverとmessage descriptor生成能力を提供する。
2. The UIメッセージカタログ shall 日本語・英語の製品カタログ、具体的な`MessageKey`、source language、fallback language、原語表記およびrelease固有検査のcanonical ownerであり続ける。
3. The UIメッセージカタログ shall 既存のapp consumerに対し、resolver、descriptor、plural、placeholder、fallbackおよびReact表示の利用者向け結果を維持する。
4. When 日本語・英語のカタログparityを検証する, the UIメッセージカタログ shall generic parity primitiveの結果へrequired release key、固定二言語案内およびdead key不在の製品規則を合成する。
5. If UIメッセージカタログが`typed-messages-core`の内部moduleを参照する、または汎用format・resolver・parity mechanismを製品側へ重複して保持する, then the 検証フロー shall その境界違反を失敗として報告する。
6. The UIメッセージカタログ shall 言語状態・保存・切り替え、React adapterのpackage化、対応言語追加、翻訳変更、npm公開またはUI再設計を本更新へ含めない。
7. When 製品カタログ値またはrelease固有規則だけが変更される, the 検証フロー shall package core変更と区別した製品側のparity、configured adapterおよび表示回帰を再現可能に検証する。

### Requirement 13: project lifecycle messageの物理catalog統合

**Objective:** As a 拡張の利用者, I want projectの作成・改名・削除と回復案内が日本語と英語で一貫して表示されること, so that project lifecycleの責務移管後も同じ意味と操作経路を理解できる

#### Acceptance Criteria

1. When `project-context` がproject一覧、作成、改名、削除確認、名前必須、操作中、操作失敗またはrefresh再試行のmessage intentを提供する, the UIメッセージカタログ shall 各intentを一意な具体`MessageKey`と日本語・英語の値へ解決可能にする。
2. When project lifecycle messageがproject名、operation、影響または安定したerror categoryを必要とする, the UIメッセージカタログ shall `project-context`が定義したparameterの意味と名前を変えず、project名は両言語で同じplaceholderとして扱い、operation・影響・error categoryは欠落のない具体key mappingとして扱う。
3. The UIメッセージカタログ shall project lifecycleの全key/value、descriptor-to-key mapping、言語別catalog集約およびplaceholder parityを単一の物理catalog ownerとして提供する。
4. If project lifecycleの日本語・英語catalogにkeyまたはplaceholderの欠落・余剰がある、descriptor intentに対応する具体keyがない、または未定義のmappingがある, then the 製品検証フロー shall 失敗する。
5. The UIメッセージカタログ shall project lifecycle command/state、message intentの意味・発火条件、またはkey非依存descriptorの生成を再定義しない。
6. When project lifecycle messageを既存hostへ表示する, the 拡張 shall 既存のlayout、CSS、role、アクセシブルlabel、keyboard操作および利用者向け結果を維持し、project名を実行可能なmarkupとして解釈しない。
7. The UIメッセージカタログ shall 言語保存・切り替え、React adapterのpackage化、generic core実装、候補一覧・editorの情報設計、独立project管理画面またはUI全面刷新を本更新へ含めない。
