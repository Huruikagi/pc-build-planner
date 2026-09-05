---
type: SpecBind Contract Review
milestone_id: 01a06f90-3083-7ae0-aa4d-5a8377aca49d
passed_at: 2026-09-05T12:21:45.91735Z
input_revisions:
  "steering/roadmap.md#cross-spec-scope": sha256:7579a3e57fbcdadaf7d773e21bc088258bb5d97a92e4646221bb30d944d50201
  "specs/basic-compatibility#contract": sha256:f8da11667c48f621b43988a628b0b80a1b7eb0676e9cae160e3d9d5055c6de92
  "specs/current-build-management#contract": sha256:11cc2bfb4081b9350628de6c333173360168eee9ce65c97340c08578c5df8f64
  "specs/current-build-management#design/main": sha256:dc94394987ee9eb22896ee2461ded22509f0c02e98dd7fd757410a25457494aa
  "specs/local-data-storage#contract": sha256:03963da69691345f8b27e2c091ca7635fb84eff9636bfcf91511da4d8f41d3af
  "specs/page-capture#contract": sha256:a2cadc6316768bc4c2ee6cc4688b6b5576dcc3831feb379936e34a48fca73300
  "specs/page-capture#design/main": sha256:b3711c9bb9ef5ec60a530bf73c573cc994c1888a7069e58a7c16b06ce54a347a
  "specs/project-candidate-management#contract": sha256:5861d26029f4460c2ef366fa4abd6c69b8d019e6e0800af65b2242c31162f14d
  "specs/project-candidate-management#design/main": sha256:5edf1c5479c0ef377314295a11c6b1ce04cf8da75ff0925237b823f1bbc8051b
---
# Contract Review

基準 `bb8dc73f92bb48a861544b0617639308944fc09c` にはContractが存在せず、現在の五つのContractは逆確立で追加された。Roadmapの五つの参加Specを完全範囲として照合した結果、各Specが追加した永続境界、export、consume、invariant、file ownershipは現在のContractで表現されている。

`local-data-storage` は完全ルートの端末内保存・再読込だけをexportする。保存値が未保存・利用不能なら初期ルートを返すため、保存形式を外部公開契約とせず、migration、recovery、backupを約束しない。managed Spec外の保存先は端末内の `chrome.storage.local` だけであり、この意図は逆確立の対象実装と維持方針で明示済みである。

`project-candidate-management` はURL-only候補を含む候補状態を所有し、`candidate-deletion-reference-cleanup` を候補削除の開始・順序だけの一方向拡張点としてexportする。`current-build-management` はその拡張点と候補状態をconsumeし、全プロジェクトの現在構成から指定候補ID参照だけを除く変換を登録する。候補管理は現在構成をconsumeせず、その変換の意味を再実装しない。よって候補削除の整合は保たれ、所有重複もdependency cycleもない。

`page-capture` は未確認の `CaptureResult` を候補編集へ渡すexportを持つ。managed Specは直接consumeしないが、Side Panelの取り込み導線が同Specの `src/app.tsx` で候補編集の `draftFromCapture` へ渡す実装コンシューマーである。今回のscopeはこの取り込みから候補編集への受渡しを明示的に確立しており、未消費warningは将来用の未根拠なseamではない。結果はsession保存に留まり永続候補値を直接更新しないため、端末内保存shapeの互換性影響もない。取り込み専用CSS、HTML読込、build assetの所有はcapture Specに閉じ、共有UI所有との重複はない。

`basic-compatibility` は候補状態と現在構成状態をconsumeし、確認済み属性だけで五規則を評価する。候補ID参照と数量の整合をcurrent-build側が、候補属性と確認済み値の意味をcandidate側が所有するため、評価側はそれらを重複所有しない。

`specbind check contracts` は5 Contract、7参照、ownership finding 0、dependency cycle 0を確認した。唯一のunconsumed exportは上記の実装コンシューマーと今回の明示scopeにより維持理由を確認した。外部リポジトリ、公開API、運用契約の追加・変更を示す証拠はなく、ユーザーが確認済みのURL-only保存と破損値の破棄・再初期化方針を超える互換性判断はない。全persistent seamはcoherentである。
