import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: mocks.get,
  setItemAsync: mocks.set,
  deleteItemAsync: mocks.remove,
}));

import * as SecureStorage from "../../persistence/mobile-secure-storage";
import {
  clearCloudflareAccessSessionStorage,
  loadCloudflareAccessSession,
  saveCloudflareAccessSession,
} from "./storage";

it.effect("stores credentials under valid per-origin keys and recovers from corrupt data", () =>
  Effect.gen(function* () {
    mocks.values.clear();
    const valid = (key: string) => {
      if (!/^[\w.-]+$/.test(key)) throw new Error("Invalid SecureStore key");
    };
    mocks.get.mockImplementation(async (key: string) => {
      valid(key);
      return mocks.values.get(key) ?? null;
    });
    mocks.set.mockImplementation(async (key: string, value: string) => {
      valid(key);
      mocks.values.set(key, value);
    });
    mocks.remove.mockImplementation(async (key: string) => {
      valid(key);
      mocks.values.delete(key);
    });
    const origin = "https://t3.example.test:443";
    const session = new CloudflareAccessSession({ cfAuthorization: "secret" });
    expect(Option.isNone(yield* loadCloudflareAccessSession(origin))).toBe(true);
    yield* saveCloudflareAccessSession(origin, session);
    expect(Option.getOrThrow(yield* loadCloudflareAccessSession(origin))).toEqual(session);
    expect(Option.isNone(yield* loadCloudflareAccessSession("https://other.test"))).toBe(true);
    const key = [...mocks.values.keys()][0];
    if (key === undefined) throw new Error("Expected persisted credentials");
    for (const value of ["{bad-json", '{"unexpected":"shape"}']) {
      mocks.values.set(key, value);
      expect(Option.isNone(yield* loadCloudflareAccessSession(origin))).toBe(true);
    }
    yield* clearCloudflareAccessSessionStorage(origin);
    expect(mocks.values.size).toBe(0);
    mocks.get.mockRejectedValueOnce(new Error("Keychain locked"));
    expect((yield* loadCloudflareAccessSession(origin).pipe(Effect.flip))._tag).toBe(
      "MobileSecureStorageError",
    );
  }).pipe(Effect.provide(SecureStorage.layer)),
);
