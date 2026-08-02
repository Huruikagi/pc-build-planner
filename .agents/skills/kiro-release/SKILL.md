---
name: kiro-release
description: 完了済みKiroマイルストーンを正式リリースする。バージョン同期、仕様・Issue完了ゲート、完全検証、mainへの限定コミットとpush、GitHub Release workflowの起動・監視、タグ・成果物・マイルストーンの公開後検証、完了したroadmap.mdの削除コミットまでを一貫して行う。ユーザーがバージョンリリース、マイルストーン公開、CIリリース、またはリリース後のroadmap整理を依頼したときに使用する。
---

# Kiro Release

## Overview

完了済みマイルストーンを、安全な停止点とfresh evidenceを保ちながら正式公開する。公開操作を一括script化せず、各ゲートを確認してから次へ進む。

<instructions>

## 1. リリース対象を確定する

- ユーザー指定を `X.Y.Z` と `vX.Y.Z` のどちらでも受け、version=`X.Y.Z`、tag/milestone=`vX.Y.Z`へ正規化する。
- バージョンがなければroadmap、GitHubのopen milestone、現在versionから候補を一つに絞る。複数候補が残る場合は質問する。
- Git remoteから`owner/repo`を解決し、現在ブランチが`main`、`HEAD == origin/main`、作業ツリーがcleanであることを要求する。差分、未追跡ファイル、branch divergenceがあれば変更前に停止する。
- `gh auth status`、`.github/workflows/release.yml`、`scripts/release-version.mjs`、`package.json`、`manifest.json`を確認する。
- 対象tagまたはReleaseが既に存在する場合は新規公開を続行しない。公開後検証だけを依頼された場合はStep 8へ進む。

## 2. マイルストーン完了証拠を監査する

- GitHub連携を優先して対象マイルストーンの全Issueを取得する。マイルストーンやActions情報が不足する場合だけ認証済み`gh`を使う。
- roadmapがあればscope、spec一覧、Existing Spec Updates、Direct Implementation Candidates、Implementation Validation Historyを読む。
- 対応する各specの`spec.json`と`tasks.md`を確認し、未完了task 0件を要求する。
- 対象specごとに現在のマイルストーンで`GO`のvalidation記録を要求する。`+dirty`、`NO-GO`、`MANUAL_VERIFY_REQUIRED`、記録なしを完了証拠にしない。
- spec外のIssueは、成果物またはsteering文書への反映を直接確認する。
- 各open Issueを完了済みscopeへ明示的に対応付ける。対応不能、未実装、未検証、曖昧なIssueが一つでもあれば、Issueを閉じずに停止する。
- Issue本文の古いcheckboxが未更新でも、承認済みspec、完了task、GO記録、現行成果物が要求を置き換えたことを説明できる場合だけ完了と判断する。

## 3. versionを同期する

- リリースscriptが読むversion sourceだけを更新する。このリポジトリでは`package.json`と`manifest.json`の`version`を同じ`X.Y.Z`へ変更する。
- 過去versionを説明する文書、fixture、汎用テストデータは機械的に置換しない。
- `git diff --check`と`node scripts/release-version.mjs`を実行し、`version=X.Y.Z`、`tag=vX.Y.Z`、期待するZIP名を確認する。
- version解決テストが存在する場合は実行する。

## 4. 完全検証とpackageを行う

- `pnpm validate`をfreshに実行し、exit code、pass/fail/skip数を記録する。
- 失敗、cancel、予期しないskipがあればcommitせず停止する。manual smokeのskipは別のfresh evidenceで充足済みか確認する。
- `pnpm package`を実行し、`release/pc-build-planner-vX.Y.Z.zip`の生成を確認する。
- `git status`を再確認し、version source以外をリリースcommitへ含めない。生成物が追跡対象になった場合は停止する。

## 5. version commitをpushする

- version sourceだけをstageする。
- staged diffと検証結果を確認し、`chore: bump version to X.Y.Z`でcommitする。
- `origin/main`へpushし、`HEAD == origin/main`を確認する。

## 6. 完了Issueを閉じる

- Step 2で完了を立証したIssueだけを列挙し、mutation前に番号をユーザーへ短く通知する。
- GitHub連携で`completed`として閉じ、open 0件、closed 1件以上を再取得して確認する。
- 一件でもcloseに失敗した場合はRelease workflowを起動しない。

## 7. Release workflowを監視する

- `.github/workflows/release.yml`を`main`でdispatchする。
- run URLまたはIDを取得し、`gh run watch <id> --exit-status`で完了まで監視する。
- version/tag/milestone gate、E2E込みValidate、Package、artifact upload、release notes、Release作成、milestone closeの全step成功を確認する。
- 失敗時はjob logを確認して原因を報告する。自動再実行しない。

## 8. 公開結果を検証する

- `$kiro-verify-completion`の`TASK`ゲートとして次をfreshに確認する。
  - workflow runが`completed/success`
  - Releaseがdraftでもprereleaseでもなく公開済み
  - tagがversion commitの完全SHAを指す
  - expected ZIP assetがuploaded状態
  - milestoneがclosed、open issue 0、closed issue 1以上
  - local `main`がcleanで`origin/main`と同期
- 一つでも欠ける場合は`NOT_VERIFIED`または`MANUAL_VERIFY_REQUIRED`とし、完了を主張しない。

## 9. 完了roadmapを削除する

- Release公開とmilestone closeの検証成功後にだけ実行する。
- roadmapが対象リリースだけを扱い、次リリースの未完了scopeや進行中validation recordを含まないことを確認する。
- 次リリースの内容を含む場合は削除せず、archive方法をユーザーへ確認する。
- 対象リリースだけならroadmapを削除する。Kiro skillや過去spec内の一般参照は履歴・手順なので書き換えない。
- 削除だけをstageし、`docs: remove completed vX.Y.Z roadmap`で別commitにする。
- `origin/main`へpushし、ファイル不在、commit差分、clean worktree、`HEAD == origin/main`をfreshに確認する。

## 10. 結果を報告する

- Release URL、workflow URL、version commit、roadmap削除commit、検証件数、skipの意味、milestone件数、ZIP名、最終検証判定を簡潔に報告する。

</instructions>

## 失敗時の安全策

- Release作成前の失敗では、原因を修正・再検証するまでworkflowを再起動しない。
- Release作成済みでmilestone closeだけ失敗した場合はworkflowを再実行しない。公開結果を検証してmilestoneだけを手動で閉じる。
- push済みversion commitを、リリース失敗だけを理由にreset、force-push、revertしない。
- Issueを証拠なしに閉じず、Release gateを通す目的だけの状態変更をしない。
- unrelated changesをstage、commit、削除しない。
- roadmapをRelease公開前に削除しない。validation historyはリリース前監査の根拠として保持する。
