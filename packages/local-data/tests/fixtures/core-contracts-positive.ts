import type {
  CoreResult,
  LocalDataPolicy,
  StoragePort,
} from "../../src/index.js";

type Root = Readonly<{ revision: number; value: string }>;
type Operation = Readonly<{ value: string }>;
type Control = Readonly<{ owner: string | null }>;
type PolicyError = Readonly<{ code: "fixture-invalid" }>;

declare const policy: LocalDataPolicy<Root, Operation, Control, PolicyError>;
declare const storage: StoragePort<Root, Control>;
declare const input: unknown;

const decoded: CoreResult<Root, PolicyError> = policy.decodeAndMigrate(input);
const written: Promise<CoreResult<void, { readonly code: string }>> = storage.writeRoot({
  revision: 1,
  value: "synthetic",
});

void decoded;
void written;
