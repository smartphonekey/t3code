import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import type { ServerProvider } from "./server.ts";

export const ProviderSubscription = Schema.Struct({
  ownerUserId: TrimmedNonEmptyString,
  sharedUntil: Schema.NullOr(IsoDateTime),
});
export type ProviderSubscription = typeof ProviderSubscription.Type;

export const ProviderSubscriptionMutation = Schema.Struct({
  instanceId: ProviderInstanceId,
  action: Schema.Literals(["claim", "share", "revoke"]),
  expiresAt: Schema.optional(IsoDateTime),
});
export type ProviderSubscriptionMutation = typeof ProviderSubscriptionMutation.Type;

export function canUseProviderSubscription(
  subscription: ProviderSubscription | undefined,
  userId: string | null,
  now: number,
): boolean {
  return (
    subscription === undefined ||
    (userId !== null &&
      (subscription.ownerUserId === userId ||
        (subscription.sharedUntil !== null && Date.parse(subscription.sharedUntil) > now)))
  );
}

export function nextWeeklySubscriptionReset(
  provider: Pick<ServerProvider, "usageLimits">,
  now: number,
): string | null {
  const resets = provider.usageLimits?.windows
    .filter(
      (window) =>
        window.kind === "weekly" &&
        window.resetsAt !== undefined &&
        Date.parse(window.resetsAt) > now,
    )
    .map((window) => window.resetsAt!)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return resets?.[0] ?? null;
}

export function orderSubscriptionProviders(
  providers: ReadonlyArray<ServerProvider>,
  subscriptions: Readonly<Record<string, ProviderSubscription>>,
  userId: string | null,
  now: number,
): ReadonlyArray<ServerProvider> {
  const eligible = providers.filter((provider) => {
    const subscription = subscriptions[provider.instanceId];
    if (!canUseProviderSubscription(subscription, userId, now)) return false;
    // These providers have model-specific pools. Model selection handles exhaustion;
    // a single exhausted pool must not hide the account's other usable models.
    if (
      provider.driver === "cursor" ||
      provider.driver === "antigravity" ||
      provider.driver === "opencode"
    )
      return true;
    return (
      subscription === undefined ||
      !provider.usageLimits?.windows.some(
        (window) =>
          window.usedPercent >= 100 &&
          (window.resetsAt === undefined || Date.parse(window.resetsAt) > now),
      )
    );
  });
  if (userId === null) return eligible;
  const rank = (provider: ServerProvider) => {
    const subscription = subscriptions[provider.instanceId];
    return subscription?.ownerUserId === userId ? 0 : subscription === undefined ? 2 : 1;
  };
  return [...eligible].sort((a, b) => rank(a) - rank(b));
}
