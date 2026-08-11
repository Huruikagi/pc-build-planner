import assert from "node:assert/strict";
import test from "node:test";

import { createMonotonicProjectReadBinding } from "../../src/application-shell/monotonic-project-read-binding.js";
import type { ProjectContextSnapshot } from "../../src/project-context/public.js";

const snapshot = (generation: number): ProjectContextSnapshot => ({
  status: "empty",
  generation,
  selectedProjectId: null,
  catalog: [],
});

const source = (initial: ProjectContextSnapshot) => {
  let current = initial;
  let listener: ((value: ProjectContextSnapshot) => void) | undefined;
  let unsubscribeFailures = 0;
  let unsubscribeCalls = 0;
  return {
    read: {
      getSnapshot: () => current,
      subscribe(next: (value: ProjectContextSnapshot) => void) {
        listener = next;
        return () => {
          unsubscribeCalls += 1;
          if (unsubscribeFailures > 0) {
            unsubscribeFailures -= 1;
            throw new Error("synthetic unsubscribe failure");
          }
          listener = undefined;
        };
      },
    },
    emit(next: ProjectContextSnapshot) {
      current = next;
      listener?.(next);
    },
    failNextUnsubscribe() {
      unsubscribeFailures += 1;
    },
    unsubscribeCalls: () => unsubscribeCalls,
  };
};

test("monotonic project read bindingはsame/staleを除外し新generationをexactly once配送する", () => {
  const binding = createMonotonicProjectReadBinding(snapshot(0));
  const upstream = source(snapshot(1));
  const received: number[] = [];
  binding.read.subscribe((value) => received.push(value.generation));
  binding.bind(upstream.read);

  upstream.emit(snapshot(1));
  upstream.emit(snapshot(0));
  upstream.emit(snapshot(2));
  upstream.emit(snapshot(2));

  assert.deepEqual(received, [2]);
  assert.equal(binding.read.getSnapshot().generation, 2);
});

test("listener例外を隔離し後続consumerへ同じgenerationと次generationを配送する", () => {
  const binding = createMonotonicProjectReadBinding(snapshot(0));
  const received: number[] = [];
  binding.read.subscribe(() => {
    throw new Error("synthetic listener failure");
  });
  binding.read.subscribe((value) => received.push(value.generation));

  binding.publish(snapshot(1));
  binding.publish(snapshot(1));
  binding.publish(snapshot(0));
  binding.publish(snapshot(2));

  assert.deepEqual(received, [1, 2]);
  assert.equal(binding.read.getSnapshot().generation, 2);
});

test("unbind失敗は所有権を保持しretry成功後だけ再bindできる", () => {
  const binding = createMonotonicProjectReadBinding(snapshot(0));
  const first = source(snapshot(1));
  const second = source(snapshot(10));
  binding.bind(first.read);
  first.failNextUnsubscribe();

  assert.throws(() => binding.unbind(), /synthetic unsubscribe failure/);
  assert.equal(first.unsubscribeCalls(), 1);
  assert.throws(() => binding.bind(second.read), /binding is still owned/);

  binding.unbind();
  assert.equal(first.unsubscribeCalls(), 2);
  binding.bind(second.read);
  second.emit(snapshot(11));
  assert.equal(binding.read.getSnapshot().generation, 11);
  binding.unbind();
  binding.bind(first.read);
  first.emit(snapshot(12));
  assert.equal(binding.read.getSnapshot().generation, 12);
});
