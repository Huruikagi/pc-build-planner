---
type: SpecBind Design
artifact_id: main
---

<!-- specbind:instruction create output=spec
現在のauthoring contextにある正規のSpec identityから`spec`を生成する。
すべての`{{spec}}`参照をその同じ出力で置換し、ディレクトリ外で読んでも対象を
識別できるようタイトルに残す。
-->

<!-- specbind:instruction create output=artifact_id
このテンプレートのFront Matterにあるリテラルなcollection identityから`artifact_id`を
生成する。すべての`{{artifact_id}}`参照をその同じ出力で置換し、分割した設計文書を
区別できるようタイトルに残す。
-->

# `{{spec}}` の設計 — `{{artifact_id}}`

<!-- specbind:instruction maintain
この文書が扱う Requirement ID をすべて列挙した `requirement_ids` 配列を Front Matter に
追加し、同じ ID を `_Requirements: 1.1, 1.2_` という厳密な形式のイタリック本文マーカーとして、
それを満たす節の近くに記載する。Front Matter の集合と本文マーカーの和は完全に一致する必要がある。

大きな変更は、それぞれに `artifact_id` とファイルを与えて複数の設計文書に分割する。
この文書が所有する判断だけを記述する。Research は判断の材料にできるが、権威ある判断と根拠は
この文書だけで理解できるようにする。該当しない節は削除し、図や表は複雑な関係を明確にできる
場合にだけ使う。

内部アーキテクチャと、永続的な Contract をこの設計がどう実現するかを記述するが、Contract の
標準的な接合面一覧は複製しない。異なる実装者でも互換性のある結果に到達できるよう、具体的な
ファイル境界、インターフェース、失敗時の振る舞い、検証方針を十分に残す。

見出し `_Requirements: ...` の形式は機械可読であり、日本語化しない。
-->

## 概要

<!-- specbind:instruction maintain
この文書が所有する設計判断、Requirementsを実現する中心的な方針、意図的に扱わない技術的責任を
短くまとめる。RequirementsやBriefの目的を言い換えず、後続節の詳細を繰り返さない。対象外を
明記する必要がなければ、方針だけを記載する。
-->

## アーキテクチャと境界

<!-- specbind:instruction maintain
変更後の責任分担、依存方向、所有境界と、その形を選んだ理由を記載する。Side Panel、service
worker、content script、共有モデルのどの実行文脈が責任を持つか、Chrome APIや永続化へ到達できる
境界を明確にする。既存構造を一覧として複製せず、この変更で生じる差だけを示す。
-->

## システムフロー

<!-- specbind:instruction maintain
複数の実行文脈、メッセージ境界、`chrome.storage`、または画面状態をまたぐ処理を、入力の検証点、
状態遷移、失敗経路が分かる順序で記載する。単一の責任境界内で完結する処理ならこの節を削除する。
-->

## コンポーネントとインターフェース

<!-- specbind:instruction maintain
新設または変更する責任境界ごとに、所有する状態と判断、入力、出力、保証、依存してよい公開境界を
記載する。UI、機能ロジック、共有モデル、Chrome接続を混在させない。各境界には内容を表すH3見出しを
付ける。TypeScriptの型やシグネチャは、その形自体が互換性や所有権の判断である場合だけ含める。
-->

<!-- specbind:instruction create output=components
新設または変更する責任境界ごとに1つのH3小節を含むMarkdown断片を生成する。各小節には
実際のコンポーネント名または境界名を付け、直前のmaintain instructionが求める内容を記載する。
-->

{{components}}

## データモデル

<!-- specbind:instruction maintain
新設または変更する共有概念、Zodによる検証境界、`LocalDataRoot`内の永続化形、セッションだけの
状態、整合性とリビジョンの扱いを記載する。自動取得値と確認済み値の区別も、変更が影響する場合は
明記する。データの形や所有に変更がない場合はこの節を削除する。
-->

## エラー処理

<!-- specbind:instruction maintain
未信頼入力、Chrome API、永続化、メッセージ、機能ロジックの失敗をどの境界で識別し、利用者または
呼び出し元へどの結果を返すか記載する。再試行、回復、既存データを黙って変更しない条件も扱う。
既存方針をそのまま適用でき、追加の判断がない場合はこの節を削除する。
-->

## 検証方針

<!-- specbind:instruction maintain
各重要な保証と失敗経路を、型検査、純粋な機能境界、またはビルド済みChrome拡張を読み込む
Playwright E2Eのどこで、何を観測して検証するか記載する。実際のcomposition rootを通らない
合成ハーネスを受け入れ根拠にしない。既存コマンドの一覧は書かない。
-->

## データ互換性と移行

<!-- specbind:instruction maintain
既存の`LocalDataRoot`、セッション状態、メッセージ、または公開機能境界に互換性上の影響がある場合、
スキーマ版、読み取り可否、変換順序、失敗時の保全、切り戻し条件を記載する。互換性や移行の判断が
ない場合はこの節を削除する。
-->

## リスクと代替案

<!-- specbind:instruction maintain
採用案に残る具体的なリスクと、検討した実行可能な代替案を採用しなかった理由を記載する。
判断に影響するリスクや代替案がない場合はこの節を削除する。
-->
