import { buildCurrentBackupEnvelope } from "./backup.js";
import { sourceRoot } from "./candidate-source-root.js";
import {
  buildFoundationRoot,
  buildSourceMetadataCompatibilityRoot,
} from "./foundation.js";

export const syntheticSourceFixtures = [
  { name: "foundation", module: "foundation.ts", value: buildFoundationRoot() },
  {
    name: "foundation-partial-source",
    module: "foundation.ts",
    value: buildSourceMetadataCompatibilityRoot(),
  },
  {
    name: "candidate-source",
    module: "candidate-source-root.ts",
    value: sourceRoot(),
  },
  {
    name: "backup",
    module: "backup.ts",
    value: buildCurrentBackupEnvelope(),
  },
] as const;
