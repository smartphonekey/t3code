// @effect-diagnostics-next-line nodeBuiltinImport:off -- Generates and signs test JWTs with Node's RSA implementation.
import * as NodeCrypto from "node:crypto";
import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as ConfigProvider from "effect/ConfigProvider";
import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import { RequestAccount } from "../auth/RequestAccount.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Registry from "./ProviderInstanceRegistry.ts";
import * as Subscriptions from "./ProviderSubscriptions.ts";

const instanceId = ProviderInstanceId.make("codex_personal");
const reset = "2030-01-07T12:00:00Z";
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  status: "ready",
  version: null,
  auth: { status: "authenticated", email: "alice@example.com" },
  checkedAt: "2030-01-01T12:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  usageLimits: {
    checkedAt: "2030-01-01T12:00:00Z",
    windows: [
      {
        id: "session",
        kind: "session",
        label: "Session",
        usedPercent: 0,
        resetsAt: "2030-01-01T17:00:00Z",
      },
      { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 0, resetsAt: reset },
    ],
  },
};

const layerSettings = ServerSettings.layerTest();
const layerFor = (snapshot = provider) =>
  Subscriptions.layer.pipe(
    Layer.provideMerge(layerSettings),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Registry.ProviderInstanceRegistry)({
          getInstance: (id) =>
            Effect.succeed(
              id === instanceId
                ? ({
                    snapshot: { getSnapshot: Effect.succeed(snapshot) },
                  } as unknown as ProviderInstance)
                : undefined,
            ),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected network request")),
        ),
      ),
    ),
  );

it.effect(
  "keeps claims private, shares to a fixed weekly reset and permits only its owner to revoke",
  () =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions.ProviderSubscriptions;
      const settings = yield* ServerSettings.ServerSettingsService;
      const change = (
        userId: string | null,
        action: "claim" | "share" | "revoke",
        expiresAt?: string,
      ) =>
        subscriptions
          .updateSettings({
            patch: {},
            providerSubscriptionMutation: {
              instanceId,
              action,
              ...(expiresAt === undefined ? {} : { expiresAt }),
            },
          })
          .pipe(Effect.provideService(RequestAccount, { userId }));
      yield* change("alice", "claim");
      const staleClaim = yield* settings
        .setProviderSubscription(instanceId, { ownerUserId: "bob", sharedUntil: null }, null)
        .pipe(Effect.flip);
      expect(staleClaim._tag).toBe("ServerSettingsError");

      expect((yield* settings.getSettings).providerSubscriptions[instanceId]).toEqual({
        ownerUserId: "alice",
        sharedUntil: null,
      });
      expect((yield* change("bob", "claim").pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      expect((yield* change(null, "share").pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      yield* change("alice", "share", "2031-01-01T00:00:00Z");
      expect((yield* settings.getSettings).providerSubscriptions[instanceId]?.sharedUntil).toBe(
        reset,
      );
      expect((yield* change("bob", "revoke").pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      expect(
        (yield* subscriptions
          .assertManage(instanceId)
          .pipe(Effect.provideService(RequestAccount, { userId: "bob" }), Effect.flip))._tag,
      ).toBe("EnvironmentAuthorizationError");
      yield* change("alice", "revoke");
      expect(
        (yield* settings.getSettings).providerSubscriptions[instanceId]?.sharedUntil,
      ).toBeNull();
      yield* change("alice", "share");
      yield* subscriptions
        .revokeForAuthentication(instanceId)
        .pipe(Effect.provideService(RequestAccount, { userId: "alice" }));
      expect(
        (yield* settings.getSettings).providerSubscriptions[instanceId]?.sharedUntil,
      ).toBeNull();
    }).pipe(Effect.provide(layerFor())),
);

it.effect(
  "verifies the signed account and rejects forged, expired, wrong-issuer and wrong-audience tokens",
  () =>
    Effect.gen(function* () {
      const pair = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const forged = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const publicJwk = {
        ...pair.publicKey.export({ format: "jwk" }),
        kid: "test",
        alg: "RS256",
        use: "sig",
      };
      const sign = (claims: Record<string, string | number>, key = pair.privateKey) => {
        const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const body = `${encode({ alg: "RS256", kid: "test" })}.${encode(claims)}`;
        return `${body}.${NodeCrypto.sign("sha256", Buffer.from(body), key).toString("base64url")}`;
      };
      const claims = {
        sub: "alice",
        iss: "https://clerk.example.com",
        aud: "t3-code-relay",
        iat: -1,
        exp: 3600,
      };
      const http = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ keys: [publicJwk] }))),
      );
      const testLayer = Subscriptions.layer.pipe(
        Layer.provide(ServerSettings.layerTest()),
        Layer.provide(Layer.mock(Registry.ProviderInstanceRegistry)({})),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
        Layer.provide(NodePlatformCrypto.layer),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("clerk.example.com$").toString("base64")}`,
              T3CODE_CLERK_JWT_AUDIENCE: "t3-code-relay",
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const subscriptions = yield* Subscriptions.ProviderSubscriptions;
        expect(yield* subscriptions.authenticate(sign(claims))).toBe("alice");
        for (const token of [
          sign({ ...claims, iss: "https://attacker.example.com" }),
          sign({ ...claims, aud: "other-app" }),
          sign({ ...claims, exp: -1 }),
          sign(claims, forged.privateKey),
        ]) {
          expect((yield* subscriptions.authenticate(token).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
        }
      }).pipe(Effect.provide(testLayer));
    }),
);

it.effect("requires an explicit expiry when no weekly reset is reported", () =>
  Effect.gen(function* () {
    const subscriptions = yield* Subscriptions.ProviderSubscriptions;
    const settings = yield* ServerSettings.ServerSettingsService;
    const change = (action: "claim" | "share", expiresAt?: string) =>
      subscriptions.updateSettings({
        patch: {},
        providerSubscriptionMutation: {
          instanceId,
          action,
          ...(expiresAt === undefined ? {} : { expiresAt }),
        },
      });
    yield* change("claim");
    expect((yield* change("share").pipe(Effect.flip))._tag).toBe("EnvironmentAuthorizationError");
    expect((yield* change("share", "1970-01-01T00:00:00Z").pipe(Effect.flip))._tag).toBe(
      "EnvironmentAuthorizationError",
    );
    yield* change("share", reset);
    expect((yield* settings.getSettings).providerSubscriptions[instanceId]?.sharedUntil).toBe(
      reset,
    );
  }).pipe(
    Effect.provideService(RequestAccount, { userId: "alice" }),
    Effect.provide(
      layerFor({ ...provider, usageLimits: { checkedAt: provider.checkedAt, windows: [] } }),
    ),
  ),
);
