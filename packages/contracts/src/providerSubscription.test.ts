import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "./index.ts";
import { describe, expect, it } from "vite-plus/test";
import {
  canUseProviderSubscription,
  nextWeeklySubscriptionReset,
  orderSubscriptionProviders,
} from "./providerSubscription.ts";

describe("subscription access", () => {
  it("keeps the owner eligible and closes borrowers at the captured weekly reset", () => {
    const reset = "2026-11-14T12:00:00Z";
    const grant = { ownerUserId: "alice", sharedUntil: reset };
    const now = Date.parse(reset);
    expect(canUseProviderSubscription(grant, "alice", now)).toBe(true);
    expect(canUseProviderSubscription(grant, "bob", now - 1)).toBe(true);
    expect(canUseProviderSubscription(grant, "bob", now)).toBe(false);
    expect(canUseProviderSubscription(grant, null, now - 1)).toBe(false);
    expect(canUseProviderSubscription({ ...grant, sharedUntil: null }, "bob", now - 1)).toBe(false);
    expect(canUseProviderSubscription(undefined, null, now)).toBe(true);
  });

  it("chooses the earliest future weekly reset without substituting a session reset", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    const usageLimits = {
      checkedAt: "2026-11-07T12:00:00Z",
      windows: [
        {
          id: "session",
          kind: "session" as const,
          label: "Session",
          usedPercent: 0,
          resetsAt: "2026-11-07T17:00:00Z",
        },
        {
          id: "weekly",
          kind: "weekly" as const,
          label: "Weekly",
          usedPercent: 0,
          resetsAt: "2026-11-14T12:00:00Z",
        },
      ],
    };
    expect(nextWeeklySubscriptionReset({ usageLimits }, now)).toBe("2026-11-14T12:00:00Z");
    expect(
      nextWeeklySubscriptionReset(
        { usageLimits: { ...usageLimits, windows: usageLimits.windows.slice(0, 1) } },
        now,
      ),
    ).toBeNull();
  });
});

it("prefers personal accounts, offers active shared accounts and never renews expired access", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const reset = "2026-11-14T12:00:00Z";
  const makeProvider = (id: string): ServerProvider => ({
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-07T12:00:00Z",
    models: [],
    slashCommands: [],
    skills: [],
  });
  const providers = ["shared", "private", "legacy", "personal"].map(makeProvider);
  const subscriptions = {
    shared: { ownerUserId: "bob", sharedUntil: reset },
    private: { ownerUserId: "bob", sharedUntil: null },
    personal: { ownerUserId: "alice", sharedUntil: null },
  };
  const ids = (list: ReadonlyArray<ServerProvider>) => list.map((provider) => provider.instanceId);
  expect(ids(orderSubscriptionProviders(providers, subscriptions, "alice", now))).toEqual([
    "personal",
    "shared",
    "legacy",
  ]);
  expect(
    ids(orderSubscriptionProviders(providers, subscriptions, "alice", Date.parse(reset))),
  ).toEqual(["personal", "legacy"]);
  expect(ids(orderSubscriptionProviders(providers, subscriptions, null, now))).toEqual(["legacy"]);
  const limited = providers.map((provider) =>
    provider.instanceId === "personal"
      ? {
          ...provider,
          usageLimits: {
            checkedAt: provider.checkedAt,
            windows: [
              {
                id: "weekly",
                kind: "weekly" as const,
                label: "Weekly",
                usedPercent: 100,
                resetsAt: reset,
              },
            ],
          },
        }
      : provider,
  );
  expect(ids(orderSubscriptionProviders(limited, subscriptions, "alice", now))).toEqual([
    "shared",
    "legacy",
  ]);
  for (const driver of ["cursor", "antigravity", "opencode"]) {
    const modelLimited = limited.map((provider) => ({
      ...provider,
      driver: ProviderDriverKind.make(driver),
    }));
    expect(ids(orderSubscriptionProviders(modelLimited, subscriptions, "alice", now))).toEqual([
      "personal",
      "shared",
      "legacy",
    ]);
  }
});
