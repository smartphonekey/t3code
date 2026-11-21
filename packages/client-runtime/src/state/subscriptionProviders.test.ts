import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { managedRelaySessionAtom } from "../relay/managedRelayState.ts";
import { createSubscriptionProvidersAtom } from "./subscriptionProviders.ts";

it("updates account choices at quota resets and fixed sharing expiries without another server update", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2030-01-01T12:00:00Z"));
  const registry = AtomRegistry.make();
  try {
    const provider = (id: string): ServerProvider => ({
      instanceId: ProviderInstanceId.make(id),
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      status: "ready",
      version: null,
      auth: { status: "authenticated" },
      checkedAt: "2030-01-01T12:00:00Z",
      models: [],
      slashCommands: [],
      skills: [],
    });
    const personal = {
      ...provider("personal"),
      usageLimits: {
        checkedAt: "2030-01-01T12:00:00Z",
        windows: [
          {
            id: "session",
            label: "Session",
            kind: "session" as const,
            usedPercent: 100,
            resetsAt: "2030-01-01T12:05:00Z",
          },
        ],
      },
    };
    const providers = Atom.make<ReadonlyArray<ServerProvider> | null>([
      provider("shared"),
      personal,
    ]);
    const settings = Atom.make<ServerSettings | null>({
      ...DEFAULT_SERVER_SETTINGS,
      providerSubscriptions: {
        [personal.instanceId]: { ownerUserId: "alice", sharedUntil: null },
        [ProviderInstanceId.make("shared")]: {
          ownerUserId: "bob",
          sharedUntil: "2030-01-01T12:10:00Z",
        },
      },
    });
    registry.set(managedRelaySessionAtom, {
      accountId: "alice",
      readClerkToken: () => Effect.succeed(null),
    });
    const choices = createSubscriptionProvidersAtom(providers, settings);
    const unmount = registry.mount(choices);
    const ids = () => registry.get(choices)?.map((entry) => entry.instanceId);
    expect(ids()).toEqual(["shared"]);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(ids()).toEqual(["personal", "shared"]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ids()).toEqual(["personal"]);
    registry.set(managedRelaySessionAtom, {
      accountId: "bob",
      readClerkToken: () => Effect.succeed(null),
    });
    expect(ids()).toEqual(["shared"]);
    unmount();
  } finally {
    registry.dispose();
    vi.useRealTimers();
  }
});
