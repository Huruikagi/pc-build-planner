/**
 * Canonical (and only) package import of the runtime schema vendor.
 *
 * Manifest V3 forbids dynamic code evaluation, so `jitless` must be active
 * before any schema is constructed. Keeping the package import in a single
 * module is what makes that ordering provable: every schema author goes
 * through `runtime-schema/public.ts`, which re-exports what this module has
 * already configured.
 *
 * The bindings are imported and re-exported **by name**. Re-exporting the
 * whole vendor namespace instead would reference every export the package has
 * and defeat tree shaking — measured at roughly 512 KB per production entry
 * against 35 KB for the surface below, which is the entire reason Zod Mini was
 * chosen. Adding a helper here is therefore a deliberate, reviewable step, not
 * an incidental one.
 *
 * Vendor error classes, locales and schema instances are internal details of
 * the validation kernel and never become part of an owner's public contract.
 */

import type { core, output } from "zod/mini";
import {
  array,
  clone,
  config,
  custom,
  literal,
  optional,
  pipe,
  record,
  safeParse,
  strictObject,
  string,
  superRefine,
  unknown,
} from "zod/mini";

config({ jitless: true });

/** Any configured vendor schema node, named so owners never spell a vendor type. */
export type SchemaNode = core.$ZodType;

/** Decoded output of a schema node, before the exact-optional normalisation. */
export type SchemaOutputOf<S extends SchemaNode> = output<S>;

export const z = {
  array,
  clone,
  config,
  custom,
  literal,
  optional,
  pipe,
  record,
  safeParse,
  strictObject,
  string,
  superRefine,
  unknown,
};
