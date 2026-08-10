import type {
  ProjectContextCommandPort,
  ProjectContextReplacementGuardPort,
} from "../../src/project-context/public.js";

/**
 * project-context を合成しない composition test 用の置換 guard。
 * 保護すべき draft 所有者が居ないため prepare は permit を発行する。
 */
export const detachedProjectReplacementGuard =
  (): ProjectContextReplacementGuardPort => {
    let serial = 0;
    return {
      async prepare() {
        serial += 1;
        return {
          ok: true,
          value: {
            kind: "permitted",
            permit: {
              id: `detached-${serial}`,
              baseGeneration: 0,
              registryRevision: 0,
            },
          },
        };
      },
      async confirm() {
        return { ok: false, error: { kind: "confirmation-stale" } };
      },
      cancel() {
        return { ok: false, error: { kind: "confirmation-stale" } };
      },
      begin() {
        return { ok: true, value: undefined };
      },
      async complete() {
        return { ok: true, value: undefined };
      },
    };
  };

/** 再検証対象の context が無いことを報告するだけの refresh capability。 */
export const detachedProjectRefresh = (): Pick<
  ProjectContextCommandPort,
  "refresh"
> => ({
  async refresh() {
    return { ok: false, error: { kind: "context-unavailable" } };
  },
});

/** side panel composition が backup/restore へ渡す二つの capability。 */
export const detachedProjectContextDependencies = (): {
  readonly projectReplacementGuard: ProjectContextReplacementGuardPort;
  readonly projectRefresh: Pick<ProjectContextCommandPort, "refresh">;
} => ({
  projectReplacementGuard: detachedProjectReplacementGuard(),
  projectRefresh: detachedProjectRefresh(),
});
