/** State, action, and stable failure messages for the shared project selector. */
export const projectContext = {
  selector: {
    label: "Current project",
    empty: "No projects are available.",
    unavailable: "Project information is unavailable.",
    retry: "Retry",
    pending: "Updating project information.",
    confirmationTitle: "Switch projects?",
    confirm: "Switch project",
    cancel: "Cancel",
    errors: {
      contextUnavailable: "Project information is unavailable. Please retry.",
      projectNotFound: "The selected project is unavailable. Please retry.",
      guardFailed: "The project could not be switched. Please retry.",
      confirmationStale:
        "This confirmation has expired. Select the project again.",
      preferenceWriteFailed:
        "The project selection could not be saved. Please retry.",
    },
  },
} as const;
