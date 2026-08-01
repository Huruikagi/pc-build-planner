import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  WorkerFeatureContribution,
  WorkerMenuGestureFactory,
} from "../../src/application-shell/feature-contribution-catalog.js";
import { composeWorkerGestureRegistrations } from "../../src/application-shell/production-worker-composition.js";
import type {
  FeatureId,
  TransientGestureRegistrationPort,
  TransientGestureSource,
  TransientMenuGestureDependencies,
} from "../../src/application-shell/public.js";
import { err, ok } from "../../src/domain/public.js";

const menuDependencies: TransientMenuGestureDependencies = {
  contextMenus: {
    create: () => undefined,
    remove: () => undefined,
    onClicked: { addListener: () => {}, removeListener: () => {} },
  },
  title: "menu.fixture.title",
};

/** Records every registration and cleanup the composition drives. */
const createRecordingPort = (
  overrides: { readonly rejectId?: string } = {},
) => {
  const registered: string[] = [];
  const cleaned: string[] = [];
  const sources = new Map<string, TransientGestureSource>();
  const port: TransientGestureRegistrationPort = {
    register(source) {
      if (source.id === overrides.rejectId)
        return err({ kind: "duplicate-source" });
      registered.push(source.id);
      sources.set(source.id, source);
      let active = true;
      return ok(() => {
        if (!active) return;
        active = false;
        cleaned.push(source.id);
      });
    },
  };
  return { port, registered, cleaned, sources };
};

const gestureSource = (id: string): TransientGestureSource => ({
  id,
  surfaceId: id as FeatureId,
  start() {
    return ok(() => {});
  },
});

const factoryFor =
  (id: string): WorkerMenuGestureFactory =>
  (dependencies) => {
    assert.equal(dependencies.title, menuDependencies.title);
    return gestureSource(id);
  };

const catalogOf = (
  ...factories: readonly WorkerMenuGestureFactory[]
): readonly WorkerFeatureContribution[] =>
  factories.map((createMenuGestureSource) => ({ createMenuGestureSource }));

test("catalogのmenu factoryだけをgesture portへ一度ずつ登録する", () => {
  const recording = createRecordingPort();
  const catalog: readonly WorkerFeatureContribution[] = [
    { transientSurfaceId: "product-capture" as FeatureId },
    ...catalogOf(factoryFor("menu-a"), factoryFor("menu-b")),
  ];

  const cleanup = composeWorkerGestureRegistrations({
    catalog,
    gestureRegistration: recording.port,
    menu: menuDependencies,
  });

  assert.deepEqual(recording.registered, ["menu-a", "menu-b"]);
  cleanup();
  assert.deepEqual(recording.cleaned, ["menu-b", "menu-a"], "逆順で解除する");
  cleanup();
  assert.deepEqual(
    recording.cleaned,
    ["menu-b", "menu-a"],
    "cleanupは冪等である",
  );
});

test("menu依存が無いときは一切登録しない", () => {
  const recording = createRecordingPort();

  const cleanup = composeWorkerGestureRegistrations({
    catalog: catalogOf(factoryFor("menu-a")),
    gestureRegistration: recording.port,
  });

  assert.deepEqual(recording.registered, []);
  cleanup();
});

test("登録失敗は診断codeへ落とし他のsourceを止めない", () => {
  const recording = createRecordingPort({ rejectId: "menu-a" });
  const diagnostics: string[] = [];

  const cleanup = composeWorkerGestureRegistrations({
    catalog: catalogOf(factoryFor("menu-a"), factoryFor("menu-b")),
    gestureRegistration: recording.port,
    menu: menuDependencies,
    reportDiagnostic: (code) => diagnostics.push(code),
  });

  assert.deepEqual(recording.registered, ["menu-b"]);
  assert.deepEqual(diagnostics, ["duplicate-source"]);
  cleanup();
  assert.deepEqual(recording.cleaned, ["menu-b"]);
});

test("factoryが投げてもcompositionは診断codeへ落として続行する", () => {
  const recording = createRecordingPort();
  const diagnostics: string[] = [];

  const cleanup = composeWorkerGestureRegistrations({
    catalog: catalogOf(() => {
      throw new Error("factory rejected");
    }, factoryFor("menu-b")),
    gestureRegistration: recording.port,
    menu: menuDependencies,
    reportDiagnostic: (code) => diagnostics.push(code),
  });

  assert.deepEqual(recording.registered, ["menu-b"]);
  assert.deepEqual(diagnostics, ["source-start-failed"]);
  cleanup();
});

const shellRoot = new URL("../../src/application-shell/", import.meta.url);

/**
 * Runtime import edges only. `import type` / `export type` statements are
 * erased before the module reaches the worker bundle, so following them would
 * assert about a graph that never exists at runtime.
 */
const moduleSpecifiers = (source: string): readonly string[] => {
  const runtime = source.replaceAll(
    /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*from\s*["'][^"']+["']\s*;?/g,
    "",
  );
  return [
    ...[...runtime.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
    ...[...runtime.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
    ...[...runtime.matchAll(/\bimport\s+["']([^"']+)["']/g)].map(
      (match) => match[1] ?? "",
    ),
  ];
};

/** Resolves a repository-relative source specifier back onto its TS source. */
const resolveModule = async (
  base: URL,
  specifier: string,
): Promise<URL | undefined> => {
  const target = new URL(specifier.replace(/\.js$/, ""), base);
  for (const extension of [".ts", ".tsx"]) {
    const candidate = new URL(`${target.pathname}${extension}`, target);
    const found = await readFile(fileURLToPath(candidate), "utf8").then(
      () => candidate,
      () => undefined,
    );
    if (found !== undefined) return found;
  }
  return undefined;
};

const walk = async (entries: readonly URL[]) => {
  const visited = new Set<string>();
  const externals = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;
    if (visited.has(current.href)) continue;
    visited.add(current.href);
    const source = await readFile(fileURLToPath(current), "utf8");
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        externals.add(specifier);
        continue;
      }
      const resolved = await resolveModule(current, specifier);
      assert.ok(resolved, `${specifier}: 解決できるmoduleである`);
      queue.push(resolved);
    }
  }
  return { visited, externals };
};

test("production worker entryとworker-safe catalogはUI・DOM・Reactへ到達しない", async () => {
  const { visited, externals } = await walk([
    new URL("../runtime/service-worker.ts", shellRoot),
    new URL("production-worker-composition.ts", shellRoot),
    new URL("feature-contribution-catalog.ts", shellRoot),
  ]);

  assert.ok(visited.size > 2, "import graphを実際に辿っている");
  for (const specifier of externals)
    assert.doesNotMatch(
      specifier,
      /^react(?:-dom)?(?:\/|$)/,
      `${specifier}: worker compositionはReactへ到達しない`,
    );
  assert.equal(
    visited.has(new URL("side-panel-contributions.ts", shellRoot).href),
    false,
    "side-panel-contributions.tsへ到達しない",
  );
  for (const module of [...visited]) {
    assert.doesNotMatch(module, /\.tsx$/, `${module}: TSX moduleへ到達しない`);
    assert.doesNotMatch(
      module,
      /\/features\/[^/]+\/feature-contribution\.ts$/,
      `${module}: feature UI contributionへ到達しない`,
    );
  }
});
