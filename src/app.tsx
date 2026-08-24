/**
 * サイドパネルのシェル。ナビゲーション、共通のプロジェクトバー、画面の切替。
 *
 * 常設ナビは 3 面 (`docs/reverse/changes.md` C-3 と C-4 で設定画面が消えた)。
 * 画面をここへ足すときは `SCREENS` に 1 行足す。feature registry や
 * contribution 機構は持たない (C-5)。
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "./i18n.js";
import {
  BuildIcon,
  ChevronIcon,
  CompatibilityIcon,
  PartsIcon,
} from "./icons.js";
import type { LocalDataRoot } from "./model.js";
import { ProjectMenu } from "./project-menu.js";
import {
  createProject,
  currentProject,
  deleteProject,
  renameProject,
  selectProject,
} from "./projects.js";
import { BuildScreen, CompatibilityScreen, PartsScreen } from "./screens.js";
import type { StorageFailure, Store } from "./storage.js";

const SCREENS = [
  { id: "parts", labelKey: "navParts", Icon: PartsIcon, View: PartsScreen },
  { id: "build", labelKey: "navBuild", Icon: BuildIcon, View: BuildScreen },
  {
    id: "compatibility",
    labelKey: "navCompatibility",
    Icon: CompatibilityIcon,
    View: CompatibilityScreen,
  },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

const failureMessage = (failure: StorageFailure): string =>
  failure.kind === "corrupt" ? t("storageCorrupt") : t("storageUnavailable");

export const App = ({ store }: { readonly store: Store }) => {
  const [root, setRoot] = useState<LocalDataRoot | null>(null);
  const [failure, setFailure] = useState<StorageFailure | null>(null);
  const [screenId, setScreenId] = useState<ScreenId>("parts");
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await store.read();
    if (result.ok) {
      setRoot(result.value);
      setFailure(null);
      return;
    }
    setFailure(result.error);
  }, [store]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (mutate: (current: LocalDataRoot) => LocalDataRoot) => {
      const result = await store.mutate(mutate);
      if (result.ok) {
        setRoot(result.value);
        setFailure(null);
        return;
      }
      setFailure(result.error);
    },
    [store],
  );

  if (failure !== null)
    return (
      <div className="shell">
        <div className="notice notice--error" role="alert">
          {failureMessage(failure)}
        </div>
        <div className="placeholder">
          <button className="button" onClick={() => void load()} type="button">
            {t("retry")}
          </button>
        </div>
      </div>
    );

  if (root === null)
    return (
      <div className="shell">
        <div className="placeholder" role="status">
          {t("shellLoading")}
        </div>
      </div>
    );

  const project = currentProject(root);
  const screen = SCREENS.find((entry) => entry.id === screenId) ?? SCREENS[0];

  return (
    <div className="shell">
      <nav aria-label={t("navigationLabel")} className="nav">
        {SCREENS.map(({ id, labelKey, Icon }) => (
          <button
            aria-current={id === screenId ? "page" : undefined}
            className="nav__item"
            data-screen={id}
            key={id}
            onClick={() => setScreenId(id)}
            type="button"
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div className="project-bar">
        <button
          aria-expanded={menuOpen}
          aria-haspopup="true"
          aria-label={t("projectMenuOpen")}
          className="project-bar__current"
          data-project-menu-toggle
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          <span
            className={
              project === null
                ? "project-bar__name project-bar__name--empty"
                : "project-bar__name"
            }
          >
            {project?.name ?? t("projectEmpty")}
          </span>
          <ChevronIcon open={menuOpen} />
        </button>

        {menuOpen ? (
          <ProjectMenu
            onClose={() => setMenuOpen(false)}
            onCreate={(name) => void apply(createProject(name))}
            onDelete={(id) => void apply(deleteProject(id))}
            onRename={(id, name) => void apply(renameProject(id, name))}
            onSelect={(id) => void apply(selectProject(id))}
            projects={root.projects}
            selectedProjectId={root.selectedProjectId}
          />
        ) : null}
      </div>

      <screen.View project={project} />
    </div>
  );
};
