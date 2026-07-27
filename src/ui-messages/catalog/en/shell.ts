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
  transientActivationUnavailable:
    "The temporary view couldn't start. Use the extension icon again. {detail}",
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
