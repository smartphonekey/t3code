import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  appState: "background" as string | null,
  nativeCheckSupported: true,
  platform: "ios",
  subscribed: Promise.withResolvers<void>(),
  listeners: new Set<(state: string) => void>(),
  isProtectedDataAvailable: vi.fn<() => Promise<boolean>>(),
  readStorage: vi.fn<() => Promise<void>>(),
  readSecureStorage: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => ({
    ...(mocks.nativeCheckSupported && {
      isProtectedDataAvailable: mocks.isProtectedDataAvailable,
    }),
  }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.readSecureStorage,
  setItemAsync: async () => {
    throw new Error("Unexpected keychain write during startup");
  },
  deleteItemAsync: async () => {
    throw new Error("Unexpected keychain delete during startup");
  },
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
  AppState: {
    get currentState() {
      return mocks.appState;
    },
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.listeners.add(listener);
      mocks.subscribed.resolve();
      return { remove: () => mocks.listeners.delete(listener) };
    },
  },
}));

vi.mock("../persistence/layer", async () => {
  const Effect = await import("effect/Effect");
  const Layer = await import("effect/Layer");
  return { layer: Layer.effectDiscard(Effect.promise(mocks.readStorage)) };
});
vi.mock("../features/cloud/dpop", async () => ({
  layer: (await import("effect/Layer")).empty,
}));
vi.mock("../features/cloud/managedRelayLayer", async () => {
  const Layer = await import("effect/Layer");
  return { layer: () => Layer.empty };
});
vi.mock("../features/cloud/publicConfig", () => ({
  resolveCloudPublicConfig: () => ({ relay: { url: null } }),
}));
vi.mock("../features/observability/tracing", async () => ({
  layer: (await import("effect/Layer")).empty,
}));
vi.mock("@t3tools/client-runtime/rpc", async () => {
  const Layer = await import("effect/Layer");
  return { layerRemoteHttpClient: () => Layer.empty };
});

let runtime: typeof import("./runtime").runtime | undefined;

beforeEach(() => {
  vi.resetModules();
  mocks.appState = "background";
  mocks.nativeCheckSupported = true;
  mocks.platform = "ios";
  mocks.subscribed = Promise.withResolvers<void>();
  mocks.listeners.clear();
  mocks.isProtectedDataAvailable.mockReset();
  mocks.readStorage.mockReset().mockResolvedValue(undefined);
  mocks.readSecureStorage.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await runtime?.dispose();
  runtime = undefined;
});

describe("protected storage startup", () => {
  it.each([
    { launch: "background", state: "background", checkRejects: false },
    { launch: "background with a failed native check", state: "background", checkRejects: true },
    { launch: "unset without a native check", state: null, nativeCheckSupported: false },
  ])(
    "keeps a locked $launch launch usable after activation without rebuilding its runtime",
    async (scenario) => {
      mocks.appState = scenario.state;
      mocks.nativeCheckSupported = scenario.nativeCheckSupported ?? true;
      mocks.isProtectedDataAvailable.mockImplementation(async () => {
        if (scenario.checkRejects) throw new Error("Protected data check unavailable.");
        return false;
      });
      mocks.readStorage.mockImplementation(async () => {
        if (mocks.appState !== "active") throw new Error("User interaction is not allowed.");
      });
      mocks.readSecureStorage.mockImplementation(async () => {
        if (mocks.appState !== "active") throw new Error("Keychain unavailable while locked");
        return null;
      });
      ({ runtime } = await import("./runtime"));
      const startup = runtime.runPromiseExit(Effect.succeed("ready"));

      // A missing gate finishes startup with a cached storage failure instead.
      await Promise.race([mocks.subscribed.promise, startup]);
      expect(mocks.readStorage).not.toHaveBeenCalled();
      expect(mocks.readSecureStorage).not.toHaveBeenCalled();
      mocks.appState = "inactive";
      for (const listener of mocks.listeners) listener("inactive");
      await Promise.resolve();
      expect(mocks.readStorage).not.toHaveBeenCalled();
      expect(mocks.readSecureStorage).not.toHaveBeenCalled();

      mocks.appState = "active";
      for (const listener of mocks.listeners) listener("active");
      expect(await startup).toMatchObject({ _tag: "Success", value: "ready" });
      expect(await runtime.runPromise(Effect.succeed("still ready"))).toBe("still ready");
      expect(mocks.readStorage).toHaveBeenCalledOnce();
      const { ClientCapabilities } = await import("@t3tools/client-runtime/platform");
      expect(
        await runtime.runPromiseExit(
          Effect.flatMap(ClientCapabilities.CloudflareAccessGateway, (gateway) =>
            gateway.read("https://protected.example.test"),
          ),
        ),
      ).toMatchObject({ _tag: "Success", value: { _tag: "None" } });
      expect(mocks.readSecureStorage).toHaveBeenCalledOnce();

      expect(mocks.listeners.size).toBe(0);
      mocks.appState = "background";
      await (await import("./protectedData")).whenProtectedDataAvailable();
      expect(mocks.isProtectedDataAvailable).toHaveBeenCalledTimes(
        mocks.nativeCheckSupported ? 1 : 0,
      );
    },
  );
});
