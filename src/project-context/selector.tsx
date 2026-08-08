import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMessages } from "../ui-messages/public.js";

import type {
  ProjectContextCommandPort,
  ProjectContextReadPort,
} from "./public.js";
import type { ProjectContextCommandError } from "./service.js";

export interface ProjectSelectorProps {
  readonly read: ProjectContextReadPort;
  readonly commands: ProjectContextCommandPort;
}

type Confirmation = { readonly id: string };

const errorMessageKey = (error: ProjectContextCommandError) => {
  switch (error.kind) {
    case "context-unavailable":
      return "projectContext.selector.errors.contextUnavailable" as const;
    case "project-not-found":
      return "projectContext.selector.errors.projectNotFound" as const;
    case "guard-failed":
      return "projectContext.selector.errors.guardFailed" as const;
    case "confirmation-stale":
      return "projectContext.selector.errors.confirmationStale" as const;
    case "preference-write-failed":
      return "projectContext.selector.errors.preferenceWriteFailed" as const;
  }
};

/** Renders and operates the shared project selection surface from capability ports only. */
export function ProjectSelector({ read, commands }: ProjectSelectorProps) {
  const snapshot = useSyncExternalStore(
    read.subscribe,
    read.getSnapshot,
    read.getSnapshot,
  );
  const messages = useMessages();
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [error, setError] = useState<ProjectContextCommandError>();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirmation !== undefined) cancelRef.current?.focus();
  }, [confirmation]);

  const select = async (projectId: string) => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    const result = await commands.select(
      projectId as Parameters<typeof commands.select>[0],
    );
    if (result.ok) {
      if (result.value.kind === "confirmation-required") {
        setConfirmation({ id: result.value.confirmation.id });
      }
    } else {
      setError(result.error);
    }
    setPending(false);
  };

  const retry = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    const result = await commands.refresh();
    if (!result.ok) setError(result.error);
    setPending(false);
  };

  const cancel = () => {
    if (confirmation === undefined || pending) return;
    const result = commands.cancel(confirmation.id);
    if (!result.ok) setError(result.error);
    setConfirmation(undefined);
  };

  const confirm = async () => {
    if (confirmation === undefined || pending) return;
    setPending(true);
    setError(undefined);
    const result = await commands.confirm(confirmation.id);
    if (!result.ok) setError(result.error);
    setConfirmation(undefined);
    setPending(false);
  };

  return (
    <section data-project-context="selector">
      <label>
        {messages("projectContext.selector.label")}
        <select
          aria-label={messages("projectContext.selector.label")}
          data-project-context="select"
          disabled={snapshot.status !== "ready" || pending}
          onChange={(event) => void select(event.currentTarget.value)}
          value={snapshot.selectedProjectId ?? ""}
        >
          {snapshot.status === "ready" ? (
            snapshot.catalog.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))
          ) : (
            <option value="">
              {snapshot.status === "empty"
                ? messages("projectContext.selector.empty")
                : messages("projectContext.selector.unavailable")}
            </option>
          )}
        </select>
      </label>
      {snapshot.status === "unavailable" ? (
        <button
          data-project-context="retry"
          disabled={pending}
          onClick={() => void retry()}
          type="button"
        >
          {messages("projectContext.selector.retry")}
        </button>
      ) : null}
      <p aria-live="polite" role="status">
        {pending
          ? messages("projectContext.selector.pending")
          : error === undefined
            ? snapshot.status === "empty"
              ? messages("projectContext.selector.empty")
              : snapshot.status === "unavailable"
                ? messages("projectContext.selector.unavailable")
                : ""
            : messages(errorMessageKey(error))}
      </p>
      {confirmation === undefined ? null : (
        <div
          aria-modal="true"
          aria-labelledby="project-context-confirmation-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
          }}
          role="dialog"
        >
          <p id="project-context-confirmation-title">
            {messages("projectContext.selector.confirmationTitle")}
          </p>
          <button
            disabled={pending}
            onClick={() => void confirm()}
            type="button"
          >
            {messages("projectContext.selector.confirm")}
          </button>
          <button
            data-project-context="cancel"
            disabled={pending}
            onClick={cancel}
            ref={cancelRef}
            type="button"
          >
            {messages("projectContext.selector.cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
