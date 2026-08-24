/**
 * まだ実装していない画面の骨組み。
 *
 * 中身は `docs/reverse/features.md` の対応する章とデザインキャンバスの
 * アートボードを見ながら順に埋める。
 */
import { t } from "./i18n.js";
import type { LocalDataRoot, Project } from "./model.js";
import type { PartDraft } from "./parts.js";

/** すべての画面が同じ形を受ける。`SCREENS` の表を一様に保つため。 */
export interface ScreenProps {
  readonly root: LocalDataRoot;
  readonly project: Project | null;
  readonly apply: (mutate: (current: LocalDataRoot) => LocalDataRoot) => void;
  /** 取り込みから引き渡された下書き。パーツ管理だけが受け取る。 */
  readonly handoff: PartDraft | null;
  readonly onHandoffConsumed: () => void;
}

const Placeholder = ({
  project,
  titleKey,
}: Pick<ScreenProps, "project"> & { readonly titleKey: string }) => (
  <>
    <div className="section-header">
      <span>{t(titleKey)}</span>
    </div>
    <div className="placeholder">
      {project === null ? t("projectEmpty") : t("notImplemented")}
    </div>
  </>
);

export const BuildScreen = ({ project }: ScreenProps) => (
  <Placeholder project={project} titleKey="buildTitle" />
);

export const CompatibilityScreen = ({ project }: ScreenProps) => (
  <Placeholder project={project} titleKey="compatibilityTitle" />
);
