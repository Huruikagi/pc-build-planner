---
type: SpecBind Contract Review
milestone_id: 01a07399-7949-7dd2-82df-a537e736301a
passed_at: 2026-09-09T01:54:45.199867Z
input_revisions:
  "steering/roadmap.md#cross-spec-scope": sha256:e556f2a22cde6c7758255ae2df0ffead2ada3efab19952e166c686ecdae3e8e3
  "specs/basic-compatibility#contract": sha256:f8da11667c48f621b43988a628b0b80a1b7eb0676e9cae160e3d9d5055c6de92
  "specs/current-build-management#contract": sha256:11cc2bfb4081b9350628de6c333173360168eee9ce65c97340c08578c5df8f64
  "specs/local-data-storage#contract": sha256:03963da69691345f8b27e2c091ca7635fb84eff9636bfcf91511da4d8f41d3af
  "specs/page-capture#contract": sha256:7645babf47b2a48909670f05e30969d860d2bd603e91eed2664a953bdb5de227
  "specs/project-candidate-management#contract": sha256:6a21850a00adeaa6119357654f9862d345b483730a63f3ce39e1c92f5a62a84d
  "specs/site-extraction-authoring#contract": sha256:2de39d15f23672d2393c3b842afa193dff97ccec7e5d5b41ae80107599032133
  "specs/site-extraction-authoring#design/main": sha256:09cfb40209143397c531dd103350d6ffcde4ec929281483a686553308f700ae6
---
## 評価

ベースライン `c092c64cb0983abf0be75eae2c3eeacb3285a9b0` と現行 `0a63dedb586f6aac1c024063b0bd01c1ce723991` の Contract を全6 Specで比較した。`site-extraction-authoring` はベースラインに存在しない新規Specであり、規約確認、保存資料による検証、実拡張検証を通過したサイト固有抽出だけを `validated-site-extraction-registration` として `page-capture` に提供する。`page-capture` はこの境界を唯一のmanaged consumerとしてconsumeし、従来の未確認CaptureResult exportを廃止して、候補管理所有の `candidate-capture-handoff` へ共通項目、取得時分類、既存カテゴリ属性の元表記だけを渡す。

`project-candidate-management` はhandoffを明示的にexportし、未確認の分類・属性元表記を既存の確認済みcategoryおよび値と区別して保持する。`current-build-management` と `basic-compatibility` がconsumeする候補状態の確認済み投影は維持されるため、既存consumerの互換性は保たれる。Designを深掘りして、属性の `sourceLabel` は登録規則とCapture実拡張検証の証跡に限定され、候補handoff、候補永続データ、確認済み値、候補編集UIへは渡らないことを確認した。よって候補管理の型・保存境界をこのmilestoneで拡張する必要はない。

新規Skillのローカル作業領域 `/.site-extraction-work/` は `.gitignore` を含む `site-extraction-authoring-skill` のfile ownershipに明示され、他Specの所有と重複しない。外部サイトへのアクセスは、開発者指定URLで利用条件を肯定確認した場合に限るという今回の要求済み手順であり、公開API・別リポジトリ・保存データ形式の互換性判断を新たに要するunmanaged consumerは確認されなかった。`specbind check contracts` は所有重複、依存循環、警告なしで通過した。

## 所見台帳

未解決所見なし。過去の SEA-CR-001（Designが要求する `/.site-extraction-work/` の `.gitignore` 追加に対するfile ownership不足）は、現行Contractの `site-extraction-authoring-skill` に `.gitignore` を加えたことで解消済みである。

## 結論

全ての永続境界は所有者、consumer、互換性、およびローカル作業領域の責務が整合している。Contract Reviewを受理する。
