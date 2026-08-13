import assert from "node:assert/strict";

import {
  type CapacityPolicy,
  createCapacityPolicy,
} from "@pc-build-planner/local-data";

const policy: CapacityPolicy<string> = createCapacityPolicy(
  (candidate) => candidate.length,
  0.75,
);
const assessment = policy.assess(2, "built-output", 20);

assert.deepEqual(assessment, {
  ok: true,
  value: {
    beforeBytes: 2,
    afterBytes: 12,
    warningThresholdBytes: 15,
    quotaBytes: 20,
    warning: false,
  },
});
