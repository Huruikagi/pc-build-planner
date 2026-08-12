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

## Change Brief: v0.4.0

### Problem

canonical dataが破損または未対応versionになった利用者は、識別可能なエラーを確認できても、正常なbackupから安全に復旧できるproduction経路の証拠が不足している。また、restoreでproject一覧が置換される前後に現在projectの未保存編集を保護し、成功後だけ選択を再検証するowner-local lifecycleがない。context初期化失敗がsettings起動を止めると、回復経路そのものへ到達できない。

### Current State

backup/restoreは交換形式、preflight、利用者確認、maintenance下の原子的置換を提供するが、foundationのreplacement評価が正常な現行rootを前提とする経路では、破損rootからの復元を完了できない。`confirmRestore()`はcommit前のproject-context guardと成功後refresh hookを持たず、contextがunavailableな起動時にもsettings・backupを利用できるcomposition契約が不足している。

### Desired Outcome

利用者はcontextが利用不能でもsettingsのbackup区画へ到達し、破損・未対応canonical dataを識別して、明示的に選択した正常backupを検証後に回復できる。restore前にowner-local guardを通し、取消・preflight失敗・commit失敗ではcanonical dataとcurrent selectionを維持する。commit成功後だけproject-contextをrefreshし、選択修復に失敗した場合は復元成功を取り消さず、context unavailableとretryを表示する。

### Scope

- **In**: foundationの回復用replacement契約の利用、破損・未対応rootの識別、正常backupのpreflightと明示確認、restore前project-context guard、取消・失敗時のticket/入力/root保持、commit成功後だけのcontext refresh、refresh失敗時のunavailable・retry表示、context unavailableでも到達可能なsection lifecycle、回復後の候補管理再利用、feature-owned integration・production E2E。
- **Out**: schema versionのcanonical owner、replacement atomicity・context fallbackの再実装、application shellのsettings起動・port wiring、feature draft内容の解釈、自動・無確認の初期化、破損データの部分修復・merge、クラウドbackup、実データfixture。

### Boundary Impact

- **Extends**: `backup-restore`のpreflight、確認、project-context lifecycle hook、回復・refresh結果表示、section cleanup、production E2E。
- **Preserves**: 交換形式と保存schema versionの独立、利用者の明示操作、失敗時の既存データ保持、maintenance lifecycle、設定画面へのsection mount。
- **Adjacent**: `local-data-foundation`が破損rootを正常値として公開せず安全な評価・置換を、`project-context`が選択再検証とfallbackを、application shellがcontext unavailable時にもsettings/backupへ到達できるcompositionを所有する。本specは公開契約だけを利用する。

### Dependencies

- **Upstream**: Milestone v0.4.0の`local-data-foundation` update、`project-context` core contract。
- **Downstream**: `application-shell` production wiring、破損データと選択修復を含むrelease validation。

### Source

- Milestone v0.4.0 roadmap `backup-restore` update、GitHub Issues #24・#29、cross-spec decomposition review。

## Change Brief: v0.5.0

### Problem

backup envelope・artifact・preflight/confirm/commit・ticket/fenceの再利用可能なorchestrationと、PC Build Planner固有交換形式・UI・project-context lifecycleが同じfeature境界にあり、汎用部分の変更影響範囲を独立させられない。

### Current State

本specは保存schemaと独立した交換形式、JSON encode/decode、file UI、preflight、明示確認、maintenance下のatomic replacement、破損root回復、project-context guard/refreshを提供する。orchestrationは具体`BackupDataV1`とPC root mappingへ結合している。

### Desired Outcome

本specはPC固有backup metadata・交換形式mapping・file UI・利用者確認表示・project-context lifecycle・回復導線を保持し、generic envelope/artifact、decode/encode contract、preflight-confirm-commit、ticket/fence、atomic replacement orchestrationはlocal data packageの公開portだけを利用する。

### Scope

- **In**: generic orchestrationへの製品設定、PC交換形式とのadapter、foundation公開capabilityへの接続、既存preflight・確認・回復・refresh結果の非回帰、package/app contractと必要なE2E。
- **Out**: 交換形式version・内容の変更、保存schema変更、自動backup、UI layout変更、Chrome APIへのgeneric backup層からの直接依存、復元atomicityやfencingの弱体化。

### Boundary Impact

- **Extends**: generic backup orchestrationを設定する製品adapterとconsumer contractを追加する。
- **Preserves**: 保存schemaと交換形式の独立、明示確認、失敗時の既存データ保持、settings section、project-context guard/refresh。
- **Adjacent**: `local-data-library-boundaries`はgeneric orchestrationを、`local-data-foundation`はPC rootと用途限定replacement capabilityを所有する。

### Dependencies

- **Upstream**: `spec:local-data-library-boundaries`、`spec:local-data-foundation`。
- **Downstream**: Chrome adapter分離後のproduction compositionとrelease validation。

### Source

- Milestone v0.5.0、GitHub Issue #20。

## Change Brief: v0.5.0-boundary-reconciliation

### Problem

product backup adapterの実装ownerがgeneric package specと本specで重複し、production compositionの最終ownerもroadmapに欠けている。

### Current State

本specのChange Briefは製品設定・交換形式adapterを保持する一方、生成済み`local-data-library-boundaries`も`ProductBackupAdapter`を実装対象にする。

### Desired Outcome

本specがproduct backup adapter、PC交換形式codec/mapping/policy、file UI、確認、project-context lifecycleを単独所有し、generic orchestratorはpackage公開portだけから利用する。application shellは確定portを接続するだけとする。

### Scope

- **In**: product backup adapter、交換形式mapping、製品policy、foundation capability接続、guard/refresh、contract/UI/E2E。
- **Out**: generic orchestrator実装、交換形式意味変更、保存schema変更、自動backup、UI layout、shellのcomposition実装。

### Boundary Impact

- **Extends**: 製品backup設定とadapterの唯一ownerを確定する。
- **Preserves**: 明示確認、atomic replacement、fencing、失敗時既存データ保持、settings section、回復導線。
- **Adjacent**: `local-data-library-boundaries`がgeneric orchestration、`local-data-foundation`がreplacement capability、`application-shell`が公開port wiringを所有する。

### Dependencies

- **Upstream**: `spec:local-data-library-boundaries`、`spec:local-data-foundation`、`spec:project-context`。
- **Downstream**: `spec:application-shell`、release validation。

### Source

- v0.5.0 `$kiro-spec-update-batch` final review（2026-08-12）。
