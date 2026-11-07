// @effect-diagnostics globalTimers:off globalDate:off - Atom subscriptions expire display grants outside an Effect runtime.
import {
  orderSubscriptionProviders,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { managedRelaySessionAtom } from "../relay/managedRelayState.ts";

export function createSubscriptionProvidersAtom(
  providersAtom: Atom.Atom<ReadonlyArray<ServerProvider> | null>,
  settingsAtom: Atom.Atom<ServerSettings | null>,
) {
  return Atom.make((get) => {
    const providers = get(providersAtom);
    if (providers === null) return null;
    const subscriptions = get(settingsAtom)?.providerSubscriptions ?? {};
    const now = Date.now();
    const nextExpiry = Math.min(
      ...providers.flatMap(
        (provider) =>
          provider.usageLimits?.windows.flatMap((window) =>
            window.resetsAt !== undefined && Date.parse(window.resetsAt) > now
              ? [Date.parse(window.resetsAt)]
              : [],
          ) ?? [],
      ),
      ...Object.values(subscriptions).flatMap((entry) => {
        const expiry = entry.sharedUntil === null ? NaN : Date.parse(entry.sharedUntil);
        return expiry > now ? [expiry] : [];
      }),
    );
    if (Number.isFinite(nextExpiry)) {
      const timer = setTimeout(
        () => get.refreshSelf(),
        Math.min(nextExpiry - now + 1, 2_147_483_647),
      );
      get.addFinalizer(() => clearTimeout(timer));
    }
    return orderSubscriptionProviders(
      providers,
      subscriptions,
      get(managedRelaySessionAtom)?.accountId ?? null,
      now,
    );
  });
}
