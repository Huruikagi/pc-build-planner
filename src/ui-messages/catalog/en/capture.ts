/** Product capture screen text. Category display names reuse the shared `category` namespace. */
export const capture = {
  fields: {
    name: "Product name",
    category: "Category",
    price: "Price",
    manufacturer: "Manufacturer",
    modelNumber: "Model number",
    url: "URL",
  },
  sources: {
    "json-ld": "Structured data",
    meta: "Meta information",
    heading: "Heading",
    breadcrumb: "Breadcrumb",
    table: "Table",
    "definition-list": "Definition list",
    "domain-map": "Official manufacturer domain",
  },
  sourceAttribution: "Source: {source} ({sourceLabel})",
  originalValueLabel: "Original: {value}",
  missingFieldStatus: "Not entered",
  categoryHintUnknown: "Couldn't be estimated (choose it in detailed editing)",
  categoryHintEstimated:
    "Estimated: {label} (used as the initial choice in detailed editing)",
  rejectedFieldsLabel: "Fields that couldn't be captured",
  saveDestinationLabel: "Save to project",
  selectPrompt: "Select",
  noProjectsNotice: "There are no projects to save to. Create a project first.",
  detailEditAction: "Edit details",
  retryCaptureAction: "Capture again",
  reviewTitle: "Review Capture",
  idleTitle: "Capture",
  idleInstruction: "Start a capture from the extension icon.",
  startAction: "Start capture",
  extractingTitle: "Capturing",
  extractingStatus: "Capturing the page…",
  submittingTitle: "Saving",
  submittingStatus: "Saving…",
  savedTitle: "Saved",
  savedWithoutProject: "Candidate saved.",
  savedWithProject: "Candidate saved (to {projectName}).",
  captureAnotherAction: "Capture another page",
  failedTitle: "Capture Failed",
  retryAction: "Retry",
  manualEntryTitle: "Manual Entry",
  manualEntryInstruction:
    "Enter a product name to continue to detailed editing.",
  errors: {
    "permission-lost":
      "Permission to access the page has expired. Reload the page and try again.",
    "restricted-page":
      "This page can't be read by the extension, so it can't be captured.",
    "tab-changed":
      "The page navigated or reloaded during capture. Try again on the page you want to capture.",
    "injection-failed": "Couldn't read the page. Try again.",
    "invalid-payload":
      "Couldn't interpret the content retrieved from the page. Try again.",
    "no-candidate":
      "Couldn't automatically detect product information on this page.",
    "project-required":
      "Select a project to save to. If you don't have one, create it first.",
    navigation: "Couldn't open the detailed editing screen.",
    storage: "Storage is unavailable. Try again.",
    unsupportedData: "Saved data is corrupted or in an unsupported format.",
  },
} as const;
