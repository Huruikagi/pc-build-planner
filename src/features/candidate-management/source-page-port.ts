import type { Result } from "../../domain/public.js";
import { err, ok } from "../../domain/public.js";

export type SourcePageOpenError =
  | { readonly kind: "invalid-url" }
  | { readonly kind: "runtime-unavailable" }
  | { readonly kind: "open-failed" };
export interface SourcePagePort {
  open(url: string): Promise<Result<void, SourcePageOpenError>>;
}
export interface TabsCreatePort {
  create(details: { readonly url: string }): Promise<unknown>;
}

export const safeSourcePageUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
};

export const createChromeSourcePagePort = (
  tabs?: TabsCreatePort,
): SourcePagePort => ({
  async open(url) {
    const validated = safeSourcePageUrl(url);
    if (validated === undefined) return err({ kind: "invalid-url" });
    if (tabs === undefined) return err({ kind: "runtime-unavailable" });
    try {
      await tabs.create({ url: validated });
      return ok(undefined);
    } catch {
      return err({ kind: "open-failed" });
    }
  },
});
