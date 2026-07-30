import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { build } from "esbuild";

import { validateWorkerModuleGraph } from "../../scripts/validate-worker-module-graph.mjs";

async function buildWorkerFixture(
  importPath: string,
  extraFiles: Readonly<Record<string, string>> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "worker-graph-"));
  const source = join(root, "src");
  const feature = join(source, "features", "fixture");
  await mkdir(feature, { recursive: true });
  await writeFile(
    join(source, "service-worker.ts"),
    `import { marker } from ${JSON.stringify(importPath)}; export { marker };`,
  );
  await writeFile(
    join(feature, "worker-registration.ts"),
    "export const marker = 'worker';",
  );
  await writeFile(join(feature, "view.tsx"), "export const marker = 'ui';");
  for (const [name, sourceText] of Object.entries(extraFiles))
    await writeFile(join(feature, name), sourceText);
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: { "service-worker": "src/service-worker.ts" },
    format: "esm",
    metafile: true,
    outdir: "dist",
    write: false,
  });
  return { root, metafile: result.metafile };
}

test("worker-safe registrationだけのmodule graphを受理する", async () => {
  const fixture = await buildWorkerFixture(
    "./features/fixture/worker-registration.js",
  );
  await assert.doesNotReject(
    validateWorkerModuleGraph(
      fixture.metafile,
      "dist/service-worker.js",
      fixture.root,
    ),
  );
});

test("tree-shake可否に依存せずfeature UI moduleの混入を拒否する", async () => {
  const fixture = await buildWorkerFixture("./features/fixture/view.js");
  await assert.rejects(
    validateWorkerModuleGraph(
      fixture.metafile,
      "dist/service-worker.js",
      fixture.root,
    ),
    /service-worker module graph crosses the side-panel\/UI boundary[\s\S]*view\.tsx/,
  );
});

test("非定型名のfeature UI moduleも拒否する", async () => {
  const fixture = await buildWorkerFixture(
    "./features/fixture/panel-component.js",
    { "panel-component.tsx": "export const marker = 'ui';" },
  );
  await assert.rejects(
    validateWorkerModuleGraph(
      fixture.metafile,
      "dist/service-worker.js",
      fixture.root,
    ),
    /panel-component\.tsx/,
  );
});

test("別名のDOM-bearing moduleをtree-shake前のgraphで拒否する", async () => {
  const fixture = await buildWorkerFixture(
    "./features/fixture/panel-adapter.js",
    {
      "panel-adapter.ts":
        "export const marker = typeof document === 'undefined' ? 'worker' : 'ui';",
    },
  );
  await assert.rejects(
    validateWorkerModuleGraph(
      fixture.metafile,
      "dist/service-worker.js",
      fixture.root,
    ),
    /panel-adapter\.ts/,
  );
});

test("HTMLElement runtime constructorへの到達をgraphで拒否する", async () => {
  const fixture = await buildWorkerFixture(
    "./features/fixture/element-adapter.js",
    {
      "element-adapter.ts":
        "const constructor = globalThis.HTMLElement; export const marker = constructor ? 'ui' : 'worker';",
    },
  );
  await assert.rejects(
    validateWorkerModuleGraph(
      fixture.metafile,
      "dist/service-worker.js",
      fixture.root,
    ),
    /element-adapter\.ts/,
  );
});
