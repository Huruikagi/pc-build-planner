import {
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { err, ok } from "../domain/public.js";
import type {
  ProjectLifecycleMessageDescriptor,
  ProjectLifecycleMessageResolver,
  ProjectLifecycleOperation,
} from "./lifecycle-message-descriptors.js";
import type { ProjectLifecycleService } from "./lifecycle-service.js";
import type { ProjectLifecycleState } from "./lifecycle-state.js";
import type {
  ProjectContextReadPort,
  ProjectLifecyclePresentationContribution,
} from "./public.js";

export interface ProjectLifecyclePresentationMessageResolver
  extends ProjectLifecycleMessageResolver {
  getSnapshot?(): unknown;
  subscribe?(listener: () => void): () => void;
}

export interface ProjectLifecyclePresentationDependencies {
  readonly read: ProjectContextReadPort;
  readonly lifecycle: ProjectLifecycleService;
  readonly state: ProjectLifecycleState;
  readonly messages: ProjectLifecyclePresentationMessageResolver;
}

function ProjectLifecycleView({
  read,
  state,
  messages,
}: ProjectLifecyclePresentationDependencies) {
  const context = useSyncExternalStore(
    read.subscribe,
    read.getSnapshot,
    read.getSnapshot,
  );
  const lifecycle = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    state.getSnapshot,
  );
  useSyncExternalStore(
    messages.subscribe ?? (() => () => {}),
    messages.getSnapshot ?? (() => messages),
    messages.getSnapshot ?? (() => messages),
  );
  const [operation, setOperation] = useState<ProjectLifecycleOperation>();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const renameTriggerRef = useRef<HTMLButtonElement | undefined>(undefined);
  const deleteTriggerRef = useRef<HTMLButtonElement | undefined>(undefined);
  const mutationsDisabled =
    lifecycle.pending || lifecycle.error?.kind === "committed-refresh-failed";
  const projects = context.status === "ready" ? context.catalog : [];
  const resolve = (descriptor: ProjectLifecycleMessageDescriptor) =>
    messages.resolve(descriptor);
  const editingProject =
    lifecycle.editingProjectId === null
      ? undefined
      : projects.find(({ id }) => id === lifecycle.editingProjectId);
  const formDescriptor: ProjectLifecycleMessageDescriptor =
    editingProject === undefined
      ? { intent: "create-project" }
      : { intent: "rename-project", projectName: editingProject.name };

  useEffect(() => {
    if (lifecycle.editingProjectId !== null) inputRef.current?.focus();
  }, [lifecycle.editingProjectId]);
  useEffect(() => {
    if (lifecycle.deletion !== null) cancelDeleteRef.current?.focus();
  }, [lifecycle.deletion]);

  const run = async (
    nextOperation: ProjectLifecycleOperation,
    command: () => Promise<void>,
  ) => {
    if (lifecycle.pending) return;
    setOperation(nextOperation);
    await command();
    setOperation(undefined);
  };

  return (
    <section data-project-lifecycle="presentation">
      <nav aria-label={resolve({ intent: "project-list" })}>
        {projects.map((project) => {
          const renameDescriptor = {
            intent: "rename-project",
            projectName: project.name,
          } as const;
          const deleteDescriptor = {
            intent: "confirm-delete",
            projectName: project.name,
            impact: "owned-candidates",
          } as const;
          return (
            <span key={project.id}>
              <span
                aria-current={
                  context.status === "ready" &&
                  context.selectedProjectId === project.id
                    ? "page"
                    : undefined
                }
              >
                {project.name}
              </span>
              <button
                aria-label={resolve(renameDescriptor)}
                disabled={mutationsDisabled}
                onClick={(event) => {
                  renameTriggerRef.current = event.currentTarget;
                  state.beginRename(project.id);
                }}
                type="button"
              >
                {resolve(renameDescriptor)}
              </button>
              <button
                aria-label={resolve(deleteDescriptor)}
                disabled={mutationsDisabled}
                onClick={(event) => {
                  deleteTriggerRef.current = event.currentTarget;
                  state.requestDelete(project.id);
                }}
                type="button"
              >
                {resolve(deleteDescriptor)}
              </button>
            </span>
          );
        })}
      </nav>
      <form
        aria-label={resolve(formDescriptor)}
        onSubmit={(event) => {
          event.preventDefault();
          const nextOperation =
            lifecycle.editingProjectId === null ? "create" : "rename";
          void run(nextOperation, () =>
            nextOperation === "create"
              ? state.submitCreate()
              : state.submitRename(),
          );
        }}
      >
        <label>
          {resolve(formDescriptor)}
          <input
            aria-describedby={
              lifecycle.fieldError === null
                ? undefined
                : "project-lifecycle-name-error"
            }
            aria-invalid={lifecycle.fieldError === null ? undefined : true}
            aria-label={resolve(formDescriptor)}
            disabled={mutationsDisabled}
            name="project-name"
            onChange={(event) => state.setNameInput(event.currentTarget.value)}
            ref={inputRef}
            value={lifecycle.nameInput}
          />
        </label>
        {lifecycle.fieldError === null ? null : (
          <p id="project-lifecycle-name-error" role="alert">
            {resolve({ intent: "name-required" })}
          </p>
        )}
        <button disabled={mutationsDisabled} type="submit">
          {resolve({
            intent:
              lifecycle.editingProjectId === null
                ? "create-project-action"
                : "save-project-name-action",
          })}
        </button>
        {lifecycle.editingProjectId === null ? null : (
          <button
            aria-label={resolve({ intent: "cancel-rename" })}
            disabled={mutationsDisabled}
            onClick={() => {
              state.cancelRename();
              queueMicrotask(() => renameTriggerRef.current?.focus());
            }}
            type="button"
          >
            {resolve({ intent: "cancel-rename" })}
          </button>
        )}
      </form>
      <p aria-live="polite" role="status">
        {lifecycle.pending && operation !== undefined
          ? resolve({ intent: "operation-pending", operation })
          : lifecycle.error !== null && lifecycle.error.kind !== "validation"
            ? resolve({
                intent: "operation-failed",
                reason: lifecycle.error.kind,
              })
            : ""}
      </p>
      {lifecycle.error?.kind === "committed-refresh-failed" ? (
        <button
          disabled={lifecycle.pending}
          onClick={() => void run("refresh", () => state.retryRefresh())}
          type="button"
        >
          {resolve({ intent: "retry-refresh" })}
        </button>
      ) : null}
      {lifecycle.deletion === null ? null : (
        <DeleteConfirmation
          descriptor={{
            intent: "confirm-delete",
            projectName: lifecycle.deletion.projectName,
            impact: "owned-candidates",
          }}
          disabled={lifecycle.pending}
          onCancel={() => {
            state.cancelDelete();
            queueMicrotask(() => deleteTriggerRef.current?.focus());
          }}
          onConfirm={() => void run("delete", () => state.confirmDelete())}
          resolve={resolve}
          cancelRef={cancelDeleteRef}
        />
      )}
    </section>
  );
}

function DeleteConfirmation({
  descriptor,
  disabled,
  onCancel,
  onConfirm,
  resolve,
  cancelRef,
}: {
  readonly descriptor: Extract<
    ProjectLifecycleMessageDescriptor,
    { readonly intent: "confirm-delete" }
  >;
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly resolve: (descriptor: ProjectLifecycleMessageDescriptor) => string;
  readonly cancelRef: RefObject<HTMLButtonElement | null>;
}) {
  const message = resolve(descriptor);
  const confirmAction = resolve({ intent: "confirm-delete-action" });
  const cancelAction = resolve({ intent: "cancel-delete" });
  return (
    <div
      aria-label={message}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      role="dialog"
    >
      <p>{message}</p>
      <button
        aria-label={confirmAction}
        disabled={disabled}
        onClick={onConfirm}
        type="button"
      >
        {confirmAction}
      </button>
      <button
        aria-label={cancelAction}
        disabled={disabled}
        onClick={onCancel}
        ref={cancelRef}
        type="button"
      >
        {cancelAction}
      </button>
    </div>
  );
}

export const createProjectLifecyclePresentationContribution = (
  dependencies: ProjectLifecyclePresentationDependencies,
): ProjectLifecyclePresentationContribution => {
  let active:
    | { readonly container: HTMLElement; readonly root: Root }
    | undefined;

  const release = (current: {
    readonly container: HTMLElement;
    readonly root: Root;
  }) => {
    if (active !== current) return;
    active = undefined;
    current.root.unmount();
    current.container.replaceChildren();
  };

  return Object.freeze({
    mount: (container: HTMLElement) => {
      if (active !== undefined)
        return err({ kind: "presentation-failed" } as const);
      try {
        const root = createRoot(container);
        const current = { container, root };
        active = current;
        flushSync(() =>
          root.render(<ProjectLifecycleView {...dependencies} />),
        );
        return ok(Object.freeze({ unmount: () => release(current) }));
      } catch {
        active?.root.unmount();
        active?.container.replaceChildren();
        active = undefined;
        return err({ kind: "presentation-failed" } as const);
      }
    },
  });
};
