/**
 * プロジェクトの切替・作成・改名・削除をまとめたポップオーバー。
 *
 * `docs/reverse/changes.md` C-1 の実装。プロジェクトという「入れ物」の操作は
 * 入れ物を選ぶ場所に置く。パーツ管理画面の本文へ戻さないこと。モーダルにも
 * インライン展開にもしない（理由は C-1 の表）。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n.js";
import { CheckIcon, DeleteIcon, PlusIcon, RenameIcon } from "./icons.js";
import type { Project } from "./model.js";

interface ProjectMenuProps {
  readonly projects: readonly Project[];
  readonly selectedProjectId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onCreate: (name: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onClose: () => void;
}

export const ProjectMenu = ({
  projects,
  selectedProjectId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: ProjectMenuProps) => {
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  /** 改名は明示操作で開くので、開いた直後は入力へ進めてよい。 */
  useEffect(() => {
    if (editingId !== null) renameInputRef.current?.focus();
  }, [editingId]);

  /** 外側クリックと Escape で閉じる。破壊的操作の確認中は閉じない。 */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (confirmingId !== null) return;
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target))
        return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmingId !== null) {
        setConfirmingId(null);
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmingId, onClose]);

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name === "") {
      setNameError(true);
      return;
    }
    onCreate(name);
    setNewName("");
    setNameError(false);
  };

  const submitRename = (event: React.FormEvent, id: string) => {
    event.preventDefault();
    const input = new FormData(event.target as HTMLFormElement).get("name");
    const name = typeof input === "string" ? input.trim() : "";
    if (name === "") return;
    onRename(id, name);
    setEditingId(null);
  };

  return (
    <div className="project-menu" ref={containerRef}>
      <div className="project-menu__heading">{t("projectMenuHeading")}</div>

      {projects.map((project) => {
        const isCurrent = project.id === selectedProjectId;

        if (confirmingId === project.id)
          return (
            <div className="project-menu__confirm" key={project.id}>
              <div>{t("projectDeleteConfirm", project.name)}</div>
              <div className="project-menu__confirm-actions">
                <button
                  className="button button--danger"
                  onClick={() => {
                    onDelete(project.id);
                    setConfirmingId(null);
                  }}
                  type="button"
                >
                  {t("projectDeleteAction")}
                </button>
                <button
                  className="button"
                  onClick={() => setConfirmingId(null)}
                  type="button"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          );

        if (editingId === project.id)
          return (
            <div className="project-menu__row" key={project.id}>
              <form
                className="project-menu__rename-form"
                onSubmit={(event) => submitRename(event, project.id)}
              >
                <input
                  aria-label={t("projectRename", project.name)}
                  className="field"
                  defaultValue={project.name}
                  name="name"
                  ref={renameInputRef}
                />
                <button className="button button--primary" type="submit">
                  {t("projectCreate")}
                </button>
              </form>
            </div>
          );

        return (
          <div
            className={
              isCurrent
                ? "project-menu__row project-menu__row--current"
                : "project-menu__row"
            }
            key={project.id}
          >
            <button
              aria-label={t("projectSelect", project.name)}
              className="project-menu__select"
              onClick={() => {
                onSelect(project.id);
                onClose();
              }}
              type="button"
            >
              <span className="project-menu__label">
                {isCurrent ? (
                  <CheckIcon />
                ) : (
                  <span className="project-menu__check-spacer" />
                )}
                <span className="project-menu__name">{project.name}</span>
              </span>
              {/* 候補数・採用数は候補管理を実装したら実データへ差し替える。 */}
              <span className="project-menu__summary">
                {t("projectSummary", "0", "0")}
              </span>
            </button>
            <button
              aria-label={t("projectRename", project.name)}
              className="project-menu__icon-button"
              onClick={() => setEditingId(project.id)}
              type="button"
            >
              <RenameIcon />
            </button>
            <button
              aria-label={t("projectDelete", project.name)}
              className="project-menu__icon-button"
              onClick={() => setConfirmingId(project.id)}
              type="button"
            >
              <DeleteIcon />
            </button>
          </div>
        );
      })}

      <form className="project-menu__create" onSubmit={submitCreate}>
        <PlusIcon />
        <input
          aria-label={t("projectNamePlaceholder")}
          className="field"
          name="project-name"
          onChange={(event) => {
            setNewName(event.target.value);
            setNameError(false);
          }}
          placeholder={t("projectNamePlaceholder")}
          value={newName}
        />
        <button className="button button--primary" type="submit">
          {t("projectCreate")}
        </button>
      </form>
      {nameError ? (
        <div className="error-text" role="alert">
          {t("projectNameRequired")}
        </div>
      ) : null}
    </div>
  );
};
