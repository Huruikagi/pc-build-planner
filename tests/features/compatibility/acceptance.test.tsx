import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import type {
  AppDataError,
  CandidatePart,
  CandidatePartId,
  CurrentBuild,
  NormalizedAttributes,
  PositiveInteger,
  ProjectId,
  Result,
  UtcTimestamp,
  Uuid,
} from "../../../src/domain/public.js";
import type { CandidateQuery } from "../../../src/features/candidate-management/public.js";
import type { CompatibilityQuery } from "../../../src/features/compatibility/contracts.js";
import { createCompatibilityFeatureRegistration } from "../../../src/features/compatibility/registration.js";
import { createCompatibilityService } from "../../../src/features/compatibility/service.js";
import { createCompatibilityState as createProductionCompatibilityState } from "../../../src/features/compatibility/state.js";
import { CompatibilityView } from "../../../src/features/compatibility/view.js";
import type {
  BuildError,
  CurrentBuildQuery,
  CurrentBuildSnapshot,
} from "../../../src/features/current-build/public.js";
import { defaultMessageResolver } from "../../../src/ui-messages/public.js";

const projectId = "10000000-0000-4000-8000-000000000091" as Uuid as ProjectId;
const buildId =
  "40000000-0000-4000-8000-000000000091" as Uuid as CurrentBuild["id"];
const timestamp = "2026-07-22T00:00:00.000Z" as UtcTimestamp;

const stateForCurrentProject = (query: CompatibilityQuery) =>
  createProductionCompatibilityState({
    query,
    projectContext: {
      getCurrent: () => ({ status: "ready", generation: 1, projectId }),
      subscribe: () => () => {},
    },
  });

const createCompatibilityState = (dependencies: {
  readonly query: CompatibilityQuery;
}) => stateForCurrentProject(dependencies.query);

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const evaluateCurrentProject = async (
  state: ReturnType<typeof stateForCurrentProject>,
): Promise<void> => {
  state.start();
  await flush();
};

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("30000000-0000-4000-8000-000000000091");
const motherboardId = partId("30000000-0000-4000-8000-000000000092");
const unlistedId = partId("30000000-0000-4000-8000-000000000099");

/** Fictitious, deliberately identifiable markers — never real data, per steering fixture rules. */
const SECRET_NAME = "架空機密パーツ名-TOP-SECRET-8f3d21";
const SECRET_URL = "https://forbidden.example/secret-path-9f2e";
const SECRET_ATTRIBUTE = "SECRET-SOCKET-VALUE-1a2b3c";

const sensitiveCpu: CandidatePart = {
  id: cpuId,
  projectId,
  category: "cpu",
  product: {
    name: { original: SECRET_NAME, confirmed: SECRET_NAME },
  },
  sources: [
    {
      id: "50000000-0000-4000-8000-000000000001" as never,
      pageUrl: SECRET_URL,
      siteName: "架空サイト",
    },
  ],
  primarySourceId: "50000000-0000-4000-8000-000000000001" as never,
  normalizedAttributes: {
    category: "cpu",
    socket: { original: SECRET_ATTRIBUTE, confirmed: SECRET_ATTRIBUTE },
  } satisfies NormalizedAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const motherboard: CandidatePart = {
  id: motherboardId,
  projectId,
  category: "motherboard",
  product: {
    name: { original: "架空マザーボード", confirmed: "架空マザーボード" },
  },
  sources: [],
  normalizedAttributes: {
    category: "motherboard",
    socket: { original: "元表記", confirmed: SECRET_ATTRIBUTE },
  } satisfies NormalizedAttributes,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const item = (
  candidatePartId: CandidatePartId,
): CurrentBuild["items"][number] => ({
  candidatePartId,
  quantity: 1 as PositiveInteger,
});

const snapshotWith = (build: CurrentBuild | null): CurrentBuildSnapshot => ({
  revision: 1 as CurrentBuildSnapshot["revision"],
  currentBuild: build,
});

const buildQueryReturning = (
  result: Result<CurrentBuildSnapshot, BuildError>,
): CurrentBuildQuery => ({
  async getByProject() {
    return result;
  },
});

const candidateQueryReturning = (
  result: Result<readonly CandidatePart[], AppDataError>,
): CandidateQuery => ({
  async listProjects(): Promise<never> {
    throw new Error("not used by acceptance tests");
  },
  async listCandidates(): Promise<never> {
    throw new Error("not used by acceptance tests");
  },
  async listBuildEligible() {
    return result;
  },
  async getCandidateDraft(): Promise<never> {
    throw new Error("not used by acceptance tests");
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Captures every console sink so a leak into any of them is detected. */
function spyOnConsole() {
  const calls: unknown[] = [];
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };
  console.log = (...args: unknown[]) => calls.push(args);
  console.error = (...args: unknown[]) => calls.push(args);
  console.warn = (...args: unknown[]) => calls.push(args);
  console.info = (...args: unknown[]) => calls.push(args);
  console.debug = (...args: unknown[]) => calls.push(args);
  return {
    calls,
    restore() {
      console.log = originals.log;
      console.error = originals.error;
      console.warn = originals.warn;
      console.info = originals.info;
      console.debug = originals.debug;
    },
  };
}

afterEach(cleanup);

test("構成なし・不正参照・読取失敗のいずれも誤った互換性statusを表示せず識別可能な状態になる", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [item(cpuId), item(motherboardId)],
    updatedAt: timestamp,
  };

  const noBuildService = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(null),
    }),
    candidateQuery: candidateQueryReturning({ ok: true, value: [] }),
  });
  const noBuildState = createCompatibilityState({ query: noBuildService });
  await evaluateCurrentProject(noBuildState);
  const noBuildView = render(<CompatibilityView state={noBuildState} />);
  assert.ok(
    noBuildView.container.querySelector(
      "[data-status='empty-build'][data-empty-reason='no-build']",
    ),
  );
  assert.equal(
    noBuildView.container.querySelector("[data-aggregate-status]"),
    null,
  );

  const invalidReferenceService = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith({ ...build, items: [item(unlistedId)] }),
    }),
    candidateQuery: candidateQueryReturning({
      ok: true,
      value: [sensitiveCpu, motherboard],
    }),
  });
  const invalidReferenceState = createCompatibilityState({
    query: invalidReferenceService,
  });
  await evaluateCurrentProject(invalidReferenceState);
  const invalidReferenceView = render(
    <CompatibilityView state={invalidReferenceState} />,
  );
  assert.ok(
    invalidReferenceView.container.querySelector(
      "[data-status='failed'][data-failure-reason='invalid-reference']",
    ),
  );
  assert.equal(
    invalidReferenceView.container.querySelector("[data-aggregate-status]"),
    null,
  );

  const readFailedService = createCompatibilityService({
    currentBuildQuery: buildQueryReturning({
      ok: true,
      value: snapshotWith(build),
    }),
    candidateQuery: candidateQueryReturning({
      ok: false,
      error: { code: "storage-unavailable" },
    }),
  });
  const readFailedState = createCompatibilityState({
    query: readFailedService,
  });
  await evaluateCurrentProject(readFailedState);
  const readFailedView = render(<CompatibilityView state={readFailedState} />);
  assert.ok(
    readFailedView.container.querySelector(
      "[data-failure-reason='read-failed']",
    ),
  );
  assert.equal(
    readFailedView.container.querySelector("[data-aggregate-status]"),
    null,
  );
  assert.doesNotMatch(
    readFailedView.container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.compatible")),
  );
  assert.doesNotMatch(
    readFailedView.container.textContent ?? "",
    new RegExp(defaultMessageResolver("compatibility.aggregate.incompatible")),
  );
});

test("遅延した旧評価が後から完了しても画面は最新の評価結果だけを反映する", async () => {
  const build: CurrentBuild = {
    id: buildId,
    projectId,
    items: [item(cpuId), item(motherboardId)],
    updatedAt: timestamp,
  };
  const resolvers: Array<
    (result: Result<CurrentBuildSnapshot, BuildError>) => void
  > = [];
  const slowThenFastQuery: CurrentBuildQuery = {
    async getByProject() {
      const { promise, resolve } =
        deferred<Result<CurrentBuildSnapshot, BuildError>>();
      resolvers.push(resolve);
      return promise;
    },
  };
  const service = createCompatibilityService({
    currentBuildQuery: slowThenFastQuery,
    candidateQuery: candidateQueryReturning({
      ok: true,
      value: [sensitiveCpu, motherboard],
    }),
  });
  const state = createCompatibilityState({ query: service });

  state.start(); // starts first, resolves last
  const fresh = state.retry(); // starts second, resolves first

  // The fresh (second) request resolves first with a real build.
  resolvers[1]?.({ ok: true, value: snapshotWith(build) });
  await fresh;
  const view = render(<CompatibilityView state={state} />);
  assert.ok(view.container.querySelector("[data-status='ready']"));

  // The stale (first) request resolves later with a contradictory no-build
  // result; it must be discarded rather than overwriting the fresh report.
  resolvers[0]?.({ ok: true, value: snapshotWith(null) });
  await flush();

  assert.ok(view.container.querySelector("[data-status='ready']"));
  assert.equal(
    view.container.querySelector("[data-status='empty-build']"),
    null,
  );
});

test("unmount後は購読解除しReact rootを一度だけ除去する", async () => {
  const query: CompatibilityQuery = {
    async evaluate() {
      return {
        ok: true,
        value: {
          projectId,
          buildUpdatedAt: timestamp,
          status: "compatible",
          results: [],
        },
      };
    },
  };
  const state = stateForCurrentProject(query);
  const registration = createCompatibilityFeatureRegistration({
    query,
    state,
  });
  const container = document.createElement("div");

  let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
  await act(async () => {
    handle = await registration.mount({
      container,
      operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
      reportError: () => {},
    });
  });
  assert.notEqual(container.textContent, "");

  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
  // A second unmount must not throw or re-trigger cleanup work.
  await act(async () => handle?.unmount());
  assert.equal(container.textContent, "");
});

test("読取失敗・評価失敗時にパーツ名・URL・属性値をログへ一切出力しない", async () => {
  const spy = spyOnConsole();
  const reportedMessages: string[] = [];
  try {
    const build: CurrentBuild = {
      id: buildId,
      projectId,
      items: [item(cpuId), item(motherboardId)],
      updatedAt: timestamp,
    };

    // read-failed: upstream candidate read fails outright, but the sensitive
    // candidate data already exists in the fixture pool available to the
    // resolver — proves failure handling never touches or logs it.
    const readFailedService = createCompatibilityService({
      currentBuildQuery: buildQueryReturning({
        ok: true,
        value: snapshotWith(build),
      }),
      candidateQuery: candidateQueryReturning({
        ok: false,
        error: { code: "storage-unavailable" },
      }),
    });
    await evaluateCurrentProject(
      createCompatibilityState({ query: readFailedService }),
    );

    // invalid-reference: the sensitive candidate is present in the pool but
    // unreferenced by the current build, so evaluation fails before ever
    // reaching rule evaluation for it.
    const invalidReferenceService = createCompatibilityService({
      currentBuildQuery: buildQueryReturning({
        ok: true,
        value: snapshotWith({ ...build, items: [item(unlistedId)] }),
      }),
      candidateQuery: candidateQueryReturning({
        ok: true,
        value: [sensitiveCpu, motherboard],
      }),
    });
    await evaluateCurrentProject(
      createCompatibilityState({ query: invalidReferenceService }),
    );

    // The sensitive candidate genuinely participates in a real evaluation
    // (compatible or incompatible) — even success paths must not log it.
    const evaluatedService = createCompatibilityService({
      currentBuildQuery: buildQueryReturning({
        ok: true,
        value: snapshotWith(build),
      }),
      candidateQuery: candidateQueryReturning({
        ok: true,
        value: [sensitiveCpu, motherboard],
      }),
    });
    const evaluatedState = createCompatibilityState({
      query: evaluatedService,
    });
    await evaluateCurrentProject(evaluatedState);
    render(<CompatibilityView state={evaluatedState} />);

    // The shell's own error-reporting channel must not receive sensitive
    // content either, even if a future mount path starts wiring it up.
    const registration = createCompatibilityFeatureRegistration({
      query: readFailedService,
      state: stateForCurrentProject(readFailedService),
    });
    const container = document.createElement("div");
    let handle: Awaited<ReturnType<typeof registration.mount>> | undefined;
    await act(async () => {
      handle = await registration.mount({
        container,
        operationPolicy: { isAllowed: () => true, subscribe: () => () => {} },
        reportError: (message: string) => reportedMessages.push(message),
      });
    });
    await act(async () => handle?.unmount());

    const serialized = JSON.stringify(spy.calls);
    assert.doesNotMatch(serialized, /TOP-SECRET/);
    assert.doesNotMatch(serialized, /forbidden\.example/);
    assert.doesNotMatch(serialized, /SECRET-SOCKET-VALUE/);
    assert.equal(
      spy.calls.length,
      0,
      "評価の成功・失敗を問わずconsoleへ出力しない",
    );
    assert.equal(
      reportedMessages.length,
      0,
      "評価失敗時にshellのreportErrorへ通知しない",
    );
  } finally {
    spy.restore();
  }
});
