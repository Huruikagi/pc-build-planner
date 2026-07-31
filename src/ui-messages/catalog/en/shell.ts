/** Application shell status and startup-failure text. */
export const shell = {
  navigationLabel: "Feature navigation",
  loading: "Loading…",
  errorHeading: "Something went wrong",
  maintenanceHeading: "Under maintenance",
  emptyHeading: "No features available",
  emptyBody: "Please wait until a feature becomes available.",
  retry: "Retry",
  featureFailureHeading: "This feature couldn't be displayed",
  featureFailureBody: "Try again, or switch to a different feature.",
  startupFailed: "The application couldn't start",
  missingDependency: "A required dependency is missing",
  maintenanceActive: "Maintenance is in progress. Changes aren't available.",
  maintenanceStartupFailed: "Couldn't retrieve maintenance status",
  transientActivationFailed:
    "The temporary view couldn't start. Click the extension icon again to start it with newly granted access.",
  transientActivationExpired:
    "This view's activation has expired. Don't retry from the stale view; click the extension icon again to start a new one.",
  settingsRecoveryLoading:
    "Loading. You can change the display language in 設定 / Settings. Wait for loading to finish.",
  settingsRecoveryStartupFailed:
    "Startup failed. You can change the display language in 設定 / Settings. Try again.",
  hostStopped: "The side panel host has stopped",
  runtimeHostUnavailable: "Application shell host is unavailable.",
  runtimeStartupFailed: "Application shell failed to start.",
  featureNotRegistered: "Feature {featureId} isn't registered",
  featureUnavailable: "Feature {featureId} is unavailable: {reason}",
  featureRequestInvalidated:
    "The display request for feature {featureId} was invalidated",
  featureMountFailed: "Feature {featureId} failed to start displaying",
  featureUnmountFailed: "Feature {featureId} failed to stop displaying",
  featureUnregistered:
    "Feature {featureId} is unavailable: it was unregistered",
} as const;
