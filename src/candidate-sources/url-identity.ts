import { err, ok, type Result } from "../domain/public.js";
import type { SourceIdentityError } from "./app-data-error-projection.js";

declare const candidateSourceUrlIdentityBrand: unique symbol;

export type CandidateSourceUrlIdentity = string & {
  readonly [candidateSourceUrlIdentityBrand]: true;
};

export const identifyCandidateSourceUrl = (
  value: string | undefined,
): Result<CandidateSourceUrlIdentity, SourceIdentityError> => {
  if (value === undefined || value === "") {
    return err({ kind: "source-identity-failure", reason: "missing-url" });
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return err({ kind: "source-identity-failure", reason: "invalid-url" });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err({ kind: "source-identity-failure", reason: "unsafe-scheme" });
  }

  try {
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return ok(parsed.toString() as CandidateSourceUrlIdentity);
  } catch {
    return err({ kind: "source-identity-failure", reason: "invalid-url" });
  }
};
