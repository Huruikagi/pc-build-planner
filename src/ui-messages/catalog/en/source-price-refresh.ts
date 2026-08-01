/** Transient price refresh surface text. Mirrors the Japanese catalog key for key. */
export const sourcePriceRefresh = {
  title: "Price refresh",
  menuLabel: "Refresh price",
  runningStatus: "Refreshing the price…",
  succeededStatus: "The price was refreshed.",
  failedStatus: "The price couldn't be refreshed.",
  priceLabel: "Updated price",
  priceValue: "{amount} {currency}",
  capturedAtLabel: "Captured at",
  primaryLabel: "Summary price",
  primaryUpdated:
    "This source is the primary one, so the summary price follows it.",
  primaryUnchanged:
    "This source isn't the primary one, so the summary price is unchanged.",
  preservedNotice: "The stored price and capture time were left untouched.",
  errors: {
    "invalid-url": "The page URL couldn't be read as a comparable address.",
    "no-match": "No stored source matches this page.",
    "ambiguous-match":
      "Several stored sources match this page, so the update target couldn't be narrowed down to one.",
    "ineligible-source": "The matching source isn't marked as a retail page.",
    "price-unavailable": "No valid price could be read from this page.",
    "stale-activation": "A newer gesture started, so this refresh was dropped.",
    "stale-target":
      "The target source changed before the update was committed.",
    "tab-unavailable": "The target page couldn't be reached.",
    "permission-lost": "Permission to access the page has expired.",
    "restricted-page":
      "This page can't be read by the extension, so its price can't be refreshed.",
    "tab-changed": "The page navigated or reloaded during the refresh.",
    "injection-failed": "Reading the page failed.",
    "invalid-payload":
      "The content read from the page couldn't be interpreted.",
    validation: "The stored source no longer satisfies the storage rules.",
    "unsupported-data":
      "The stored data format couldn't be interpreted, so the update wasn't committed.",
    conflict: "Another change conflicted, so the update wasn't committed.",
    maintenance:
      "Storage is under maintenance, so the update wasn't committed.",
    storage: "A storage failure stopped the update from being committed.",
    quota: "Storage is full, so the update wasn't committed.",
    unexpected:
      "An internal problem inside the extension stopped the refresh from finishing.",
  },
  guidance: {
    reviewStoredSources: "Review the list of stored sources.",
    deduplicateSources: "Tidy up the duplicated stored sources.",
    repairStoredSource: "Fix the stored source on the target candidate.",
    retryOnRetailSource: "Run it again on a page stored as a retail source.",
    retryOnEligiblePage:
      "Open a page eligible for a price refresh and run it again.",
    checkPageThenRetry: "Check the price shown on the page, then run it again.",
    retryFromContextMenu:
      "Open the target page again and run it from the context menu.",
    reloadCandidateThenRetry: "Reload the latest candidate, then run it again.",
    retryAfterMaintenance: "Run it again once maintenance has finished.",
    checkStorageThenRetry: "Check the free storage space, then run it again.",
    reportExtensionDefect:
      "Repeating the same action won't help. Check for an extension update, and report the problem if it continues.",
  },
} as const;
