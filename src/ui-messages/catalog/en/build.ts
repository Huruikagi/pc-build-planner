/** Current build screen text. */
export const build = {
  title: "Current Build",
  projectsNav: "Projects",
  categoryNav: "Category",
  candidateListLabel: "Parts",
  noCandidates: "No parts",
  noCurrentBuild: "No current build",
  select: "Select",
  add: "Add",
  remove: "Remove",
  confirmQuantity: "Confirm quantity",
  invalidQuantity: "Enter a positive whole number",
  notFound: "Couldn't find that part. Reload and try again.",
  corruptData: "Saved data is corrupted. Existing data hasn't changed.",
  unsupportedData:
    "Saved data is in an unsupported format. Existing data hasn't changed.",
  storage: "Storage is unavailable. Reopen the extension and try again.",
  summaryEmpty: "Not selected",
  summaryCategory: "{category}: {summary}",
  summaryQuantity: "{name} × {quantity}",
  summaryAccessibleQuantity: "{name}, quantity {quantity}",
  summarySeparator: ", ",
  projectEmpty:
    "There are no projects. Create one from the shared project screen.",
  projectUnavailable: "Projects are unavailable. Wait a moment, then reload.",
  switchConfirmation:
    "You have unsaved quantities. Choose what to do before switching projects.",
  switchSave: "Save and switch",
  switchDiscard: "Discard and switch",
  switchCancel: "Cancel switch",
  orphanedDraft:
    "Unsaved quantities are isolated after a forced project change. They will not be saved to the new project.",
  orphanedDismiss: "Discard isolated input",
} as const;
