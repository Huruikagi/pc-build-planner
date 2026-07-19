import type { WorkerMessageTarget } from "../persistence/public.js";

export interface RuntimeMessageEvent {
  addListener(listener: RuntimeMessageListener): void;
  removeListener(listener: RuntimeMessageListener): void;
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => true | undefined;

export interface FoundationMessageRuntime {
  readonly id: string;
  getURL(path: string): string;
  readonly onMessage: RuntimeMessageEvent;
}

const FOUNDATION_COMMAND_KINDS = new Set([
  "query-root",
  "mutate-root",
  "assess-replacement",
  "replace-root",
  "run-maintenance",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFoundationMessage = (message: unknown): boolean => {
  try {
    return (
      isRecord(message) &&
      typeof message.kind === "string" &&
      FOUNDATION_COMMAND_KINDS.has(message.kind)
    );
  } catch {
    return false;
  }
};

const isUrlUnderRoot = (candidate: string, root: string): boolean => {
  try {
    const candidateUrl = new URL(candidate);
    const rootUrl = new URL(root);
    return (
      candidateUrl.protocol === rootUrl.protocol &&
      candidateUrl.hostname === rootUrl.hostname &&
      candidateUrl.port === rootUrl.port &&
      candidateUrl.username === rootUrl.username &&
      candidateUrl.password === rootUrl.password &&
      candidateUrl.pathname.startsWith(
        rootUrl.pathname.endsWith("/")
          ? rootUrl.pathname
          : `${rootUrl.pathname}/`,
      )
    );
  } catch {
    return false;
  }
};

const classifyCaller = (runtime: FoundationMessageRuntime, sender: unknown) => {
  try {
    if (!isRecord(sender) || sender.id !== runtime.id)
      return { kind: "web-page" } as const;
    if (sender.tab !== undefined && sender.tab !== null)
      return { kind: "content-script" } as const;
    if (
      typeof sender.url === "string" &&
      isUrlUnderRoot(sender.url, runtime.getURL(""))
    )
      return { kind: "trusted-extension" } as const;
  } catch {
    // Sender and runtime values cross an untrusted platform boundary.
  }
  return { kind: "web-page" } as const;
};

const handlerFailure = {
  ok: false,
  error: { code: "message-handler-failed" },
} as const;

export const createChromeFoundationMessageTarget = (
  runtime: FoundationMessageRuntime,
): WorkerMessageTarget => ({
  addHandler: (handler) => {
    const listener: RuntimeMessageListener = (
      message,
      sender,
      sendResponse,
    ) => {
      if (!isFoundationMessage(message)) return undefined;

      let completion: ReturnType<typeof handler>;
      try {
        completion = handler(message, classifyCaller(runtime, sender));
      } catch {
        sendResponse(handlerFailure);
        return true;
      }
      Promise.resolve(completion).then(sendResponse, () =>
        sendResponse(handlerFailure),
      );
      return true;
    };
    runtime.onMessage.addListener(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      runtime.onMessage.removeListener(listener);
    };
  },
});
