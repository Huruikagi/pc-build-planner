import assert from "node:assert/strict";
import test from "node:test";

import type { TargetTabId } from "../../src/application-shell/public.js";
import type { RequestId } from "../../src/domain/public.js";
import { createChromeCaptureRuntimePort } from "../../src/features/product-capture/chrome-runtime-port.js";
import { createProductionCaptureChromeFixture } from "../fixtures/product-capture-production.js";

const TAB = 41 as TargetTabId;
const REQUEST = "80000000-0000-4000-8000-000000000041" as RequestId;

test("production Chrome fixtureはactiveTab付与tabだけを取得してscriptを注入する", async () => {
  const fixture = createProductionCaptureChromeFixture({
    grantedTabId: TAB,
    pageUrl: "https://catalog.example.invalid/synthetic-production-part",
  });
  const runtime = createChromeCaptureRuntimePort(fixture.chrome);

  const target = await runtime.getTab(TAB);
  assert.equal(target.ok, true);
  if (!target.ok) return;
  assert.equal((await runtime.inject(target.value, REQUEST)).ok, true);
  assert.deepEqual(fixture.observedTabsGet, [TAB]);
  assert.deepEqual(fixture.observedInjectionTabs, [TAB, TAB]);
});

test("production Chrome fixtureはactiveTab未付与のURL欠落時に注入しない", async () => {
  const fixture = createProductionCaptureChromeFixture({
    grantedTabId: null,
    pageUrl: "https://catalog.example.invalid/synthetic-production-part",
  });
  const runtime = createChromeCaptureRuntimePort(fixture.chrome);

  assert.deepEqual(await runtime.getTab(TAB), {
    ok: false,
    error: { kind: "url-unavailable" },
  });
  assert.deepEqual(fixture.observedTabsGet, [TAB]);
  assert.deepEqual(fixture.observedInjectionTabs, []);
});
