/**
 * Backup and restore screen text. The restore-completed notice uses a
 * label-and-count layout rather than plural forms, since it carries three
 * independent counts in one sentence (D-5 in research.md); the upstream
 * `MultiPluralDefinition` contract remains available if this ever needs a
 * fully-conjugated sentence instead.
 */
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
  partCountLabel: "Candidates",
  currentBuildCountLabel: "Current builds",
  confirmAction: "Confirm restore",
  restoring: "Restoring…",
  restoreCompleted:
    "Restore complete (projects: {projectCount}, candidates: {partCount}, current builds: {currentBuildCount}).",
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
  },
} as const;
