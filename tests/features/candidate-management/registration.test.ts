import assert from "node:assert/strict";
import test from "node:test";

import type {
  Availability,
  FeatureMountHandle,
} from "../../../src/application-shell/contracts.js";
import type { FoundationDataPort } from "../../../src/persistence/public.js";
import { collectFeatureContractViolations } from "../../contracts/application-shell-contract-kit.js";
import { createCandidateFeatureRegistration } from "../../../src/features/candidate-management/registration.js";

test("候補管理registrationはshell契約へmount依存とoperation policyを注入する", async () => {
  const data = {} as FoundationDataPort;
  const observed: {
    data?: FoundationDataPort;
    readAllowed?: boolean;
    mutationAllowed?: boolean;
  } = {};
  const availabilityListeners = new Set<(value: Availability) => void>();
  const registration = createCandidateFeatureRegistration({
    data,
    subscribeAvailability(listener) {
      availabilityListeners.add(listener);
      return () => availabilityListeners.delete(listener);
    },
    mount: async ({ data: mountedData, operationPolicy, container }) => {
      observed.data = mountedData;
      observed.readAllowed = operationPolicy.isAllowed("read");
      observed.mutationAllowed = operationPolicy.isAllowed("mutation");
      container.textContent = "Candidate management";
      const handle: FeatureMountHandle = {
        async unmount() {
          container.textContent = "";
        },
      };
      return handle;
    },
  });

  assert.deepEqual(registration.publicApi, {});
  const violations = await collectFeatureContractViolations(registration, {
    emitAvailability: () => {
      for (const listener of availabilityListeners)
        listener({ status: "available" });
    },
  });

  assert.deepEqual(violations, []);
  assert.equal(observed.data, data);
  assert.equal(observed.readAllowed, true);
  assert.equal(observed.mutationAllowed, true);
});
