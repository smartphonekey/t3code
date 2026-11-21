import { Atom } from "effect/reactivity";
import { managedRelaySessionAtom } from "../relay/managedRelayState.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import { enabledEnvironmentIds, type EnvironmentCatalogState } from "./connections.ts";

export const threadOwnershipScopeAtom = Atom.family((_accountId: string) =>
  Atom.make<"mine" | "all">("mine").pipe(Atom.keepAlive),
);

export const threadOwnerFilterAtom = Atom.make((get) => {
  const accountId = get(managedRelaySessionAtom)?.accountId;
  return accountId !== undefined && get(threadOwnershipScopeAtom(accountId)) === "mine"
    ? accountId
    : null;
});

export function createThreadOwnershipAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly configValueAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<{ readonly threadOwnerUserId?: string } | null>;
}) {
  const userIdAtom = Atom.make((get) => {
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      const userId = get(input.configValueAtom(environmentId))?.threadOwnerUserId;
      if (userId !== undefined) return userId;
    }
    return get(managedRelaySessionAtom)?.accountId ?? null;
  });
  const filterAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const scopeUserId = get(userIdAtom);
      if (scopeUserId === null || get(threadOwnershipScopeAtom(scopeUserId)) === "all") return null;
      return (
        get(input.configValueAtom(environmentId))?.threadOwnerUserId ??
        get(managedRelaySessionAtom)?.accountId ??
        null
      );
    }),
  );
  return { userIdAtom, filterAtom };
}
