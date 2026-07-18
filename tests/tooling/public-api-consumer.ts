import type { LocalDataRoot, Result } from "../../src/domain/public.js";
import type {
  FoundationDataPort,
  RootMutationCommand,
} from "../../src/persistence/public.js";

export interface MockFoundationConsumer {
  readonly data: FoundationDataPort;
  inspect(): Promise<Result<LocalDataRoot, { readonly code: string }>>;
  save(command: RootMutationCommand): ReturnType<FoundationDataPort["mutate"]>;
}
