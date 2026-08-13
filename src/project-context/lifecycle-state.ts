import type { ProjectId, Result } from "../domain/public.js";
import type {
  ProjectLifecycleError,
  ProjectLifecycleService,
} from "./lifecycle-service.js";
import type { ProjectContextReadPort } from "./public.js";

export interface ProjectLifecycleStateSnapshot {
  readonly nameInput: string;
  readonly editingProjectId: ProjectId | null;
  readonly deletion: {
    readonly projectId: ProjectId;
    readonly projectName: string;
  } | null;
  readonly pending: boolean;
  readonly fieldError: "required" | null;
  readonly error: ProjectLifecycleError | null;
}

export interface ProjectLifecycleState {
  getSnapshot(): ProjectLifecycleStateSnapshot;
  subscribe(
    listener: (snapshot: ProjectLifecycleStateSnapshot) => void,
  ): () => void;
  setNameInput(value: string): void;
  beginRename(
    projectId: ProjectId,
  ): Result<void, { readonly kind: "project-not-found" }>;
  requestDelete(
    projectId: ProjectId,
  ): Result<void, { readonly kind: "project-not-found" }>;
  cancelDelete(): void;
  submitCreate(): Promise<void>;
  submitRename(): Promise<void>;
  confirmDelete(): Promise<void>;
  retryRefresh(): Promise<void>;
}

export const createProjectLifecycleState = (_dependencies: {
  readonly read: ProjectContextReadPort;
  readonly lifecycle: ProjectLifecycleService;
}): ProjectLifecycleState => {
  type Listener = (snapshot: ProjectLifecycleStateSnapshot) => void;
  const listeners = new Set<Listener>();
  let recoveryRequired = false;
  let snapshot = freezeSnapshot({
    nameInput: "",
    editingProjectId: null,
    deletion: null,
    pending: false,
    fieldError: null,
    error: null,
  });

  function freezeSnapshot(
    value: ProjectLifecycleStateSnapshot,
  ): ProjectLifecycleStateSnapshot {
    const deletion =
      value.deletion === null ? null : Object.freeze({ ...value.deletion });
    const error =
      value.error === null
        ? null
        : value.error.kind === "validation"
          ? Object.freeze({
              ...value.error,
              fields: Object.freeze({ ...value.error.fields }),
            })
          : Object.freeze({ ...value.error });
    return Object.freeze({ ...value, deletion, error });
  }

  const publish = (
    next: ProjectLifecycleStateSnapshot,
  ): ProjectLifecycleStateSnapshot => {
    snapshot = freezeSnapshot(next);
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A presentation subscriber cannot prevent other observers from updating.
      }
    }
    return snapshot;
  };
  const update = (
    patch: Partial<ProjectLifecycleStateSnapshot>,
  ): ProjectLifecycleStateSnapshot => publish({ ...snapshot, ...patch });
  const catalogItem = (projectId: ProjectId) => {
    const current = _dependencies.read.getSnapshot();
    return current.status === "ready"
      ? current.catalog.find((item) => item.id === projectId)
      : undefined;
  };
  const canMutate = (): boolean => !snapshot.pending && !recoveryRequired;
  const applyCommandResult = (
    result: Awaited<ReturnType<ProjectLifecycleService["create"]>>,
  ): void => {
    if (result.ok) {
      update({
        nameInput: "",
        editingProjectId: null,
        deletion: null,
        pending: false,
        fieldError: null,
        error: null,
      });
      return;
    }
    recoveryRequired = result.error.kind === "committed-refresh-failed";
    update({
      pending: false,
      fieldError:
        result.error.kind === "validation"
          ? (result.error.fields.name ?? null)
          : null,
      error: result.error,
    });
  };
  const runCommand = async (
    command: () => ReturnType<ProjectLifecycleService["create"]>,
  ): Promise<void> => {
    if (!canMutate()) return;
    update({ pending: true, fieldError: null, error: null });
    let result: Awaited<ReturnType<ProjectLifecycleService["create"]>>;
    try {
      result = await command();
    } catch {
      result = { ok: false, error: { kind: "storage" } };
    }
    applyCommandResult(result);
  };

  const state: ProjectLifecycleState = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setNameInput(value) {
      if (snapshot.pending || recoveryRequired) return;
      update({ nameInput: value, fieldError: null });
    },
    beginRename(projectId) {
      if (!canMutate())
        return { ok: false, error: { kind: "project-not-found" } };
      const project = catalogItem(projectId);
      if (project === undefined)
        return { ok: false, error: { kind: "project-not-found" } };
      update({
        nameInput: project.name,
        editingProjectId: project.id,
        fieldError: null,
        error: null,
      });
      return { ok: true, value: undefined };
    },
    requestDelete(projectId) {
      if (!canMutate())
        return { ok: false, error: { kind: "project-not-found" } };
      const project = catalogItem(projectId);
      if (project === undefined)
        return { ok: false, error: { kind: "project-not-found" } };
      update({
        deletion: { projectId: project.id, projectName: project.name },
        error: null,
      });
      return { ok: true, value: undefined };
    },
    cancelDelete() {
      if (snapshot.pending || recoveryRequired) return;
      update({ deletion: null });
    },
    submitCreate: () =>
      runCommand(() => _dependencies.lifecycle.create(snapshot.nameInput)),
    async submitRename() {
      const projectId = snapshot.editingProjectId;
      if (projectId === null || catalogItem(projectId) === undefined) {
        if (canMutate()) update({ error: { kind: "not-found" } });
        return;
      }
      await runCommand(() =>
        _dependencies.lifecycle.rename(projectId, snapshot.nameInput),
      );
    },
    async confirmDelete() {
      const deletion = snapshot.deletion;
      if (deletion === null || catalogItem(deletion.projectId) === undefined) {
        if (canMutate()) update({ error: { kind: "not-found" } });
        return;
      }
      await runCommand(() =>
        _dependencies.lifecycle.delete(deletion.projectId),
      );
    },
    async retryRefresh() {
      if (!recoveryRequired || snapshot.pending) return;
      update({ pending: true });
      try {
        const result = await _dependencies.lifecycle.retryRefresh();
        if (result.ok) {
          recoveryRequired = false;
          update({
            nameInput: "",
            editingProjectId: null,
            deletion: null,
            pending: false,
            fieldError: null,
            error: null,
          });
          return;
        }
        update({
          pending: false,
          error:
            result.error.kind === "operation-in-progress"
              ? result.error
              : { kind: "committed-refresh-failed" },
        });
      } catch {
        update({
          pending: false,
          error: { kind: "committed-refresh-failed" },
        });
      }
    },
  };
  return Object.freeze(state);
};
