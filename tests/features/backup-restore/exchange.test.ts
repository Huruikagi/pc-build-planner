import assert from "node:assert/strict";
import test from "node:test";

import { exchangeValidator } from "../../../src/features/backup-restore/exchange.js";
import {
  buildCorruptBackupEnvelopes,
  buildCurrentBackupEnvelope,
  buildEmptyBackupEnvelope,
} from "../../fixtures/backup.js";

test("全カテゴリを含む現行envelopeは検証を通り値がそのまま返る", () => {
  const envelope = buildCurrentBackupEnvelope();
  const result = exchangeValidator.validate(envelope);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, envelope);
});

test("空データのenvelopeも検証を通る", () => {
  const result = exchangeValidator.validate(buildEmptyBackupEnvelope());

  assert.equal(result.ok, true);
});

test("JSON非互換の値はnot-jsonとして拒否される", () => {
  const result = exchangeValidator.validate({
    product: "pc-build-planner",
    formatVersion: 1,
    createdAt: "2026-07-19T00:00:00.000Z",
    data: { projects: [], parts: [], currentBuilds: [], extra: () => {} },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "not-json");
    assert.equal(result.error.path, "$");
  }
});

test("トップレベルが非objectの場合はnot-jsonとして拒否される", () => {
  const result = exchangeValidator.validate("not-an-object");

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "not-json");
});

for (const corrupt of buildCorruptBackupEnvelopes()) {
  test(`不正envelope（${corrupt.name}）は値を含まずcodeとpathで拒否される`, () => {
    const result = exchangeValidator.validate(corrupt.envelope);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, corrupt.expectedCode);
      assert.equal(result.error.path, corrupt.expectedPath);
      assert.equal(Object.keys(result.error).length, 2);
    }
  });
}

test("マークアップを含む値はinvalid-structureとして値を含まず拒否される", () => {
  const envelope = structuredClone(buildCurrentBackupEnvelope()) as unknown as {
    data: { parts: Array<{ product: Record<string, unknown> }> };
  };
  const product = envelope.data.parts[0]?.product;
  assert.ok(product);
  product.notes = {
    original: null,
    confirmed: "<script>架空攻撃</script>",
  };

  const result = exchangeValidator.validate(envelope);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid-structure");
    assert.equal(result.error.path, "$.data.parts[0].product.notes.confirmed");
    assert.equal(Object.keys(result.error).length, 2);
  }
});
