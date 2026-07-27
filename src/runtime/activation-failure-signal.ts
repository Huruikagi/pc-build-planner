import { err, ok, type Result } from "../domain/public.js";

export const ACTIVATION_FAILURE_TITLE =
  "起動情報を保存できません。拡張アイコンを再操作してください";

export type ActivationFailureSignalError =
  | { readonly kind: "publish-failed" }
  | { readonly kind: "clear-failed" };

export interface ChromeActionSignalApi {
  readonly action: {
    setBadgeText(details: { readonly text: string }): Promise<void>;
    setTitle(details: { readonly title: string }): Promise<void>;
  };
  readonly runtime: {
    getManifest(): {
      readonly name?: string;
      readonly action?: { readonly default_title?: string };
    };
  };
}

export interface ActivationFailureSignal {
  publish(): Promise<Result<void, ActivationFailureSignalError>>;
  onDurablePutSucceeded(): Promise<Result<void, ActivationFailureSignalError>>;
  onReadSucceeded(): void;
  onPanelOpened(): void;
}

export const createChromeActivationFailureSignal = (
  chrome: ChromeActionSignalApi,
): ActivationFailureSignal => {
  const normalTitle = () => {
    const manifest = chrome.runtime.getManifest();
    return manifest.action?.default_title || manifest.name || "";
  };
  return {
    async publish() {
      try {
        await chrome.action.setBadgeText({ text: "!" });
        await chrome.action.setTitle({ title: ACTIVATION_FAILURE_TITLE });
        return ok(undefined);
      } catch {
        return err({ kind: "publish-failed" });
      }
    },
    async onDurablePutSucceeded() {
      try {
        await chrome.action.setBadgeText({ text: "" });
        await chrome.action.setTitle({ title: normalTitle() });
        return ok(undefined);
      } catch {
        return err({ kind: "clear-failed" });
      }
    },
    onReadSucceeded() {},
    onPanelOpened() {},
  };
};
