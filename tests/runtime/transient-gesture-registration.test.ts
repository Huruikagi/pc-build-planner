import assert from "node:assert/strict";
import test from "node:test";
import type { FeatureId } from "../../src/application-shell/contracts.js";
import type {
  TargetTabId,
  TransientGestureSource,
} from "../../src/application-shell/transient-surface-ports.js";
import { ok } from "../../src/domain/public.js";
import { createTransientGestureRegistrar } from "../../src/runtime/transient-gesture-registration.js";

const surfaceId = "fixture" as FeatureId;
const source = (
  id: string,
  start: TransientGestureSource["start"],
): TransientGestureSource => ({ id, surfaceId, start });

test("sourceをcanonical ingressへ同期接続しcleanupを一度だけ実行する", () => {
  const emitted: number[] = [];
  let emit: ((tabId: TargetTabId) => void) | undefined;
  let stopped = 0;
  const registrar = createTransientGestureRegistrar({
    ingress: (_surface, tabId) => emitted.push(tabId),
  });
  assert.deepEqual(registrar.register(source("menu", () => ok(() => {}))), {
    ok: false,
    error: { kind: "not-started" },
  });
  registrar.start();
  const registered = registrar.register(
    source("menu", (next) => {
      emit = next;
      return ok(() => {
        stopped += 1;
      });
    }),
  );
  assert.equal(registered.ok, true);
  emit?.(7 as TargetTabId);
  assert.deepEqual(emitted, [7]);
  if (registered.ok) {
    registered.value();
    registered.value();
  }
  emit?.(8 as TargetTabId);
  assert.deepEqual(emitted, [7]);
  assert.equal(stopped, 1);
});

test("invalid/duplicate/start failureを閉じたerrorへ変換しentryを残さない", () => {
  let ingressCalls = 0;
  const registrar = createTransientGestureRegistrar({
    ingress() {
      ingressCalls += 1;
    },
  });
  registrar.start();
  assert.equal(registrar.register(source("", () => ok(() => {}))).ok, false);
  assert.deepEqual(
    registrar.register({
      ...source("blank-surface", () => ok(() => {})),
      surfaceId: "   " as FeatureId,
    }),
    { ok: false, error: { kind: "invalid-source" } },
  );
  assert.equal(ingressCalls, 0);
  const first = registrar.register(source("same", () => ok(() => {})));
  assert.equal(first.ok, true);
  assert.deepEqual(registrar.register(source("same", () => ok(() => {}))), {
    ok: false,
    error: { kind: "duplicate-source" },
  });
  if (first.ok) first.value();
  assert.deepEqual(
    registrar.register(
      source("broken", () => {
        throw new Error("boom");
      }),
    ),
    { ok: false, error: { kind: "source-start-failed" } },
  );
  assert.equal(
    registrar.register(source("broken", () => ok(() => {}))).ok,
    true,
  );
});
