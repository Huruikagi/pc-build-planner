---
type: Deferred Findings
---

# Deferred findings

- Spec `project-candidate-management`; source revision `bb8dc73f92bb48a861544b0617639308944fc09c`; locator `src/model.ts:122-132`: 商品名が必須で、確認済みの「URLだけでも候補を保存できる」維持要件を満たさない。
- Spec `page-capture`; source revision `bb8dc73f92bb48a861544b0617639308944fc09c`; locator `src/service-worker.ts:53-55`: 不正な取り込みメッセージが`invalidPayload`失敗へ遷移せず、`extracting`状態が残る可能性がある。
- Spec `project-candidate-management`; source revision `bb8dc73f92bb48a861544b0617639308944fc09c`; locator `src/project-menu.tsx:183-186`: プロジェクトごとの候補数と採用数が実データではなく常に0として表示される。
- Spec `project-candidate-management`; source revision `bb8dc73f92bb48a861544b0617639308944fc09c`; locator `README.md:76`: `changes.md`をC-1〜C-6と説明するが、同文書にはC-7とC-8も存在する。
- Spec `current-build-management`; source revision `bb8dc73f92bb48a861544b0617639308944fc09c`; locator `src/model.ts:4-5`: 現在構成が未実装というコメントが、現行実装とE2Eに反している。
