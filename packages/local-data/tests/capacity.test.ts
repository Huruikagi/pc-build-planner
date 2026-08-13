import assert from "node:assert/strict";
import test from "node:test";

import { createCapacityPolicy } from "../src/capacity.js";

interface SyntheticRoot {
  readonly payload: string;
}

const serializedBytes = (root: SyntheticRoot): number =>
  new TextEncoder().encode(root.payload).byteLength;

test("reports below capacity with current, projected, threshold, and quota bytes", () => {
  const policy = createCapacityPolicy(serializedBytes, 0.8);

  assert.deepEqual(policy.assess(125, { payload: "a".repeat(799) }, 1_000), {
    ok: true,
    value: {
      beforeBytes: 125,
      afterBytes: 799,
      warningThresholdBytes: 800,
      quotaBytes: 1_000,
      warning: false,
    },
  });
});

test("warning begins exactly at the configured threshold", () => {
  const policy = createCapacityPolicy(serializedBytes, 0.8);

  assert.deepEqual(policy.assess(125, { payload: "a".repeat(800) }, 1_000), {
    ok: true,
    value: {
      beforeBytes: 125,
      afterBytes: 800,
      warningThresholdBytes: 800,
      quotaBytes: 1_000,
      warning: true,
    },
  });
});

test("the quota boundary remains committable", () => {
  const policy = createCapacityPolicy(serializedBytes, 0.8);

  assert.deepEqual(policy.assess(900, { payload: "a".repeat(1_000) }, 1_000), {
    ok: true,
    value: {
      beforeBytes: 900,
      afterBytes: 1_000,
      warningThresholdBytes: 800,
      quotaBytes: 1_000,
      warning: true,
    },
  });
});

test("one byte over the platform quota returns a non-committable result", () => {
  const policy = createCapacityPolicy(serializedBytes, 0.8);

  assert.deepEqual(policy.assess(900, { payload: "a".repeat(1_001) }, 1_000), {
    ok: false,
    error: { code: "quota-exceeded" },
  });
});

test("uses each platform quota instead of assuming a fixed capacity", () => {
  const policy = createCapacityPolicy(serializedBytes, 0.5);

  assert.deepEqual(policy.assess(4, { payload: "abcdef" }, 8), {
    ok: true,
    value: {
      beforeBytes: 4,
      afterBytes: 6,
      warningThresholdBytes: 4,
      quotaBytes: 8,
      warning: true,
    },
  });
});
