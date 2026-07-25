import type { ReactElement, ReactNode } from "react";
import { createContext, createElement, useContext } from "react";
import type { MessageResolver } from "./resolver.js";
import { defaultMessageResolver } from "./resolver.js";

/** The context value is the resolver itself; it never exposes a language code or the catalog. */
const MessageContext = createContext<MessageResolver>(defaultMessageResolver);

/** Supplies a resolver to the subtree. Omitting `resolver` uses the bundled default. */
export function MessageProvider({
  resolver = defaultMessageResolver,
  children,
}: {
  readonly resolver?: MessageResolver;
  readonly children: ReactNode;
}): ReactElement {
  return createElement(MessageContext.Provider, { value: resolver }, children);
}

/** Resolves messages for display. Returns the bundled default resolver when no Provider is mounted. */
export function useMessages(): MessageResolver {
  return useContext(MessageContext);
}
