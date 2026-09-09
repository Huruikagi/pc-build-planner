---
type: SpecBind Contract Review
milestone_id: 01a07399-7949-7dd2-82df-a537e736301a
passed_at: 2026-09-09T22:57:29.4477981Z
input_revisions:
  "steering/roadmap.md#cross-spec-scope": sha256:e556f2a22cde6c7758255ae2df0ffead2ada3efab19952e166c686ecdae3e8e3
  "specs/basic-compatibility#contract": sha256:f8da11667c48f621b43988a628b0b80a1b7eb0676e9cae160e3d9d5055c6de92
  "specs/current-build-management#contract": sha256:11cc2bfb4081b9350628de6c333173360168eee9ce65c97340c08578c5df8f64
  "specs/local-data-storage#contract": sha256:03963da69691345f8b27e2c091ca7635fb84eff9636bfcf91511da4d8f41d3af
  "specs/page-capture#contract": sha256:de7c19ea70f98a6c44a3e37bca23de033bcd2552cf0cc64932166d66d79a3dc1
  "specs/project-candidate-management#contract": sha256:6a21850a00adeaa6119357654f9862d345b483730a63f3ce39e1c92f5a62a84d
  "specs/site-extraction-authoring#contract": sha256:0b4f832639f76726b826e0e1685b1323d87562de0c99aaf4411f78cdff2a83e0
---
baseline c092c64cb0983abf0be75eae2c3eeacb3285a9b0 から、site-extraction-authoring は新規 Contract として `validated-site-extraction-registration` を公開した。この登録境界は page-capture だけが消費し、登録済みドメイン・カテゴリ、架空 fixture、サイト固有規則、自動 E2E、手動確認の未完了状態を含むため、未確認の外部ページ対応を完了扱いにしない。外部ページは手順の入力であり、この登録境界の未管理 consumer は確認されなかった。

page-capture は旧 `unconfirmed-capture-result` 公開を廃止し、project-candidate-management の新規 `candidate-capture-handoff` を消費する形へ移行した。候補管理が入力受入れ、ローカル取得元 ID とプライマリ指定を補った未確認 PartDraft を返すため、ページ取得が候補ライフサイクルを所有しない。追加した既存カテゴリ属性だけを未確認値として渡す不変条件も、この handoff の対応カテゴリ・元表記・確認済み category を変えない保証と一致する。

project-candidate-management は `candidate-capture-handoff` を追加し、`project-candidate-state` と value-provenance の記述を取得時分類・属性元表記へ拡張した。basic-compatibility と current-build-management は引き続き同じ `project-candidate-state` を消費し、候補の確認済み category 投影を維持するため、既存 consumer の入力境界は狭まらない。local-data-storage、current-build-management、basic-compatibility の Contract は baseline から不変である。

全 6 Contract の検証では所有重複 0、依存循環 0、警告なしだった。Milestone scope の三つの変更は、それぞれ新規登録境界、capture から候補管理への handoff、未確認属性の保持として current Contract に表現されており、追加の persistent seam や deep input は不要である。したがって、全 persistent seam は coherent である。
