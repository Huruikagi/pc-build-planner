import assert from "node:assert/strict";
import test from "node:test";

import type {
  ActivationId,
  TargetTabId,
  TransientSurfaceLifecyclePort,
} from "../../../src/application-shell/public.js";
import type { ProductCaptureTransientConsumerContract } from "../../../src/features/product-capture/contracts.js";

test("capture consumer contractはshell公開entry pointの一過性lifecycle型をそのまま参照する", () => {
  const lifecycle = {
    isCurrent: () => true,
    async dismiss() {
      return { ok: true as const, value: undefined };
    },
    async conclude() {
      return { ok: true as const, value: undefined };
    },
  } satisfies TransientSurfaceLifecyclePort;
  const contract: ProductCaptureTransientConsumerContract = {
    activation: {
      activationId: "activation-1" as ActivationId,
      tabId: 17 as TargetTabId,
    },
    lifecycle,
  };

  assert.equal(contract.lifecycle, lifecycle);
  assert.equal(contract.activation.tabId, 17);
});
