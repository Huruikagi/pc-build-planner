/**
 * Canonical (and only) package import of the runtime schema vendor.
 *
 * Manifest V3 forbids dynamic code evaluation, so `jitless` must be active
 * before any schema is constructed. Keeping the package import in a single
 * module is what makes that ordering provable: every schema author goes
 * through `runtime-schema/public.ts`, which re-exports the namespace this
 * module has already configured.
 *
 * Vendor error classes, locales and schema instances are internal details of
 * the validation kernel and never become part of an owner's public contract.
 */
import * as zodMini from "zod/mini";

zodMini.config({ jitless: true });

export { zodMini as z };
