import assert from "node:assert/strict";
import test from "node:test";

import { decodeBackupEnvelopeShape } from "../../../src/features/backup-restore/backup-schema.js";
import { exchangeValidator } from "../../../src/features/backup-restore/exchange.js";
import {
  buildCorruptBackupEnvelopes,
  buildCurrentBackupEnvelope,
  buildEmptyBackupEnvelope,
} from "../../fixtures/backup.js";

test("configured runtime schemaとExchangeValidatorは有効な交換形式で同じ結果を返す", () => {
  for (const envelope of [
    buildCurrentBackupEnvelope(),
    buildEmptyBackupEnvelope(),
  ]) {
    const schemaResult = decodeBackupEnvelopeShape(envelope);
    const validatorResult = exchangeValidator.validate(envelope);

    assert.deepEqual(validatorResult, schemaResult);
  }
});

test("configured runtime schemaの構造エラーはExchangeValidatorで同じcode/pathへ写像される", () => {
  for (const corrupt of buildCorruptBackupEnvelopes()) {
    const schemaResult = decodeBackupEnvelopeShape(corrupt.envelope);
    const validatorResult = exchangeValidator.validate(corrupt.envelope);

    if (schemaResult.ok) continue;
    assert.equal(validatorResult.ok, false, corrupt.name);
    if (!schemaResult.ok && !validatorResult.ok) {
      assert.deepEqual(validatorResult.error, schemaResult.error, corrupt.name);
      assert.equal(Object.keys(validatorResult.error).length, 2, corrupt.name);
      assert.deepEqual(Object.keys(validatorResult.error).sort(), [
        "code",
        "path",
      ]);
    }
  }
});

test("configured strict objectはunknown keyを同じcanonical pathで拒否する", () => {
  const envelope = { ...buildEmptyBackupEnvelope(), unexpected: true };

  assert.deepEqual(decodeBackupEnvelopeShape(envelope), {
    ok: false,
    error: { code: "invalid-structure", path: "$.unexpected" },
  });
  assert.deepEqual(exchangeValidator.validate(envelope), {
    ok: false,
    error: { code: "invalid-structure", path: "$.unexpected" },
  });
});
