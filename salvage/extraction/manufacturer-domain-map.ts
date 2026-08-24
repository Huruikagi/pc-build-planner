import { err, ok, type Result } from "../../domain/public.js";

export interface ManufacturerDomainEntry {
  readonly registrableDomain: string;
  readonly manufacturer: string;
  readonly evidenceUrl: string;
  readonly reviewedAt: string;
  readonly owner: string;
}

export interface ManufacturerDomainMatch {
  readonly manufacturer: string;
  readonly sourceLabel: string;
}

export type ManufacturerDomainMapError =
  | { readonly kind: "invalid-entry"; readonly index: number }
  | { readonly kind: "duplicate-domain"; readonly registrableDomain: string }
  | { readonly kind: "invalid-page-url" };

export interface ManufacturerDomainMap {
  findManufacturer(
    pageUrl: string,
  ): Result<ManufacturerDomainMatch | undefined, ManufacturerDomainMapError>;
}

const isValidEntry = (entry: ManufacturerDomainEntry): boolean => {
  const domainLabels = entry.registrableDomain.split(".");
  const hasValidDomain =
    entry.registrableDomain.length <= 253 &&
    domainLabels.length >= 2 &&
    domainLabels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) &&
    !domainLabels.every((label) => /^\d+$/.test(label));
  if (
    !hasValidDomain ||
    entry.registrableDomain !== entry.registrableDomain.toLowerCase() ||
    entry.manufacturer.trim().length === 0 ||
    entry.owner.trim().length === 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedAt)
  ) {
    return false;
  }

  try {
    const evidence = new URL(entry.evidenceUrl);
    return evidence.protocol === "https:";
  } catch {
    return false;
  }
};

export const createManufacturerDomainMap = (
  entries: readonly ManufacturerDomainEntry[],
): Result<ManufacturerDomainMap, ManufacturerDomainMapError> => {
  const byDomain = new Map<string, ManufacturerDomainEntry>();
  for (const [index, entry] of entries.entries()) {
    if (!isValidEntry(entry)) return err({ kind: "invalid-entry", index });
    if (byDomain.has(entry.registrableDomain)) {
      return err({
        kind: "duplicate-domain",
        registrableDomain: entry.registrableDomain,
      });
    }
    byDomain.set(entry.registrableDomain, entry);
  }

  return ok({
    findManufacturer(pageUrl) {
      let hostname: string;
      try {
        const parsed = new URL(pageUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return err({ kind: "invalid-page-url" });
        }
        hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
      } catch {
        return err({ kind: "invalid-page-url" });
      }

      for (const entry of byDomain.values()) {
        if (
          hostname === entry.registrableDomain ||
          hostname.endsWith(`.${entry.registrableDomain}`)
        ) {
          return ok({
            manufacturer: entry.manufacturer,
            sourceLabel: entry.registrableDomain,
          });
        }
      }
      return ok(undefined);
    },
  });
};

const defaultMap = createManufacturerDomainMap([
  {
    registrableDomain: "asus.com",
    manufacturer: "ASUS",
    evidenceUrl: "https://www.asus.com/content/about-asus/",
    reviewedAt: "2026-07-28",
    owner: "Huruikagi",
  },
]);

if (!defaultMap.ok) {
  throw new Error("Invalid built-in manufacturer domain map");
}

export const manufacturerDomainMap = defaultMap.value;
