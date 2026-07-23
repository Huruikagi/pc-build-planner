import assert from "node:assert/strict";
import test from "node:test";
import type { CandidatePartId } from "../../../src/domain/public.js";
import type {
  RuleId,
  RuleTarget,
  RuleTargetParty,
} from "../../../src/features/compatibility/contracts.js";
import { RULE_REGISTRY } from "../../../src/features/compatibility/rules.js";

const partId = (raw: string): CandidatePartId =>
  raw as unknown as CandidatePartId;

const cpuId = partId("11111111-1111-4111-8111-111111111111");
const motherboardId = partId("22222222-2222-4222-8222-222222222222");
const coolerId = partId("33333333-3333-4333-8333-333333333333");
const memoryId = partId("44444444-4444-4444-8444-444444444444");
const caseId = partId("55555555-5555-4555-8555-555555555555");
const psuId = partId("66666666-6666-4666-8666-666666666666");

const present = (
  candidatePartId: CandidatePartId,
  displayName: string,
  value?: string | readonly string[],
): RuleTargetParty =>
  value === undefined
    ? { kind: "present", candidatePartId, displayName }
    : { kind: "present", candidatePartId, displayName, value };

const absent: RuleTargetParty = { kind: "absent" };

const ruleFor = (ruleId: RuleId) => {
  const found = RULE_REGISTRY.find((candidate) => candidate.id === ruleId);
  assert.ok(found, `expected rule ${ruleId} to be registered`);
  return found;
};

test("RULE_REGISTRY registers exactly the five fixed rules", () => {
  const expected: readonly RuleId[] = [
    "cpu-motherboard-socket",
    "motherboard-memory-ddr",
    "cooler-cpu-socket",
    "case-motherboard-form-factor",
    "case-psu-form-factor",
  ];
  assert.deepEqual(
    [...RULE_REGISTRY.map((rule) => rule.id)].sort(),
    [...expected].sort(),
  );
});

test("cpu-motherboard-socket: matching confirmed sockets are compatible", () => {
  const target: RuleTarget = {
    ruleId: "cpu-motherboard-socket",
    left: present(cpuId, "架空CPU", "AM5"),
    right: present(motherboardId, "架空マザーボード", "AM5"),
  };
  const result = ruleFor("cpu-motherboard-socket").evaluate(target);
  if (result.status === "compatible" || result.status === "incompatible") {
    assert.equal(result.status, "compatible");
    assert.deepEqual(result.comparedValue, { left: "AM5", right: "AM5" });
  } else {
    assert.fail("expected a decided status");
  }
});

test("cpu-motherboard-socket: mismatched confirmed sockets are incompatible", () => {
  const target: RuleTarget = {
    ruleId: "cpu-motherboard-socket",
    left: present(cpuId, "架空CPU", "AM5"),
    right: present(motherboardId, "架空マザーボード", "LGA1700"),
  };
  const result = ruleFor("cpu-motherboard-socket").evaluate(target);
  if (result.status === "compatible" || result.status === "incompatible") {
    assert.equal(result.status, "incompatible");
    assert.deepEqual(result.comparedValue, { left: "AM5", right: "LGA1700" });
  } else {
    assert.fail("expected a decided status");
  }
});

test("cpu-motherboard-socket: absent CPU category yields unknown, not incompatible", () => {
  const target: RuleTarget = {
    ruleId: "cpu-motherboard-socket",
    left: absent,
    right: present(motherboardId, "架空マザーボード", "AM5"),
  };
  const result = ruleFor("cpu-motherboard-socket").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "left", reason: "category-missing" },
    ]);
    assert.equal(result.left, undefined);
    assert.ok(result.right);
  } else {
    assert.fail("expected unknown status");
  }
});

test("cpu-motherboard-socket: unconfirmed motherboard socket yields unknown, not incompatible", () => {
  const target: RuleTarget = {
    ruleId: "cpu-motherboard-socket",
    left: present(cpuId, "架空CPU", "AM5"),
    right: present(motherboardId, "架空マザーボード"),
  };
  const result = ruleFor("cpu-motherboard-socket").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "right", reason: "value-unconfirmed" },
    ]);
  } else {
    assert.fail("expected unknown status");
  }
});

test("motherboard-memory-ddr: matching DDR standards are compatible", () => {
  const target: RuleTarget = {
    ruleId: "motherboard-memory-ddr",
    left: present(motherboardId, "架空マザーボード", "DDR5"),
    right: present(memoryId, "架空メモリ", "DDR5"),
  };
  const result = ruleFor("motherboard-memory-ddr").evaluate(target);
  assert.equal(result.status, "compatible");
});

test("motherboard-memory-ddr: mismatched DDR standards are incompatible", () => {
  const target: RuleTarget = {
    ruleId: "motherboard-memory-ddr",
    left: present(motherboardId, "架空マザーボード", "DDR5"),
    right: present(memoryId, "架空メモリ", "DDR4"),
  };
  const result = ruleFor("motherboard-memory-ddr").evaluate(target);
  assert.equal(result.status, "incompatible");
});

test("motherboard-memory-ddr: absent memory category yields unknown", () => {
  const target: RuleTarget = {
    ruleId: "motherboard-memory-ddr",
    left: present(motherboardId, "架空マザーボード", "DDR5"),
    right: absent,
  };
  const result = ruleFor("motherboard-memory-ddr").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "right", reason: "category-missing" },
    ]);
  } else {
    assert.fail("expected unknown status");
  }
});

test("cooler-cpu-socket: CPU socket included in cooler's supported sockets is compatible", () => {
  const target: RuleTarget = {
    ruleId: "cooler-cpu-socket",
    left: present(cpuId, "架空CPU", "AM5"),
    right: present(coolerId, "架空クーラー", ["AM4", "AM5"]),
  };
  const result = ruleFor("cooler-cpu-socket").evaluate(target);
  if (result.status === "compatible" || result.status === "incompatible") {
    assert.equal(result.status, "compatible");
    assert.deepEqual(result.comparedValue, {
      left: "AM5",
      right: ["AM4", "AM5"],
    });
  } else {
    assert.fail("expected a decided status");
  }
});

test("cooler-cpu-socket: CPU socket not in cooler's supported sockets is incompatible", () => {
  const target: RuleTarget = {
    ruleId: "cooler-cpu-socket",
    left: present(cpuId, "架空CPU", "LGA1700"),
    right: present(coolerId, "架空クーラー", ["AM4", "AM5"]),
  };
  const result = ruleFor("cooler-cpu-socket").evaluate(target);
  assert.equal(result.status, "incompatible");
});

test("cooler-cpu-socket: unconfirmed CPU socket yields unknown, not incompatible", () => {
  const target: RuleTarget = {
    ruleId: "cooler-cpu-socket",
    left: present(cpuId, "架空CPU"),
    right: present(coolerId, "架空クーラー", ["AM4", "AM5"]),
  };
  const result = ruleFor("cooler-cpu-socket").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "left", reason: "value-unconfirmed" },
    ]);
  } else {
    assert.fail("expected unknown status");
  }
});

test("case-motherboard-form-factor: supported motherboard form factor is compatible", () => {
  const target: RuleTarget = {
    ruleId: "case-motherboard-form-factor",
    left: present(motherboardId, "架空マザーボード", "Micro-ATX"),
    right: present(caseId, "架空ケース", ["ATX", "Micro-ATX"]),
  };
  const result = ruleFor("case-motherboard-form-factor").evaluate(target);
  assert.equal(result.status, "compatible");
});

test("case-motherboard-form-factor: unsupported motherboard form factor is incompatible", () => {
  const target: RuleTarget = {
    ruleId: "case-motherboard-form-factor",
    left: present(motherboardId, "架空マザーボード", "E-ATX"),
    right: present(caseId, "架空ケース", ["ATX", "Micro-ATX"]),
  };
  const result = ruleFor("case-motherboard-form-factor").evaluate(target);
  assert.equal(result.status, "incompatible");
});

test("case-motherboard-form-factor: absent case category yields unknown", () => {
  const target: RuleTarget = {
    ruleId: "case-motherboard-form-factor",
    left: present(motherboardId, "架空マザーボード", "Micro-ATX"),
    right: absent,
  };
  const result = ruleFor("case-motherboard-form-factor").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "right", reason: "category-missing" },
    ]);
  } else {
    assert.fail("expected unknown status");
  }
});

test("case-psu-form-factor: supported power supply form factor is compatible", () => {
  const target: RuleTarget = {
    ruleId: "case-psu-form-factor",
    left: present(psuId, "架空電源", "ATX"),
    right: present(caseId, "架空ケース", ["ATX", "SFX"]),
  };
  const result = ruleFor("case-psu-form-factor").evaluate(target);
  assert.equal(result.status, "compatible");
});

test("case-psu-form-factor: unsupported power supply form factor is incompatible", () => {
  const target: RuleTarget = {
    ruleId: "case-psu-form-factor",
    left: present(psuId, "架空電源", "SFX-L"),
    right: present(caseId, "架空ケース", ["ATX", "SFX"]),
  };
  const result = ruleFor("case-psu-form-factor").evaluate(target);
  assert.equal(result.status, "incompatible");
});

test("case-psu-form-factor: both categories absent yields unknown with both sides flagged", () => {
  const target: RuleTarget = {
    ruleId: "case-psu-form-factor",
    left: absent,
    right: absent,
  };
  const result = ruleFor("case-psu-form-factor").evaluate(target);
  assert.equal(result.status, "unknown");
  if (result.status === "unknown") {
    assert.deepEqual(result.missingFields, [
      { side: "left", reason: "category-missing" },
      { side: "right", reason: "category-missing" },
    ]);
    assert.equal(result.left, undefined);
    assert.equal(result.right, undefined);
  } else {
    assert.fail("expected unknown status");
  }
});

test("evaluation is deterministic and free of side effects for identical confirmed input", () => {
  const target: RuleTarget = {
    ruleId: "cooler-cpu-socket",
    left: present(cpuId, "架空CPU", "AM5"),
    right: present(coolerId, "架空クーラー", ["AM4", "AM5"]),
  };
  const rule = ruleFor("cooler-cpu-socket");
  const first = rule.evaluate(target);
  const second = rule.evaluate(target);
  assert.deepEqual(first, second);
  assert.deepEqual(target.left, present(cpuId, "架空CPU", "AM5"));
});
