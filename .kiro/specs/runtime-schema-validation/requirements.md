# Requirements Document

## Introduction

本仕様は、storage、runtime message、backup、商品取得、feature activation、state snapshot などの未信頼境界に対し、宣言的な実行時 schema を共通規約の下で適用する。保守開発者が TypeScript 型と手書き decoder を二重管理する負担を減らしつつ、利用者データの意味、既存の公開型、fail-closed、canonical `Result<T, E>`、安定したエラーコード、canonical path、参照整合性、原子的更新を維持する。

## Boundary Context

- **In scope**: 実行時 schema 基盤の導入可否 gate、共通 primitive・strict object・JSON-safe/禁止 payload 検証・エラー変換、owner-local schema の配置と公開規約、保存 root・command・replacement、backup envelope、capture result、runtime message、activation payload、state snapshot の段階移行、bundle size の記録、配布物の runtime dependency notice。
- **Out of scope**: 保存 schema version と backup format version の変更、既存データの意味・構造変更、UI 入力フォームライブラリ、互換性規則の変更、vendor 固有エラーの外部公開、feature API やディレクトリ構造の全面刷新、全 validator の一括置換。
- **Adjacent expectations**: local data foundation は canonical `Result<T, E>`・validation error・path・永続化整合性を、各 feature は自身の業務 schema と意味検証を引き続き所有する。後続の `project-context` および既存 spec 更新は本仕様の公開検証規約を利用するが、各 consumer の業務意味や state authority は本仕様へ移さない。

## Requirements

### Requirement 1: 導入可否と配布安全性

**目的:** リリース担当者として、schema 移行前に production 環境での安全性を実証したい。これにより Manifest V3 と CSP を弱めずに runtime dependency を採用できる。

#### Acceptance Criteria

1. When 最小の実行時 schema を production 条件で bundle する, the 導入可否 gate shall Chrome 116 以降の Manifest V3 と既存 extension pages CSP を変更せず生成物を検証する
2. When production 条件の schema bundle を検査・実行する, the 導入可否 gate shall 直接呼び出しと constructor alias 経由を含む動的 `Function` 呼び出しを検出または阻止し、呼び出しが一度も発生しないことを成功条件にする
3. If 導入可否 gate の build、静的検査、production 実行 trap のいずれかが失敗する, the 移行手順 shall 後続 schema の移行を開始せず、既存 validator を有効な状態で保持する
4. When 導入前後の production bundle を生成する, the 導入可否 gate shall entry ごとの byte size と差分を再現可能な検証結果として記録する
5. When 配布 archive を生成する, the packaging flow shall runtime dependency に必要な license notice を archive 内へ含め、欠落時に失敗する

### Requirement 2: 共通の実行時検証契約

**目的:** schema を実装する開発者として、信頼境界で共通する primitive と失敗形式を再利用したい。これにより同じ入力を境界ごとに異なる規則で判定することを防げる。

#### Acceptance Criteria

1. When ページ、runtime message、JSON、storage から値を受け取る, the 実行時検証基盤 shall 値を `unknown` として扱い、検証成功後にだけ型付き値を返す
2. When UUID、UTC timestamp、HTTP(S) URL、revision、正の整数を検証する, the 実行時検証基盤 shall 既存 validator と同じ受理・拒否境界を適用する
3. When object shape を検証する, the 実行時検証基盤 shall 必須 key の欠落、未知 key、配列、許可されない prototype、列挙可能な symbol key を fail-closed で拒否する
4. If 入力が非 JSON 値、循環参照、data URL、生 HTML、禁止 key、または危険な埋め込み payload を含む, the 実行時検証基盤 shall 最初に確定した canonical path で入力全体を拒否する
5. When schema 検証が失敗する, the 実行時検証基盤 shall canonical `Result<T, E>`、既存の安定したエラーコード、`$`・property・array index からなる canonical path へ変換する
6. The 実行時検証基盤 shall vendor 固有の error object、issue code、schema instance を feature の外部契約または利用者向け表示へ公開しない

### Requirement 3: schema の所有権と公開境界

**目的:** feature 保守者として、共通基盤を利用しても業務意味の所有権を feature 内に保ちたい。これにより feature-first と単一 owner の原則を維持できる。

#### Acceptance Criteria

1. When 業務境界へ schema を追加する, the schema 移行 shall その schema と意味検証を既存の boundary owner 内へ配置する
2. When 複数 owner が共通検証を利用する, the 実行時検証基盤 shall primitive、JSON-safe 検査、strict object 規約、エラー変換だけを共有し、業務 field や aggregate 規則を中央 registry へ集約しない
3. When feature 外の consumer が検証済み値を利用する, the schema 移行 shall owner の既存公開入口と型付き契約を使用し、別 feature の内部 schema を deep import させない
4. When schema から型を推論できる, the schema 移行 shall 既存公開型との assignability を検証し、公開契約の意味を変更しない範囲で重複型宣言を削減する
5. If 共通 primitive、エラー変換、import 入口、または schema の公開形状を変更する, the 変更手順 shall 影響を受ける owner-local schema と downstream spec を再検証対象として識別する

### Requirement 4: local data foundation 境界の同等移行

**目的:** ローカルデータを保持する利用者として、検証実装の置換後も有効データを失わず、不正な保存操作を同じ規則で拒否してほしい。

#### Acceptance Criteria

1. When 保存 root を読み込む, the local data foundation shall 現行 schema version、revision、project、candidate part、current build、request dedupe、maintenance の既存 shape と未知 key 拒否を維持する
2. When query または mutation command を受け取る, the local data foundation shall command kind ごとの必須・許容 field、request ID、expected revision、proposed root を既存規則で検証する
3. When replacement candidate を評価する, the local data foundation shall 通常 root と同じ shape・version・禁止 payload 規則を適用し、atomic replacement の既存手順を変更しない
4. If project、candidate、build、source、request dedupe の ID が重複するか参照先を欠く, the local data foundation shall 既存のエラーコードと canonical path で aggregate 全体を拒否する
5. If root、command、replacement の検証が失敗する, the local data foundation shall 永続状態へ部分的な書き込みを行わず、直前の有効な root を保持する

### Requirement 5: backup 交換境界の同等移行

**目的:** バックアップを利用するユーザーとして、validator の置換後も同じ JSON を安全に export・restore し、破損や別形式のデータを同じ理由で拒否してほしい。

#### Acceptance Criteria

1. When backup document を受け取る, the backup 交換境界 shall product ID、format version、created timestamp、data collections と各 item の現行 strict shape を検証する
2. If backup document が非 JSON、危険 payload、未知 field、欠落 field、または不正 primitive を含む, the backup 交換境界 shall 既存の `not-json` または `invalid-structure` と canonical path を返す
3. If backup 内の project、candidate、build、build item の ID が重複するか ownership を含む参照整合性を満たさない, the backup 交換境界 shall `invalid-reference` と最初の違反 path で文書全体を拒否する
4. If backup format version が未知、将来、または移行経路を欠く, the backup 交換境界 shall 入力を変換せず `unsupported-version` で拒否する
5. The backup 交換境界 shall 保存 schema version、backup format version、root との mapping、復元の atomicity の既存意味を変更しない

### Requirement 6: capture・runtime message・activation 境界の同等移行

**目的:** Web ページから商品を取り込み feature 間を移動する利用者として、未信頼 payload が UI state や保存処理へ到達せず、有効な操作だけが従来どおり継続してほしい。

#### Acceptance Criteria

1. When capture result を候補 draft へ変換する, the product capture 境界 shall request、tab、page URL、capture time、normalized field、missing field、rejected field の strict shape を検証する
2. If capture result の field、source、rejection reason、document order、money value のいずれかが許容契約を外れる, the product capture 境界 shall `invalid-payload` を返し、draft を生成しない
3. When foundation または transient activation の runtime message を受信する, the runtime 境界 shall version、kind、request・response payload の strict shape を検証し、送信元分類と権限判定を shape 検証とは独立して維持する
4. When feature activation intent を受け取る, the activation owner shall feature ID、target、payload、adapter result を再検証してから feature state を変更する
5. If transient activation envelope、record、tombstone、stage transition、または response が不正である, the runtime 境界 shall 既存の error kind/code へ変換し、未検証 record を consumer へ通知しない
6. If capture、message、activation の検証が失敗する, the 対応する境界 shall payload 値、完全 URL、vendor error をログへ出さず、既存の安定した診断 code だけを扱う

### Requirement 7: feature state snapshot 境界の同等移行

**目的:** 一時 UI state を復元する利用者として、schema の置換後も同じ version と state を復元し、破損 snapshot により誤った project や candidate が選ばれないようにしたい。

#### Acceptance Criteria

1. When candidate management、duplicate merge、current build の snapshot を復元する, the 各 snapshot owner shall 現行 version、strict shape、許容 enum、safe string、collection key を検証する
2. The snapshot 移行 shall 現行 snapshot version と field shape を維持し、`selectedProjectId` を削除したり新しい selection authority または fallback として扱ったりしない
3. When snapshot の shape 検証が成功する, the 各 snapshot owner shall project、candidate、match、draft の参照整合性を owner-local state に対して検証する
4. When 実行途中の duplicate decision snapshot を復元する, the duplicate merge owner shall 既存規則どおり安全な失敗 state へ変換し、自動 commit を再開しない
5. If snapshot の version、shape、禁止 payload、または参照が不正である, the 各 snapshot owner shall 既存の `invalid-shape`、`unsupported-version`、`invalid-reference` の該当結果を返し、現在 state を変更しない

### Requirement 8: 段階移行と回帰検証

**目的:** 保守開発者として、広範な信頼境界を小さな wave で移行し、各段階で挙動同等性を確認したい。これにより一括置換によるデータ破損と原因不明の回帰を避けられる。

#### Acceptance Criteria

1. When schema 移行を開始する, the 実装手順 shall 導入可否 gate、共通基盤、foundation、backup、capture、runtime/activation、state snapshot の依存順を守る
2. When 各 boundary wave を移行する, the 検証手順 shall 既存の有効 fixture、不正 fixture、エラーコード、canonical path、参照整合性の同等性を自動テストで比較する
3. When owner-local schema の同等性が確認される, the 実装手順 shall その boundary 内で不要になった重複型ガードと無検証型アサーションを削除する
4. If wave の同等性検証が失敗する, the 実装手順 shall 次の boundary wave を開始せず、失敗した boundary を既存契約へ戻せる状態に保つ
5. When 全 wave が完了する, the 検証手順 shall typecheck、lint、unit/contract/integration test、production build、公開境界、fixture、artifact、E2E を既存の完全検証フローで通過させる
6. The 検証手順 shall 実サイト由来の HTML、画像、URL、商品値を fixture、diagnostic、検証記録へ含めず、架空データだけを使用する
