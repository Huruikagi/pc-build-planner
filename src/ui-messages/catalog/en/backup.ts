/** Backup and restore screen text. */
export const backup = {
  title: "Backup & Restore",
  noticeUninstall:
    "Removing the extension may permanently delete your locally saved data.",
  noticeFileOwnership: "You're responsible for keeping any files you create.",
  noticeNoAutoBackup:
    "Backups aren't created automatically, stored in the cloud, or synced.",
  exportHeading: "Create Backup",
  exportAction: "Create backup",
  exporting: "Creating backup…",
  downloaded: "Downloaded {filename}.",
  restoreHeading: "Restore",
  validating: "Checking the file…",
  restoreConfirmationTitle: "Confirm Restore",
  restoreWarning:
    "All current data will be replaced with the contents of the selected file.",
  createdAtLabel: "Created at",
  formatVersionLabel: "Format version",
  projectCountLabel: "Projects",
  partCountLabel: "Parts",
  currentBuildCountLabel: "Current builds",
  confirmAction: "Confirm restore",
  draftConfirmationTitle: "Unsaved Changes",
  draftWarning:
    "The current project has unsaved changes that the restore will discard.",
  approveDraftAction: "Discard and restore",
  retryRestoreAction: "Retry restore",
  reassessRestoreAction: "Re-check the selected file",
  finalizationRequired:
    "The restore finished, but cleanup is incomplete. Run cleanup to finish.",
  finalizeAction: "Run cleanup",
  contextUnavailable:
    "The restore finished, but the current project couldn't be re-checked.",
  refreshContextAction: "Re-check the current project",
  restoring: "Restoring…",
  restoreCompleted: {
    selectors: ["projectCount", "partCount", "currentBuildCount"],
    forms: {
      "one|zero|zero":
        "Restore complete (project: {projectCount}, parts: {partCount}, current builds: {currentBuildCount}).",
      "one|zero|one":
        "Restore complete (project: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      "one|zero|other":
        "Restore complete (project: {projectCount}, parts: {partCount}, current builds: {currentBuildCount}).",
      "one|one|zero":
        "Restore complete (project: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "one|one|one":
        "Restore complete (project: {projectCount}, part: {partCount}, current build: {currentBuildCount}).",
      "one|one|other":
        "Restore complete (project: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "one|other|zero":
        "Restore complete (project: {projectCount}, parts: {partCount}, current builds: {currentBuildCount}).",
      "one|other|one":
        "Restore complete (project: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      "one|other|other":
        "Restore complete (project: {projectCount}, parts: {partCount}, current builds: {currentBuildCount}).",
      "zero|zero|one":
        "Restore complete (projects: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      "zero|one|zero":
        "Restore complete (projects: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "zero|one|one":
        "Restore complete (projects: {projectCount}, part: {partCount}, current build: {currentBuildCount}).",
      "zero|one|other":
        "Restore complete (projects: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "zero|other|one":
        "Restore complete (projects: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      "other|zero|one":
        "Restore complete (projects: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      "other|one|zero":
        "Restore complete (projects: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "other|one|one":
        "Restore complete (projects: {projectCount}, part: {partCount}, current build: {currentBuildCount}).",
      "other|one|other":
        "Restore complete (projects: {projectCount}, part: {partCount}, current builds: {currentBuildCount}).",
      "other|other|one":
        "Restore complete (projects: {projectCount}, parts: {partCount}, current build: {currentBuildCount}).",
      other:
        "Restore complete (projects: {projectCount}, parts: {partCount}, current builds: {currentBuildCount}).",
    },
  },
  withPosition: "{message} (at {path})",
  errors: {
    "no-file-selected": "No file is selected.",
    "multiple-files-selected": "Select only one file.",
    unreadable: "Couldn't read the file.",
    "size-exceeded": "The file exceeds the size limit.",
    "not-json": "This file can't be read as JSON.",
    "invalid-structure": "The file's format is invalid.",
    "invalid-reference": "The file contains invalid references.",
    "unsupported-version": "This format version isn't supported.",
    "quota-exceeded": "Storage is full.",
    "storage-unavailable": "Storage is unavailable.",
    "corrupt-current-data":
      "Saved data is corrupted. Existing data hasn't changed.",
    "unsupported-current-data":
      "Saved data is in an unsupported format. Existing data hasn't changed.",
    "stale-ticket": "This confirmation is out of date. Choose the file again.",
    "maintenance-active":
      "Another maintenance operation is in progress. Try again shortly.",
    storage: "Storage is unavailable.",
    serialization: "Couldn't convert the data.",
    "guard-failed":
      "Save or discard the unsaved changes, then try the restore again.",
    "context-unavailable":
      "The current project is unavailable. Existing data hasn't changed.",
  },
} as const;
