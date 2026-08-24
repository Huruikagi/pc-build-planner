/**
 * 全画面が共有する props。
 *
 * すべての画面が同じ形を受けることで、`app.tsx` の `SCREENS` の表を一様に
 * 保てる。画面を足すときは表へ 1 行足すだけで済む。
 */
import type { LocalDataRoot, Project } from "./model.js";
import type { PartDraft } from "./parts.js";

export type ScreenId = "parts" | "build" | "compatibility";

export interface ScreenProps {
  readonly root: LocalDataRoot;
  /** 未選択の空状態は `app.tsx` が持つので、画面には常に選択済みが届く (C-8)。 */
  readonly project: Project;
  readonly apply: (mutate: (current: LocalDataRoot) => LocalDataRoot) => void;
  /** 取り込みから引き渡された下書き。パーツ管理だけが受け取る。 */
  readonly handoff: PartDraft | null;
  readonly onHandoffConsumed: () => void;
  /** 別の画面へ移す。互換性確認から不足の解消へ導くのに使う。 */
  readonly onNavigate: (screen: ScreenId) => void;
}
