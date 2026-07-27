import assert from "node:assert/strict";
import test from "node:test";
import {
  type ChromeActionSignalApi,
  createChromeActivationFailureSignal,
} from "../../src/runtime/activation-failure-signal.js";

const createFixture = (defaultTitle?: string) => {
  const calls: string[] = [];
  let failBadge = false;
  let failTitle = false;
  const api = {
    action: {
      async setBadgeText({ text }) {
        calls.push(`badge:${text}`);
        if (failBadge) throw new Error("badge failed");
      },
      async setTitle({ title }) {
        calls.push(`title:${title}`);
        if (failTitle) throw new Error("title failed");
      },
    },
    runtime: {
      getManifest: () => ({
        name: "PC Build Planner",
        ...(defaultTitle === undefined
          ? { action: {} }
          : { action: { default_title: defaultTitle } }),
      }),
    },
  } satisfies ChromeActionSignalApi;
  const signal = createChromeActivationFailureSignal(api);
  return {
    signal,
    calls,
    failBadge: (value: boolean) => {
      failBadge = value;
    },
    failTitle: (value: boolean) => {
      failTitle = value;
    },
    recreate: () => createChromeActivationFailureSignal(api),
  };
};

test("publishはglobal badgeと安定した再操作titleを設定する", async () => {
  const { signal, calls } = createFixture();
  assert.deepEqual(await signal.publish(), { ok: true, value: undefined });
  assert.deepEqual(calls, [
    "badge:!",
    "title:起動情報を保存できません。拡張アイコンを再操作してください",
  ]);
});

test("durable put成功通知だけがsignalをclearしてmanifest titleを復元する", async () => {
  const { signal, calls } = createFixture("通常タイトル");
  await signal.publish();
  signal.onReadSucceeded();
  signal.onPanelOpened();
  assert.equal(calls.length, 2);
  assert.deepEqual(await signal.onDurablePutSucceeded(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(calls.slice(2), ["badge:", "title:通常タイトル"]);
  await signal.onDurablePutSucceeded();
  assert.equal(calls.length, 6);
});

test("worker再生成ではclearせず次のdurable put成功で既存signalをclearする", async () => {
  const fixture = createFixture();
  await fixture.signal.publish();
  const recreated = fixture.recreate();
  recreated.onReadSucceeded();
  recreated.onPanelOpened();
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(await recreated.onDurablePutSucceeded(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(fixture.calls.slice(2), [
    "badge:",
    "title:PC Build Planner",
  ]);
});

test("clear失敗は起動成功をrollbackせず次のput成功時に再試行する", async () => {
  const fixture = createFixture();
  await fixture.signal.publish();
  fixture.failTitle(true);
  assert.deepEqual(await fixture.signal.onDurablePutSucceeded(), {
    ok: false,
    error: { kind: "clear-failed" },
  });
  fixture.failTitle(false);
  assert.deepEqual(await fixture.signal.onDurablePutSucceeded(), {
    ok: true,
    value: undefined,
  });
  assert.deepEqual(fixture.calls.slice(-2), [
    "badge:",
    "title:PC Build Planner",
  ]);
});

test("publish失敗を安定codeで返しsignalをclear待ちに保つ", async () => {
  const fixture = createFixture();
  fixture.failBadge(true);
  assert.deepEqual(await fixture.signal.publish(), {
    ok: false,
    error: { kind: "publish-failed" },
  });
  fixture.failBadge(false);
  assert.deepEqual(await fixture.signal.onDurablePutSucceeded(), {
    ok: true,
    value: undefined,
  });
});
