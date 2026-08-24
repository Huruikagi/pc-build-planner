/** Shared persistence-failure text. Mirrors catalog/ja/persistence-error.ts's key set exactly. */
export const persistenceError = {
  validation: "Check your input and try again.",
  maintenance: "Maintenance is in progress. Please try again once it finishes.",
  quota: "Storage is full. Delete some parts and try again.",
  conflict:
    "This conflicts with another change. Reload the latest content and try again.",
  snapshotRestoreFailed: "Couldn't restore your last screen state.",
} as const;
