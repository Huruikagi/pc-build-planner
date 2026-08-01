import assert from "node:assert/strict";
import test from "node:test";
import type {
  TargetTabId,
  TransientGestureRegistrationPort,
  TransientGestureSource,
} from "../../../src/application-shell/public.js";
import type {
  CandidatePartId,
  CandidateSourceId,
} from "../../../src/domain/public.js";
import type {
  CandidateSourceCatalogPort,
  CandidateSourceMutationPort,
} from "../../../src/features/candidate-management/public.js";
import type { PagePriceExtractionPort } from "../../../src/features/product-capture/public.js";
import {
  candidateSourceMatchScope,
  catalogSourceMatchScope,
  createSourcePriceRefreshUpstreamPorts,
  type SourcePriceRefreshUpstreamPorts,
  sourcePriceRefreshFeatureId,
} from "../../../src/features/source-price-refresh/public.js";

const candidateId = "40000000-0000-4000-8000-000000000001" as CandidatePartId;
const sourceId = "50000000-0000-4000-8000-000000000001" as CandidateSourceId;

const catalog = (): CandidateSourceCatalogPort => ({
  async listSourceReferences() {
    return {
      ok: true,
      value: [{ candidateId, sourceId, isPrimary: true, kind: "retail" }],
    };
  },
  async getSourceReference() {
    return {
      ok: true,
      value: { candidateId, sourceId, isPrimary: true, kind: "retail" },
    };
  },
});

const mutations = (): CandidateSourceMutationPort => ({
  async addSource() {
    return { ok: true, value: undefined };
  },
  async updateSource() {
    return { ok: true, value: undefined };
  },
  async patchSourcePrice() {
    return { ok: true, value: undefined };
  },
  async removeSource() {
    return { ok: true, value: undefined };
  },
  async setPrimarySource() {
    return { ok: true, value: undefined };
  },
});

const pagePriceExtraction = (): PagePriceExtractionPort => ({
  async extractPrice() {
    return { ok: false, error: { kind: "tab-unavailable" } };
  },
});

const gestures = (
  registered: TransientGestureSource[],
): TransientGestureRegistrationPort => ({
  register(source) {
    registered.push(source);
    return { ok: true, value: () => {} };
  },
});

const dependencies = (
  registered: TransientGestureSource[] = [],
): SourcePriceRefreshUpstreamPorts => ({
  catalog: catalog(),
  mutations: mutations(),
  pagePriceExtraction: pagePriceExtraction(),
  gestures: gestures(registered),
});

test("公開featureIdは一過性面と同じ安定IDを露出する", () => {
  assert.equal(sourcePriceRefreshFeatureId, "source-price-refresh");
});

test("照合scopeはcatalog全体と候補一件を判別共用体で区別する", () => {
  const catalogScope = catalogSourceMatchScope();
  const candidateScope = candidateSourceMatchScope(candidateId);
  assert.deepEqual(catalogScope, { kind: "catalog" });
  assert.deepEqual(candidateScope, { kind: "candidate", candidateId });
  assert.equal(
    candidateScope.kind === "candidate"
      ? candidateScope.candidateId
      : undefined,
    candidateId,
  );
  assert.ok(Object.isFrozen(catalogScope));
  assert.ok(Object.isFrozen(candidateScope));
});

test("公開入口は確定済み上流portだけを凍結済みで組み立てる", async () => {
  const registered: TransientGestureSource[] = [];
  const input = dependencies(registered);
  const ports = createSourcePriceRefreshUpstreamPorts(input);

  assert.ok(Object.isFrozen(ports));
  assert.deepEqual(Object.keys(ports).toSorted(), [
    "catalog",
    "gestures",
    "mutations",
    "pagePriceExtraction",
  ]);
  assert.equal(ports.catalog, input.catalog);
  assert.equal(ports.mutations, input.mutations);
  assert.equal(ports.pagePriceExtraction, input.pagePriceExtraction);

  const listed = await ports.catalog.listSourceReferences({});
  assert.ok(listed.ok);
  assert.deepEqual(listed.value, [
    { candidateId, sourceId, isPrimary: true, kind: "retail" },
  ]);
  const updated = await ports.mutations.patchSourcePrice({
    candidateId,
    sourceId,
    expectedPageUrl: "https://shop.example.invalid/item",
    expectedKind: "retail",
    price: { original: "100 SYN", confirmed: { amount: 100, currency: "SYN" } },
    capturedAt: "2026-08-02T00:00:00.000Z" as never,
  });
  assert.ok(updated.ok);
  const extracted = await ports.pagePriceExtraction.extractPrice(
    7 as TargetTabId,
  );
  assert.deepEqual(extracted, {
    ok: false,
    error: { kind: "tab-unavailable" },
  });

  const source: TransientGestureSource = {
    id: "source-price-refresh",
    surfaceId: sourcePriceRefreshFeatureId,
    start: () => ({ ok: true, value: () => {} }),
  };
  const registration = ports.gestures.register(source);
  assert.ok(registration.ok);
  assert.deepEqual(registered, [source]);
});

test("上流portまたは必須操作を欠く依存は公開入口が拒否する", () => {
  const invalid: readonly (() => SourcePriceRefreshUpstreamPorts)[] = [
    () => ({ ...dependencies(), catalog: undefined as never }),
    () =>
      ({
        ...dependencies(),
        catalog: { listSourceReferences: catalog().listSourceReferences },
      }) as never,
    () => ({ ...dependencies(), mutations: {} as never }),
    () => ({ ...dependencies(), pagePriceExtraction: {} as never }),
    () => ({ ...dependencies(), gestures: {} as never }),
  ];
  for (const build of invalid)
    assert.throws(() => createSourcePriceRefreshUpstreamPorts(build()), {
      name: "TypeError",
    });
});
