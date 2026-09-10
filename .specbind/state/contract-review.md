---
type: SpecBind Contract Review
milestone_id: 01a07399-7949-7dd2-82df-a537e736301a
passed_at: 2026-09-10T23:05:23.3219273Z
input_revisions:
  "steering/roadmap.md#cross-spec-scope": sha256:94baf0dd751b94447f6ef7ca93d3b9163a80fe517178500c9a1e5425cb571812
  "roadmap#shared-body": sha256:77749c631e7c6755811850e106461050bbc1d76907e0e94edce0e6ea89e8dca8
  shared-contract: sha256:879bf1037d112649e086a7cfe32c984208fcaccf58a20bd531c0f3a90cba7016
  "specs/basic-compatibility#contract": sha256:2fd3d458dce5429072db2c6569ded618e94eb0ccc8aaa6629a7e6ddd0e6ca479
  "specs/current-build-management#contract": sha256:8078031fa069923c6ad28ef773039e03e98a53a9d0364b8eebafed72bf03089a
  "specs/current-build-management#design/main": sha256:5a50319491d05a4fbd6a5a153b2a4b69f7e1938f5986b48a12204aa0757b99d9
  "specs/current-build-management#requirements": sha256:dd712e3b6e44af63955182c23190631c021daccfd6e5528917d90ee101323180
  "specs/local-data-storage#contract": sha256:03963da69691345f8b27e2c091ca7635fb84eff9636bfcf91511da4d8f41d3af
  "specs/page-capture#contract": sha256:f960f0c4be9135095caaa80fb8fcf2b83082df71f72ad8727558752ebe688d1d
  "specs/project-candidate-management#contract": sha256:1eea5a2f1ea77594a05e1970bbe714145b7248e3db2d21e35b9f935b561d2e39
  "specs/site-extraction-authoring#contract": sha256:87433dfcf02ce8e16a265c57393156a5d0bd3add67434818caab6da828726660
---
基準 `c092c64cb0983abf0be75eae2c3eeacb3285a9b0` から、`site-extraction-authoring` が新設され、`project-candidate-management` の `candidate-capture-handoff` を `page-capture` が消費する境界、ならびに `page-capture` が `validated-site-extraction-registration` を消費する境界が追加された。いずれも現在のContractで生産側のexportと利用側のconsumeが一対一に対応し、`check contracts` は所有重複・依存循環なしで通過している。既存の `current-build-management`、`basic-compatibility`、`local-data-storage` の状態・保存・候補削除整理の境界は維持され、`page-capture` の旧export削除は候補管理が所有する新しいhandoffへの移行と整合する。

同じ基準との差分で共有Contract `locale-messages` が追加され、対象は日英翻訳ファイルだけである。`basic-compatibility` の旧ファイル単独所有は外れ、`basic-compatibility`、`current-build-management`、`page-capture`、`project-candidate-management` が共有資産をconsumeする。共有Contractはキー集合とプレースホルダー対応、無関係な値の保持を定め、各Specが文言の意味と表示条件を所有する。`current-build-management` のDesign `main` は採用・解除・数量・カテゴリ・空状態・入力フィードバックの意味を自Specに留め、共有利用から実装順依存を生まないと定めるため、後からスコープに加えた利用側も整合している。RoadmapのDirect項目 `shared-locale-contract` はこの資産を明示し、既存依存 `project-candidate-management → site-extraction-authoring → page-capture` を変更していない。

外部に公開された翻訳API、保存形式、または他リポジトリの消費者は、今回確認したContract・Roadmapの範囲では識別されなかった。共有化は利用者が承認した製品内資産の所有整理であり、未管理消費者への互換性判断を要する変更は示されていない。よって、マイルストーンの永続的な境界は整合している。
