import type { TransientSurfaceLifecyclePort } from "../../src/application-shell/public.js";

export const idleTransientSurface: TransientSurfaceLifecyclePort = {
  isCurrent: () => false,
  waitUntilCurrent: async () => false,
  dismiss: async () => ({
    ok: false,
    error: { kind: "not-started" },
  }),
  conclude: async () => ({
    ok: false,
    error: { kind: "not-started" },
  }),
};
