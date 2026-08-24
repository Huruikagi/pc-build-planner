/**
 * プロジェクトのライフサイクル。ルートの置換としてのみ表現する。
 *
 * プロジェクトは構成検討の単位であり、削除すると所属する候補と現在構成も
 * 消える (`docs/reverse/features.md` 1.1)。候補を実装したらここで一緒に
 * 落とすこと。
 */
import type { LocalDataRoot, Project } from "./model.js";

export const createProject = (name: string) => (root: LocalDataRoot) => {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  return {
    ...root,
    projects: [...root.projects, project],
    /** 最初の 1 件は選択済みで始める。プロジェクトが在るのに未選択にしない。 */
    selectedProjectId: root.selectedProjectId ?? project.id,
  };
};

export const renameProject =
  (id: string, name: string) => (root: LocalDataRoot) => ({
    ...root,
    projects: root.projects.map((project) =>
      project.id === id ? { ...project, name } : project,
    ),
  });

export const deleteProject = (id: string) => (root: LocalDataRoot) => {
  const projects = root.projects.filter((project) => project.id !== id);
  return {
    ...root,
    projects,
    selectedProjectId:
      root.selectedProjectId === id
        ? (projects[0]?.id ?? null)
        : root.selectedProjectId,
  };
};

export const selectProject = (id: string) => (root: LocalDataRoot) => ({
  ...root,
  selectedProjectId: id,
});

export const currentProject = (root: LocalDataRoot): Project | null =>
  root.projects.find((project) => project.id === root.selectedProjectId) ??
  null;
