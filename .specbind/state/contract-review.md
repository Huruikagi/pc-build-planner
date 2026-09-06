---
type: SpecBind Contract Review
milestone_id: 01a07399-7949-7dd2-82df-a537e736301a
passed_at: 2026-09-06T04:51:17.9761335Z
input_revisions:
  "steering/roadmap.md#cross-spec-scope": sha256:4dc3568ae440aa39762c4fa4c6dfd216098d97b51c29d54f0a2175f75994c3e8
  "specs/basic-compatibility#contract": sha256:f8da11667c48f621b43988a628b0b80a1b7eb0676e9cae160e3d9d5055c6de92
  "specs/current-build-management#contract": sha256:11cc2bfb4081b9350628de6c333173360168eee9ce65c97340c08578c5df8f64
  "specs/local-data-storage#contract": sha256:03963da69691345f8b27e2c091ca7635fb84eff9636bfcf91511da4d8f41d3af
  "specs/page-capture#contract": sha256:7645babf47b2a48909670f05e30969d860d2bd603e91eed2664a953bdb5de227
  "specs/page-capture#design/main": sha256:71d2eb58a6a523b9dedd77744bf9bf9317700641e8afe62173f384db55b68287
  "specs/page-capture#design/ui": sha256:b81f34400802db00f45743e5570ce71a577deadb5476e0e23a5848eedabdeb7c
  "specs/project-candidate-management#contract": sha256:6a21850a00adeaa6119357654f9862d345b483730a63f3ce39e1c92f5a62a84d
  "specs/project-candidate-management#design/main": sha256:4c8bfa942a4a22fba59e62cb700e4a904cf0fd4be9df38daaf870427340d00f8
  "specs/project-candidate-management#design/ui": sha256:9718084f863d3b82d867da549a620b98768864d4c09f1ac3b7a11131e56f0e60
  "specs/site-extraction-authoring#contract": sha256:ad81547f3929b474d99b8e9712f72cbf38b3267e742f1acc3a45871182dbfc52
  "specs/site-extraction-authoring#design/main": sha256:fd00a1386f0528df80f7460d0f842389815edbabb4bdfb5bc723171981cac782
---
## 判断

基準 `c092c64cb0983abf0be75eae2c3eeacb3285a9b0` と現行 `9435cafc2fc541b1849834979d2985c86b5831a1` を比較した。`page-capture` は管理された消費者を持たなかった `unconfirmed-capture-result` export と、候補管理の owns を指していた `candidate-edit-handoff` consume を廃止し、候補管理所有の `candidate-capture-handoff` export を消費する形へ置換した。`CaptureResult` は tab に結び付く session 内部値となり、候補編集へ渡す永続境界は handoff 一つに限定される。

`project-candidate-management` は handoff を所有し、URL・種別・取得時刻・任意価格、各元表記、取得時分類と既存属性キーを完全な入力として受け、ローカルIDと初回プライマリ指定を補う。未確認の分類と属性は確認済み `category: PartCategory` 投影を変更しない。従って既存の `project-candidate-state` consumer である `current-build-management` と `basic-compatibility` は従来の確認済み分類・属性だけを読み続け、後者の confirmed-values-only 不変条件にも適合する。候補管理は不適合な旧保存値を初期状態として扱い、個別移行を要求しない。`local-data-storage` の有効な完全ルートを保存・再読込する境界も維持される。

新規 `site-extraction-authoring` は規約確認、保存資料検証、登録、再生成を所有し、`page-capture` だけが検証済み登録を消費する。Skill、ローカル資料、判断記録は製品実行時の依存に入らない。`page-capture` は既存 `CATEGORY_ATTRIBUTES` のキーだけを未確認値として渡し、プロダクトが扱わない属性やページにない値を追加・推測しない。登録失敗時は汎用抽出へフォールバックし、authoring再生成失敗は既存登録を置換しない。

現行グラフは6 Contract、8 dependency reference、所有重複0、循環0である。`candidate-capture-handoff` の管理consumerは `page-capture`、`validated-site-extraction-registration` の管理consumerも `page-capture` であり、追加・置換された各seamの消費者は同じマイルストーン内で更新されている。外部に公開されたAPIや他リポジトリconsumerは確認されない。ブラウザのローカル保存は既存の保存境界内であり、メーカーサイトのページアクセスは既存の利用者起点Captureに留まり、規約確認とローカル資料の扱いは新規Skillの停止条件で管理する。利用者が依頼した既存属性までの取得以外の外部互換選択は生じない。

よって、マイルストーンはすべての永続seamで整合している。
