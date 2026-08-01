import { act } from "react";

import type {
  FeatureMountContext,
  FeatureMountHandle,
} from "../src/application-shell/public.js";

interface MountableRegistration {
  mount(context: FeatureMountContext): Promise<FeatureMountHandle>;
}

/** Keeps production registration lifecycle tests inside React's update boundary. */
export const actWrappedRegistrationFactory =
  <Args extends readonly unknown[], Registration extends MountableRegistration>(
    factory: (...args: Args) => Registration,
  ): ((...args: Args) => Registration) =>
  (...args) => {
    const registration = factory(...args);
    return {
      ...registration,
      async mount(context: FeatureMountContext): Promise<FeatureMountHandle> {
        let handle!: FeatureMountHandle;
        await act(async () => {
          handle = await registration.mount(context);
        });
        return {
          ...handle,
          async unmount(): Promise<void> {
            await act(async () => handle.unmount());
          },
        };
      },
    } as Registration;
  };
