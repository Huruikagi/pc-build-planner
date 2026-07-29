import assert from "node:assert/strict";
import test from "node:test";

import type {
  LocalDataRoot,
  UtcTimestamp,
} from "../../../src/domain/public.js";
import {
  exchangeMapper,
  exchangeMigration,
  exchangeValidator,
} from "../../../src/features/backup-restore/exchange.js";
import {
  buildCorruptBackupEnvelopes,
  buildCurrentBackupEnvelope,
  buildEmptyBackupEnvelope,
  buildFutureVersionEnvelope,
} from "../../fixtures/backup.js";
import { buildFoundationRoot } from "../../fixtures/foundation.js";

const EMPTY_ROOT = {
  schemaVersion: 1,
  revision: 0,
  projects: [],
  candidateParts: [],
  currentBuilds: [],
  requestDedupe: [],
  maintenance: { generation: 0, active: false },
} as unknown as LocalDataRoot;

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

test("formatVersion 1の複数ソース候補は全ソースとprimaryを保持して検証される", () => {
  const envelope = structuredClone(buildCurrentBackupEnvelope()) as unknown as {
    data: { parts: Array<Record<string, unknown>> };
  };
  const part = envelope.data.parts[0];
  assert.ok(part);
  part.sources = [
    {
      id: "40000000-0000-4000-8000-000000000004",
      pageUrl: "https://shop.invalid/fictional-cpu",
      siteName: "架空販売店",
      capturedAt: "2026-07-19T00:00:00.000Z",
      price: {
        original: "12,345円",
        confirmed: { amount: 12345, currency: "JPY" },
      },
      kind: "retail",
    },
    {
      id: "40000000-0000-4000-8000-000000000005",
      pageUrl: "https://manufacturer.invalid/fictional-cpu",
      siteName: "架空メーカー",
      capturedAt: "2026-07-18T00:00:00.000Z",
      kind: "manufacturer",
    },
  ];
  part.primarySourceId = "40000000-0000-4000-8000-000000000004";

  const result = exchangeValidator.validate(envelope);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.data.parts[0]?.sources, part.sources);
    assert.equal(
      result.value.data.parts[0]?.primarySourceId,
      part.primarySourceId,
    );
  }
});

test("旧開発版formatVersion 1の単数sourceInfoと商品priceは未対応形式として拒否される", () => {
  const envelope = structuredClone(buildCurrentBackupEnvelope()) as unknown as {
    data: { parts: Array<Record<string, unknown>> };
  };
  const part = envelope.data.parts[0];
  assert.ok(part);
  delete part.sources;
  delete part.primarySourceId;
  part.sourceInfo = {
    pageUrl: "https://legacy.invalid/fictional-cpu",
    capturedAt: "2026-07-19T00:00:00.000Z",
  };
  part.product = {
    ...(part.product as Record<string, unknown>),
    price: {
      original: "12,345円",
      confirmed: { amount: 12345, currency: "JPY" },
    },
  };

  const result = exchangeMigration.toCurrent(envelope);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported-version");
    assert.equal(result.error.path, "$.formatVersion");
  }
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

test("現行版envelopeはそのまま検証され現行形式へ到達する", () => {
  const envelope = buildCurrentBackupEnvelope();
  const result = exchangeMigration.toCurrent(envelope);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, envelope);
});

test("空データの現行版envelopeも現行形式へ到達する", () => {
  const result = exchangeMigration.toCurrent(buildEmptyBackupEnvelope());

  assert.equal(result.ok, true);
});

test("将来形式版は内容を変換せずunsupported-versionとして拒否される", () => {
  const result = exchangeMigration.toCurrent(buildFutureVersionEnvelope());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported-version");
    assert.equal(result.error.path, "$.formatVersion");
    assert.equal(Object.keys(result.error).length, 2);
  }
});

test("移行経路が登録されていない旧版番号もunsupported-versionとして拒否される", () => {
  const envelope = {
    ...buildEmptyBackupEnvelope(),
    formatVersion: 0,
  };
  const result = exchangeMigration.toCurrent(envelope);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported-version");
    assert.equal(result.error.path, "$.formatVersion");
  }
});

test("formatVersionが数値でない場合はvalidatorへ委譲され構造エラーとなる", () => {
  const envelope = {
    ...buildEmptyBackupEnvelope(),
    formatVersion: "1",
  };
  const result = exchangeMigration.toCurrent(envelope);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid-structure");
    assert.equal(result.error.path, "$.formatVersion");
  }
});

test("空rootのfromRoot・toRoot往復はEnvelope形式とroot形状の双方を保つ", () => {
  const createdAt = "2026-07-19T01:00:00.000Z" as UtcTimestamp;
  const envelope = exchangeMapper.fromRoot(EMPTY_ROOT, createdAt);

  assert.equal(envelope.product, "pc-build-planner");
  assert.equal(envelope.formatVersion, 1);
  assert.equal(envelope.createdAt, createdAt);
  assert.deepEqual(envelope.data, {
    projects: [],
    parts: [],
    currentBuilds: [],
  });

  const restored = exchangeMapper.toRoot(envelope);
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.equal(restored.value.schemaVersion, 1);
    assert.equal(restored.value.revision, 0);
    assert.deepEqual(restored.value.maintenance, {
      generation: 0,
      active: false,
    });
    assert.deepEqual(restored.value.requestDedupe, []);
    assert.deepEqual(restored.value.projects, []);
    assert.deepEqual(restored.value.candidateParts, []);
    assert.deepEqual(restored.value.currentBuilds, []);
  }
});

test("全12カテゴリを含むrootのfromRoot・toRoot往復は業務データを欠落なく一致させる", () => {
  const root = buildFoundationRoot();
  const createdAt = "2026-07-19T02:00:00.000Z" as UtcTimestamp;

  const envelope = exchangeMapper.fromRoot(root, createdAt);
  assert.equal(envelope.data.projects.length, root.projects.length);
  assert.equal(envelope.data.parts.length, root.candidateParts.length);
  assert.equal(envelope.data.currentBuilds.length, root.currentBuilds.length);

  const restored = exchangeMapper.toRoot(envelope);
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.deepEqual(restored.value.projects, root.projects);
    assert.deepEqual(restored.value.candidateParts, root.candidateParts);
    assert.deepEqual(restored.value.currentBuilds, root.currentBuilds);
    // 保存schemaVersion・revision・maintenance・requestDedupeは交換データから信頼せず、
    // Foundationのassess/replace側で再確定される前提のplaceholder値へ一律揃える。
    assert.equal(restored.value.schemaVersion, 1);
    assert.equal(restored.value.revision, 0);
    assert.deepEqual(restored.value.requestDedupe, []);
  }
});

test("交換データを検証してから相互変換しても業務データが一致する", () => {
  const envelope = buildCurrentBackupEnvelope();
  const validated = exchangeValidator.validate(envelope);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const restored = exchangeMapper.toRoot(validated.value);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;

  const roundTripped = exchangeMapper.fromRoot(
    restored.value,
    envelope.createdAt,
  );
  assert.deepEqual(roundTripped.data, envelope.data);
});
