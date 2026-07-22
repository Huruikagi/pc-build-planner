# プロジェクト構造

## 現在の状態

greenfield段階を終え、`src/` と `tests/` にlocal data foundation、application shell、runtime composition、候補管理の初期sliceが実装されている。新規実装は、承認済みの製品文書、roadmap、specに加え、既存コードで確立した公開境界とテスト配置を基準とする。

仕様は `.kiro/specs/<feature-name>/` にfeature単位で配置し、feature名にはkebab-caseを使用する。ステアリングはパターンを保持し、個別ファイルの完全な一覧やspecの実装詳細を重複させない。

## 組織化の方針

feature-first / vertical sliceを採用する。業務機能の契約、サービス、query、state、view、style、feature固有adapterは `src/features/<feature>/` に閉じる。

複数featureで共有する責務だけを、ドメイン、永続化、application shell、runtimeの明示的な境界へ置く。単に重複して見えるという理由で汎用 `shared` へ移動せず、canonical ownerを決めて公開契約経由で利用する。

## ディレクトリパターン

### 業務feature

**場所**: `src/features/<feature>/`

**目的**: 一つの利用者能力に関する内部実装と公開境界を所有する。

**原則**: 外部へは `public.ts` と登録portだけを公開し、他featureから内部ファイルを直接importさせない。

### Local data foundation

**場所**: `src/domain/`、`src/persistence/` およびfoundation所有adapter

**目的**: 共通ドメインモデル、canonical `Result<T, E>`、実行時検証、migration、Repository、単一write authority、原子的mutation、参照修復、atomic replacement、maintenance fencingを所有する。

**原則**: featureは公開された契約とportを利用し、Chrome Storage adapterを直接呼ばない。

### Application shell

**場所**: `src/application-shell/` とshell所有のcomposition入口

**目的**: side panel host、feature registry、typed navigation、service-worker composition、root公開API、共通loading/error/maintenance表示を所有する。

**原則**: shellはfeatureを組み立てるが、業務データの意味や保存判断を持たない。

### Runtime入口

**場所**: `src/runtime/`、root `src/index.ts`、`side-panel.html`

**目的**: Chromeの実行入口とcomposition bootstrapを提供する。

**原則**: application shellを単一のcomposition ownerとし、featureは共有runtime入口を直接編集しない。拡張イベント処理はregistration portまたはruntime adapterとしてshellへ提供する。

### テスト

**場所**: `tests/`

**目的**: ソースの責務境界を鏡像化してunit、contract、integration、runtime testを整理する。

**原則**: feature固有テストはfeatureごとにまとめ、共有基盤とcompositionのテストはそれぞれの責務別に配置する。fixtureには架空データだけを使用する。

## 所有権と依存方向

- root `src/index.ts`、`src/runtime/side-panel.ts`、`src/runtime/service-worker.ts`、`side-panel.html` はapplication shellだけがcompositionする。
- 各featureは自身の内部実装、`public.ts`、登録モジュール、必要なworker registration port/runtime adapterを所有する。
- cross-feature遷移はshell所有の `ShellNavigator` / `FeatureActivationIntent` などのtyped activation contractを使用する。
- feature間の利用は明示された上流featureの `public.ts` に限定し、deep import、DOMを介した暗黙連携、共有runtimeの直接操作を禁止する。
- 共通ドメイン型、結果型、保存primitiveをfeatureごとに再定義しない。local data foundationをcanonical ownerとする。
- 永続化mutationは単一write authorityへ集約し、成功後イベントによる別writeで参照整合性を修復しない。
- composition rootだけが具体featureの登録と公開契約を知り、feature内部はshellの具体実装へ依存しない。

概念的な依存方向は次のとおり。

```text
domain contracts
    ↓
validation / migration / repository ports
    ↓
feature services and application shell ports
    ↓
Chrome adapters and composition runtime
```

上位の安定した契約から下位の具体実装へ依存させ、adapterからドメインへプラットフォーム型を漏らさない。

## 公開APIとimport規約

```typescript
// feature外からは公開入口だけを利用する
import type { CandidateQuery } from "../features/candidate-management/public.js";

// 禁止: 他featureの内部実装へのdeep import
// import { CandidateService } from "../features/candidate-management/service.js";
```

- feature外のconsumerはfeature-owned `public.ts` だけをimportする。
- root barrelはapplication shellだけが合成し、featureはroot barrelへ自己登録しない。
- 同一feature内では相対importを使用し、featureをまたぐ依存は公開入口によって見える形にする。
- path aliasはbuild基盤導入時に決定する。未決定のaliasを前提にしない。

## 命名規約

- **ディレクトリと通常ファイル**: kebab-case（例: `application-shell/`、`feature-registry.ts`）
- **feature公開入口**: `public.ts`
- **型、interface、class、判別共用体**: PascalCase
- **関数、method、変数**: camelCase
- **定数**: 既存のWeb/TypeScript慣習に従い、共有契約上の固定識別子は意図が分かる名前にする
- **テスト**: 対象名に `.test.ts` またはReact DOM test用の `.test.tsx` を付ける
- **spec feature名**: kebab-case

## コード構成の原則

- 一つのmoduleに一つの主要責務を持たせ、契約、純粋ロジック、I/O adapter、UI state、DOM描画を分離する。
- 未信頼入力の検証は境界で行い、内部へ `unknown` やChrome固有payloadを拡散させない。
- UI、feature、foundationのどこに置くか迷う処理は、その判断に必要な知識を所有する境界へ置く。
- 新しいfeatureは共有入口を編集するのではなく、公開契約と登録portを追加してcompositionされる形にする。
- 既存specに残る共有ファイルの共同編集案は旧方針であり、最新roadmapの単一所有権を優先する。

---
_ファイルツリーではなく、新しいコードが同じ判断で配置・接続できるパターンを記録する。_
