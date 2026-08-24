/**
 * 3 つの常設画面。現時点では見出しと空状態だけを持つ。
 *
 * 中身は `docs/reverse/features.md` の対応する章とデザインキャンバスの
 * アートボードを見ながら順に埋める。骨組みを先に置いているのは、シェルとの
 * 配線が実拡張で通ることを先に確かめるため。
 */
import { t } from "./i18n.js";
import type { Project } from "./model.js";

export interface ScreenProps {
  readonly project: Project | null;
}

const Placeholder = ({
  project,
  titleKey,
}: ScreenProps & { readonly titleKey: string }) => (
  <>
    <div className="section-header">
      <span>{t(titleKey)}</span>
    </div>
    <div className="placeholder">
      {project === null ? t("projectEmpty") : t("notImplemented")}
    </div>
  </>
);

export const PartsScreen = ({ project }: ScreenProps) => (
  <Placeholder project={project} titleKey="partsTitle" />
);

export const BuildScreen = ({ project }: ScreenProps) => (
  <Placeholder project={project} titleKey="buildTitle" />
);

export const CompatibilityScreen = ({ project }: ScreenProps) => (
  <Placeholder project={project} titleKey="compatibilityTitle" />
);
