import { err } from "../domain/public.js";
import type { TransientSurfaceLifecyclePort } from "./transient-surface-ports.js";

export interface LateBoundLifecycle {
  readonly port: TransientSurfaceLifecyclePort;
  bind(target: TransientSurfaceLifecyclePort): void;
  unbind(): void;
}

export function createLateBoundLifecycle(): LateBoundLifecycle {
  let target: TransientSurfaceLifecyclePort | undefined;
  let generation = 0;
  const pending = new Set<(ready: boolean) => void>();
  const releasePending = (): void => {
    for (const resolve of [...pending]) resolve(false);
    pending.clear();
  };
  return {
    port: {
      isCurrent: (activationId) => target?.isCurrent(activationId) ?? false,
      waitUntilCurrent(activationId) {
        const bound = target;
        if (bound === undefined) return Promise.resolve(false);
        const requestedGeneration = generation;
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const finish = (ready: boolean): void => {
            if (settled) return;
            settled = true;
            pending.delete(finish);
            resolve(
              ready && generation === requestedGeneration && target === bound,
            );
          };
          pending.add(finish);
          void bound
            .waitUntilCurrent(activationId)
            .then(finish, () => finish(false));
        });
      },
      dismiss: (activationId, reason) =>
        target?.dismiss(activationId, reason) ??
        Promise.resolve(err({ kind: "not-started" })),
      conclude: (activationId, handoff) =>
        target?.conclude(activationId, handoff) ??
        Promise.resolve(err({ kind: "not-started" })),
    },
    bind(next) {
      releasePending();
      generation += 1;
      target = next;
    },
    unbind() {
      releasePending();
      generation += 1;
      target = undefined;
    },
  };
}
