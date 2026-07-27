# Brief: backup-restore

## Problem

ローカルファーストの拡張は、拡張削除やデータ破損によって全情報を失う可能性があり、端末内データだけでは継続利用の安全性が不足する。

## Current State

データをJSONでバックアップ・復元する要求はあるが、交換形式、検証、復元時の失敗処理は定義・実装されていない。

## Desired Outcome

ユーザーが常設の設定画面にあるバックアップ・復元区画から、全データをバージョン付きJSONへ手動エクスポートし、内容を検証したうえで参照整合性を壊さず復元できる。拡張削除時の消失リスクも理解できる。

## Approach

永続化モデルとは分離したバージョン付き交換形式を定義する。設定画面が所有する区画へ公開section mount契約で操作面を埋め込み、extension pageでファイルを生成・選択する。復元前に構造、サイズ、バージョン、ID参照を検証してから、失敗時に既存データを保持できる原子的な置換手順を採用する。

## Scope

- **In**: 全データのJSONエクスポート、ファイル名と形式バージョン、手動ファイル選択、復元前検証、非対応バージョン・不正データ・容量超過の扱い、確認UI、原子的復元、データ消失リスクの表示。
- **Out**: 自動・定期バックアップ、通知、クラウド保存、端末間同期、差分マージ、CSV、商品カタログ再配布、設定画面・常設ナビゲーション・shell compositionの所有。

## Boundary Candidates

- バージョン付き交換スキーマ
- エクスポートファイル生成
- インポート検証と原子的復元
- `BackupRestoreSectionMount`による埋め込み可能な操作面

## Out of Boundary

- ブラウザ外のバックアップ保管責任
- 複数バックアップの自動統合
- 将来Webサービスへの実際の移行処理
- 設定画面のlayout、navigation、言語区画、およびshell状態表示

## Upstream / Downstream

- **Upstream**: local-data-foundation、project-candidate-management、current-build-management、application-shellの公開mount lifecycle。
- **Downstream**: settings-screen、将来のデータ移行、Webアプリ、同期機能。

## Existing Spec Touchpoints

- **Extends**: 独立feature registrationとnavigationを廃止し、`BackupRestoreSectionMount`をsettings-screenへ提供する。
- **Adjacent**: local-data-foundationの保存スキーマを直接公開せず、安定した交換形式へ変換する。settings-screenはsection hostと設定rootとの協調mount/unmount順序だけを所有する。本機能はsection handle内の購読・DOM cleanupを所有し、settings-screenへバックアップ内部stateや完全data portを移管しない。

## Constraints

ファイル処理はDOMを利用できるextension pageで行う。復元をservice workerの一時メモリだけに依存させない。10MB上限と書き込み失敗を事前に扱い、不正入力によって既存データを失わない。
