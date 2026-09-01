---
type: SpecBind Release Adapter
---

# リリースアダプタ

## 準備

1. リリース対象が `main` にあり、公開対象として意図したコミットであることを確認する。
2. `manifest.json` と `package.json` の `version` を同じリリースバージョンへ更新する。
   `node scripts/release-version.mjs` が成功し、`version`、`tag=v<version>`、
   `zipFileName=pc-build-planner-v<version>.zip` を出力することを確認する。
3. GitHubに、タグ名と同じタイトル `v<version>` のopenなMilestoneが存在することを
   確認する。そのMilestoneにはclosed Issueが1件以上あり、open Issueが0件でなければ
   ならない。リリースノートの分類に使うIssueには、必要に応じて `enhancement`、`bug`、
   `documentation` のラベルを付ける。いずれにも該当しないIssueは「その他」に分類される。
4. 同名のGitタグとGitHub Releaseがまだ存在しないことを確認する。
5. `pnpm install --frozen-lockfile`、`pnpm install:e2e-browser`、`pnpm validate`、
   `pnpm package` を実行する。`release/pc-build-planner-v<version>.zip` が生成されることを
   確認し、公開対象外の作業ツリー変更を残したまま公開へ進まない。

## 公開

1. GitHub Actionsの `Release` workflowを、公開対象の `main` から手動実行する。
2. workflowはバージョン、同名タグとReleaseの不在、Milestone、およびIssue件数を再確認し、
   `pnpm validate` と `pnpm package` を実行する。
3. workflowが生成したzipと、Milestoneのclosed Issueから生成したリリースノートを添えて、
   `v<version>` のGitHub Releaseを作成する。
4. GitHub Releaseの作成後、対象Milestoneをcloseする。Chrome Web Storeへの申請や公開は
   この手順に含めない。

## 検証

公開workflowの出力だけに依存せず、GitHubから次を新しく取得して確認する。

1. `Release` workflowが成功している。
2. `v<version>` のGitHub Releaseが公開済みで、意図した `main` のコミットを指す同名タグに
   結び付いている。
3. Releaseに `pc-build-planner-v<version>.zip` が添付され、ダウンロードできる。
4. ダウンロードしたzipを展開でき、ルートに `manifest.json` があり、その `version` が
   公開バージョンと一致する。
5. `v<version>` のMilestoneがclosedである。Releaseは公開済みだがMilestoneだけがopenの
   場合、公開を巻き戻さずMilestoneを手動でcloseし、再確認する。

## 完了後

なし。
