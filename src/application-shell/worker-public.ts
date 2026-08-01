/**
 * Worker-safe subset of the application shell public entry.
 *
 * `public.ts` re-exports the side panel composition root, whose module graph
 * reaches React and the DOM. Feature modules that also run inside the service
 * worker consume this entry instead, so the worker bundle never pulls a UI
 * module graph in just to reach a shell port. Everything exported here must
 * stay free of DOM, React and side panel dependencies.
 */
export type { FeatureId } from "./contracts.js";
export type {
  TargetTabId,
  TargetTabIdValidationError,
  TransientGestureRegistrationError,
  TransientGestureRegistrationPort,
  TransientGestureSource,
  TransientMenuApi,
  TransientMenuClickEvent,
  TransientMenuClickListener,
  TransientMenuGestureDependencies,
  TransientMenuItemProperties,
} from "./transient-surface-ports.js";
export { parseTargetTabId } from "./transient-surface-ports.js";
