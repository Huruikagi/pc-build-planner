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
  manualEntryAction: "Continue with manual entry",
  retryCaptureAction: "Capture again",
  idleTitle: "Capture",
  idleInstruction: "Start a capture from the extension icon.",
  startAction: "Start capture",
  extractingTitle: "Capturing",
  extractingStatus: "Capturing the page…",
  failedTitle: "Capture Failed",
  retryAction: "Retry",
  newGenerationHint:
    "A new extension icon gesture replaces any stale failure or retained result with a new capture.",
  handoffRetainedNotice:
    "The capture result is retained for the current activation generation.",
  retryHandoffAction: "Retry handoff",
  manualEntryTitle: "Manual Entry",
  manualEntryInstruction:
    "Enter a product name to continue to detailed editing.",
  errors: {
    "permission-lost":
      "Permission to access the page has expired. Reload the page, then click the extension icon again to grant access again.",
    "restricted-page":
      "This page can't be read by the extension, so it can't be captured.",
    "tab-changed":
      "The page navigated or reloaded during capture. Try again on the page you want to capture.",
    "injection-failed": "Couldn't read the page. Try again.",
    "invalid-payload":
      "Couldn't interpret the content retrieved from the page. Try again.",
    "no-candidate":
      "Couldn't automatically detect product information on this page.",
    navigation: "Couldn't open the detailed editing screen.",
    handoffDiagnostic: "Failure reason: {reason}",
  },
} as const;
