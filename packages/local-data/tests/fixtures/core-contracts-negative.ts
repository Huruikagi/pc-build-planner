import type { LocalDataPolicy, StoragePort } from "../../src/index.js";

type FirstRoot = Readonly<{ firstRevision: number }>;
type OtherRoot = Readonly<{ otherRevision: number }>;

declare const policy: LocalDataPolicy<
  FirstRoot,
  Readonly<{ kind: "change" }>,
  Readonly<{ active: boolean }>,
  Readonly<{ code: "invalid" }>
>;
declare const storage: StoragePort<FirstRoot, Readonly<{ active: boolean }>>;

// @ts-expect-error A consumer cannot substitute a different root shape.
policy.apply({ otherRevision: 1 }, { kind: "change" });
// @ts-expect-error Storage writes preserve the consumer-configured root type.
storage.writeRoot({ otherRevision: 1 } satisfies OtherRoot);
