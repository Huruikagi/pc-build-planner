/**
 * サイドパネルのシェル。ナビゲーション、共通のプロジェクトバー、画面の切替。
 *
 * 常設ナビは 3 面 (`docs/reverse/changes.md` C-3 と C-4 で設定画面が消えた)。
 * 画面をここへ足すときは `SCREENS` に 1 行足す。feature registry や
 * contribution 機構は持たない (C-5)。
 */
import { useCallback, useEffect, useState } from "react";
import { BuildScreen } from "./build-screen.js";
import type { CaptureDriver } from "./capture/protocol.js";
import type { CaptureState } from "./capture/types.js";
import { CaptureScreen } from "./capture-screen.js";
import { CompatibilityScreen } from "./compatibility-screen.js";
import { t } from "./i18n.js";
import {
  BuildIcon,
  ChevronIcon,
  CompatibilityIcon,
  PartsIcon,
} from "./icons.js";
import type { LocalDataRoot } from "./model.js";
import { draftFromCapture, type PartDraft } from "./parts.js";
import { PartsScreen } from "./parts-screen.js";
import { ProjectMenu } from "./project-menu.js";
import {
  createProject,
  currentProject,
  deleteProject,
  renameProject,
  selectProject,
} from "./projects.js";
import type { ScreenId } from "./screen-props.js";
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

const failureMessage = (failure: StorageFailure): string =>
  failure.kind === "corrupt" ? t("storageCorrupt") : t("storageUnavailable");

export const App = ({
  capture: captureDriver,
  store,
}: {
  readonly capture: CaptureDriver;
  readonly store: Store;
}) => {
  const [root, setRoot] = useState<LocalDataRoot | null>(null);
  const [failure, setFailure] = useState<StorageFailure | null>(null);
  const [screenId, setScreenId] = useState<ScreenId>("parts");
  const [menuOpen, setMenuOpen] = useState(false);
  /** 一時表示面。拡張アイコンの操作で現れ、常設ナビには出ない。 */
  const [capture, setCapture] = useState<CaptureState | null>(null);
  /** 取り込みから引き渡された編集中の下書き。 */
  const [handoff, setHandoff] = useState<PartDraft | null>(null);

  useEffect(() => {
    const sync = () => {
      void captureDriver.read().then((state) => setCapture(state ?? null));
    };
    sync();
    return captureDriver.subscribe(sync);
  }, [captureDriver]);

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

      {capture === null ? (
        <screen.View
          apply={(mutate) => void apply(mutate)}
          handoff={screenId === "parts" ? handoff : null}
          onHandoffConsumed={() => setHandoff(null)}
          onNavigate={setScreenId}
          project={project}
          root={root}
        />
      ) : (
        <CaptureScreen
          onAccept={(result) => {
            setHandoff(draftFromCapture(result));
            setScreenId("parts");
            void captureDriver.clear();
          }}
          onDismiss={() => void captureDriver.clear()}
          state={capture}
        />
      )}
    </div>
  );
};
