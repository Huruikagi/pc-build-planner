import assert from "node:assert/strict";
import test from "node:test";

import { act, type ReactNode } from "react";
import type { Root as ReactDomRoot } from "react-dom/client";

import type { ShellViewState } from "../../src/application-shell/contracts.js";
import { createReactShellRoot } from "../../src/application-shell/react-shell-root.js";

function lifecycleFixture() {
  let state: ShellViewState = { kind: "loading" };
  let listener: ((next: ShellViewState) => void) | undefined;
  const events: string[] = [];
  const rendered: ShellViewState[] = [];
  const roots: ReactDomRoot[] = [];
  const source = {
    getSnapshot: () => state,
    subscribe: (nextListener: (next: ShellViewState) => void) => {
      events.push("subscribe");
      listener = nextListener;
      let active = true;
      return () => {
        if (active) {
          active = false;
          events.push("unsubscribe");
        }
      };
    },
  };
  const adapter = createReactShellRoot({
    container: document.createElement("div"),
    source,
    render: (next) => {
      rendered.push(next);
      return null;
    },
    createRoot: () => {
      events.push("createRoot");
      const root = {
        render(node: ReactNode) {
          events.push("render");
          void node;
        },
        unmount() {
          events.push("unmount");
        },
      } as ReactDomRoot;
      roots.push(root);
      return root;
    },
  });
  return {
    adapter,
    events,
    rendered,
    roots,
    emit(next: ShellViewState) {
      state = next;
      listener?.(next);
    },
  };
}

test("既定のcreateRootでhost containerへstateを描画する", async () => {
  let listener: ((next: ShellViewState) => void) | undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const adapter = createReactShellRoot({
    container,
    source: {
      getSnapshot: () => ({ kind: "loading" }),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    },
    render: (state) => <p>{state.kind}</p>,
  });

  await act(() => adapter.mount());
  assert.equal(container.textContent, "loading");
  await act(() => listener?.({ kind: "ready", selected: null }));
  assert.equal(container.textContent, "ready");
  await act(() => adapter.stop());
  assert.equal(container.textContent, "");
  assert.equal(listener, undefined);
  container.remove();
});

test("mountして初期stateと更新をReact rootへ描画する", () => {
  const fixture = lifecycleFixture();
  fixture.adapter.mount();
  fixture.emit({ kind: "ready", selected: null });

  assert.deepEqual(fixture.events, [
    "createRoot",
    "render",
    "subscribe",
    "render",
  ]);
  assert.deepEqual(fixture.rendered, [
    { kind: "loading" },
    { kind: "ready", selected: null },
  ]);
});

test("stopはunsubscribeしてrootを一度だけunmountする", () => {
  const fixture = lifecycleFixture();
  fixture.adapter.mount();
  fixture.adapter.stop();
  fixture.adapter.stop();

  assert.deepEqual(fixture.events, [
    "createRoot",
    "render",
    "subscribe",
    "unsubscribe",
    "unmount",
  ]);
});

test("再mount前に以前のresourceを解放して新しいrootを作る", () => {
  const fixture = lifecycleFixture();
  fixture.adapter.mount();
  fixture.adapter.mount();

  assert.equal(fixture.roots.length, 2);
  assert.deepEqual(fixture.events, [
    "createRoot",
    "render",
    "subscribe",
    "unsubscribe",
    "unmount",
    "createRoot",
    "render",
    "subscribe",
  ]);
});

test("購読開始失敗時も生成済みrootを解放する", () => {
  const events: string[] = [];
  const adapter = createReactShellRoot({
    container: document.createElement("div"),
    source: {
      getSnapshot: () => ({ kind: "loading" }),
      subscribe: () => {
        throw new Error("subscribe failed");
      },
    },
    render: () => null,
    createRoot: () =>
      ({
        render: () => events.push("render"),
        unmount: () => events.push("unmount"),
      }) as unknown as ReactDomRoot,
  });

  assert.throws(() => adapter.mount(), /subscribe failed/);
  assert.deepEqual(events, ["render", "unmount"]);
  adapter.stop();
  assert.deepEqual(events, ["render", "unmount"]);
});

test("初期state取得失敗時も生成済みrootを解放する", () => {
  const events: string[] = [];
  const adapter = createReactShellRoot({
    container: document.createElement("div"),
    source: {
      getSnapshot: () => {
        throw new Error("snapshot failed");
      },
      subscribe: () => () => {},
    },
    render: () => null,
    createRoot: () =>
      ({
        render: () => events.push("render"),
        unmount: () => events.push("unmount"),
      }) as unknown as ReactDomRoot,
  });

  assert.throws(() => adapter.mount(), /snapshot failed/);
  assert.deepEqual(events, ["unmount"]);
  adapter.stop();
  assert.deepEqual(events, ["unmount"]);
});

test("unsubscribe失敗時もrootをunmountして再stopではcleanupしない", () => {
  const events: string[] = [];
  const unsubscribeError = new Error("unsubscribe failed");
  const adapter = createReactShellRoot({
    container: document.createElement("div"),
    source: {
      getSnapshot: () => ({ kind: "loading" }),
      subscribe: () => () => {
        events.push("unsubscribe");
        throw unsubscribeError;
      },
    },
    render: () => null,
    createRoot: () =>
      ({
        render: () => {},
        unmount: () => events.push("unmount"),
      }) as unknown as ReactDomRoot,
  });
  adapter.mount();

  assert.throws(
    () => adapter.stop(),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 1 &&
      error.errors[0] === unsubscribeError,
  );
  assert.deepEqual(events, ["unsubscribe", "unmount"]);
  adapter.stop();
  assert.deepEqual(events, ["unsubscribe", "unmount"]);
});

test("unsubscribeとunmountの両失敗を順序通りAggregateErrorへ保持する", () => {
  const unsubscribeError = new Error("unsubscribe failed");
  const unmountError = new Error("unmount failed");
  const adapter = createReactShellRoot({
    container: document.createElement("div"),
    source: {
      getSnapshot: () => ({ kind: "loading" }),
      subscribe: () => () => {
        throw unsubscribeError;
      },
    },
    render: () => null,
    createRoot: () =>
      ({
        render: () => {},
        unmount: () => {
          throw unmountError;
        },
      }) as unknown as ReactDomRoot,
  });
  adapter.mount();

  assert.throws(
    () => adapter.stop(),
    (error) =>
      error instanceof AggregateError &&
      error.message === "React shell root cleanup failed" &&
      error.errors.length === 2 &&
      error.errors[0] === unsubscribeError &&
      error.errors[1] === unmountError,
  );
  adapter.stop();
});
