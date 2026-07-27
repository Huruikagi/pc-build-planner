import { err } from "../domain/public.js";
import type { TransientSurfaceLifecyclePort } from "./transient-surface-ports.js";

export interface LateBoundLifecycle {
  readonly port: TransientSurfaceLifecyclePort;
  bind(target: TransientSurfaceLifecyclePort): void;
  unbind(): void;
}

export function createLateBoundLifecycle(): LateBoundLifecycle {
  let target: TransientSurfaceLifecyclePort | undefined;
  return {
    port: {
      isCurrent: (activationId) => target?.isCurrent(activationId) ?? false,
      conclude: (activationId, handoff) =>
        target?.conclude(activationId, handoff) ??
        Promise.resolve(err({ kind: "not-started" })),
    },
    bind(next) {
      target = next;
    },
    unbind() {
      target = undefined;
    },
  };
}
