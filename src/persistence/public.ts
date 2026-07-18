import type { Result } from "../domain/result.js";
import type {
  DataAuthorityDependencies,
  DataWorkerRegistration,
  RegistrationError,
} from "../runtime/worker-registration.js";
import { createDataWorkerRegistration as createInternalDataWorkerRegistration } from "../runtime/worker-registration.js";

export type { DataWorkerRegistration } from "../runtime/worker-registration.js";
export type {
  FoundationDataPort,
  MutationReceipt,
  RootMutationCommand,
} from "./write-authority.js";

type AccessRestrictionError = Extract<
  RegistrationError,
  { readonly code: "access-denied" | "quota-exceeded" | "storage-unavailable" }
>;

/** shellが具体Storage adapterを受け取らずにruntime登録をcompositionする公開依存。 */
export interface DataWorkerRegistrationDependencies
  extends Omit<DataAuthorityDependencies, "storage"> {
  readonly restrictAccess: () => Promise<Result<void, AccessRestrictionError>>;
}

export const createDataWorkerRegistration = (
  dependencies: DataWorkerRegistrationDependencies,
): DataWorkerRegistration =>
  createInternalDataWorkerRegistration({
    validator: dependencies.validator,
    authorize: dependencies.authorize,
    authority: dependencies.authority,
    storage: { restrictToTrustedContexts: dependencies.restrictAccess },
  });
