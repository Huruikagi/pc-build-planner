/**
 * サイドパネルのシェル。ナビゲーション、共通のプロジェクトバー、画面の切替。
 *
 * 常設ナビは 3 面 (`docs/reverse/changes.md` C-3 と C-4 で設定画面が消えた)。
 * 画面をここへ足すときは `SCREENS` に 1 行足す。feature registry や
 * contribution 機構は持たない (C-5)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { removeCandidateReferences } from "./build.js";
import { BuildScreen } from "./build-screen.js";
import { manufacturerDomainEntryForUrl } from "./capture/manufacturer-domain-map.js";
import type { CaptureDriver } from "./capture/protocol.js";
import type { CaptureResult, CaptureState } from "./capture/types.js";
import { CaptureScreen } from "./capture-screen.js";
import { CompatibilityScreen } from "./compatibility-screen.js";
import { t } from "./i18n.js";
import {
  BuildIcon,
  ChevronIcon,
  CompatibilityIcon,
  PartsIcon,
  PlusIcon,
} from "./icons.js";
import type { LocalDataRoot } from "./model.js";
import {
  type CandidateCaptureHandoff,
  draftFromCaptureHandoff,
  type PartDraft,
  registerCandidateDeletionReferenceCleanup,
} from "./parts.js";
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

/** ページ取得の内部型を、候補管理が所有する受入入力へ境界で写す。 */
const candidateHandoffFromCapture = (
  result: CaptureResult,
): CandidateCaptureHandoff => ({
  originals: {
    name: result.fields.name?.original ?? null,
    manufacturer: result.fields.manufacturer?.original ?? null,
    modelNumber: result.fields.modelNumber?.original ?? null,
    category: result.fields.category?.original ?? null,
  },
  capturedAttributeCategory: result.categoryHint,
  attributes: {},
  source: {
    url: result.url,
    kind:
      manufacturerDomainEntryForUrl(result.url) === undefined
        ? "retail"
        : "manufacturer",
    capturedAt: result.capturedAt,
    price: result.price?.money ?? null,
  },
});

/**
 * プロジェクト未選択の空状態。3 画面が同じプレースホルダを各自で持っていた
 * のをここへ引き上げた (`docs/reverse/changes.md` C-8)。
 *
 * プロジェクトの作成自体はポップオーバーが持つ (C-1)。ここが持つのはその
 * 入口だけで、本文へ CRUD を戻さない。取り込みは起点をパネルへ置けない
 * (C-7) が、こちらは置けるので押せるボタンにしてよい。
 */
const NoProject = ({
  onCreate,
  pendingHandoff,
}: {
  readonly onCreate: () => void;
  readonly pendingHandoff: boolean;
}) => (
  <div className="empty-project">
    {/* 見出しは置かない。「プロジェクトがありません」はヘッダが既に出している。 */}
    <p className="empty-project__body">{t("projectEmptyBody")}</p>
    {pendingHandoff ? (
      <p className="empty-project__handoff" role="status">
        {t("projectEmptyHandoff")}
      </p>
    ) : null}
    <button
      className="button button--primary button--wide empty-project__action"
      data-create-project
      onClick={onCreate}
      type="button"
    >
      <PlusIcon />
      {t("projectCreateAction")}
    </button>
  </div>
);

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
  const projectMenuToggleRef = useRef<HTMLButtonElement>(null);
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

  useEffect(
    () =>
      registerCandidateDeletionReferenceCleanup((current, candidateId) =>
        removeCandidateReferences(current, candidateId),
      ),
    [],
  );

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
        return true;
      }
      setFailure(result.error);
      return false;
    },
    [store],
  );

  const closeProjectMenu = useCallback(() => {
    setMenuOpen(false);
    projectMenuToggleRef.current?.focus();
  }, []);

  if (failure !== null && root === null)
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
          ref={projectMenuToggleRef}
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
            onClose={closeProjectMenu}
            onCreate={(name) => apply(createProject(name))}
            onDelete={(id) => apply(deleteProject(id))}
            onRename={(id, name) => apply(renameProject(id, name))}
            onSelect={(id) => apply(selectProject(id))}
            projects={root.projects}
            selectedProjectId={root.selectedProjectId}
          />
        ) : null}
      </div>

      {failure === null ? null : (
        <div className="notice notice--error" role="alert">
          {failureMessage(failure)}
          <button className="button" onClick={() => void load()} type="button">
            {t("retry")}
          </button>
        </div>
      )}

      {/**
       * 取り込み面が最優先。プロジェクトが無くても取り込みは成立し、
       * 保存を押した時点の下書きは `handoff` が保持し続ける (C-8)。
       */}
      {capture !== null ? (
        <CaptureScreen
          onAccept={(result) => {
            setHandoff(
              draftFromCaptureHandoff(candidateHandoffFromCapture(result)),
            );
            setScreenId("parts");
            void captureDriver.clear();
          }}
          onDismiss={() => void captureDriver.clear()}
          state={capture}
        />
      ) : project === null ? (
        <NoProject
          onCreate={() => setMenuOpen(true)}
          pendingHandoff={handoff !== null}
        />
      ) : (
        <screen.View
          apply={apply}
          handoff={screenId === "parts" ? handoff : null}
          onHandoffConsumed={() => setHandoff(null)}
          onNavigate={setScreenId}
          project={project}
          root={root}
        />
      )}
    </div>
  );
};
