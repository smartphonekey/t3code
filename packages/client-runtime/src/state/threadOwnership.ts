import { Atom } from "effect/reactivity";
import { managedRelaySessionAtom } from "../relay/managedRelayState.ts";

export const threadOwnershipScopeAtom = Atom.family((_accountId: string) =>
  Atom.make<"mine" | "all">("mine").pipe(Atom.keepAlive),
);

export const threadOwnerFilterAtom = Atom.make((get) => {
  const accountId = get(managedRelaySessionAtom)?.accountId;
  return accountId !== undefined && get(threadOwnershipScopeAtom(accountId)) === "mine"
    ? accountId
    : null;
});
