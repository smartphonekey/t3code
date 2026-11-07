// @effect-diagnostics-next-line nodeBuiltinImport:off -- JWT test fixtures
import * as NodeCrypto from "node:crypto";

import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerConfig from "../config.ts";
import * as SessionStore from "./SessionStore.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as CloudflareAccessIdentityPairing from "./CloudflareAccessIdentityPairing.ts";
import { CF_ACCESS_JWT_HEADER, generateCloudflareAccessTestJwt } from "./CloudflareAccessJwt.ts";

const TEAM = "example.cloudflareaccess.com";
const AUD = "pairing-test-aud";
const SUB = "user-1111-2222-3333-4444";

const { privatePem, kid, jwks } = (() => {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "pairing-test-kid";
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  return {
    privatePem: pem,
    kid: keyId,
    jwks: {
      keys: [{ ...publicJwk, kid: keyId, use: "sig", alg: "RS256" }],
    },
  };
})();

const makeAccessRequest = (token: string | null) =>
  ({
    cookies: {},
    headers: token ? { [CF_ACCESS_JWT_HEADER]: token } : {},
  }) as Parameters<
    CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing["Service"]["resumeBrowserSession"]
  >[0];

const layerHttpClient = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() =>
    Effect.die(new Error("Unexpected HttpClient request in CloudflareAccessIdentityPairing test")),
  ),
);

const layerBase = (enabled: boolean) =>
  CloudflareAccessIdentityPairing.layer.pipe(
    Layer.provideMerge(SessionStore.layer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(ServerEnvironment.layerIdentity),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-cf-access-revoke-test-" })),
    Layer.provide(
      ServerSettings.layerTest({
        enableCloudflareAccessIdentityPairing: enabled,
        cloudflareAccessTeamDomain: TEAM,
        cloudflareAccessApplicationAud: AUD,
      }),
    ),
  );

const layerTestJwks = Layer.succeed(CloudflareAccessIdentityPairing.CloudflareAccessJwtTestJwks, {
  keys: jwks as unknown as import("effect/jose/Jwks").KeySet,
});

const signedHumanToken = generateCloudflareAccessTestJwt({
  privateKeyPem: privatePem,
  kid,
  teamDomain: TEAM,
  aud: AUD,
  sub: SUB,
  email: "human@example.com",
});

const serviceToken = generateCloudflareAccessTestJwt({
  privateKeyPem: privatePem,
  kid,
  teamDomain: TEAM,
  aud: AUD,
  sub: "service-subject",
  common_name: "ci-bot",
});

it.layer(
  Layer.mergeAll(NodeServices.layer, NodePlatformCrypto.layer, layerHttpClient, layerTestJwks),
)("CloudflareAccessIdentityPairing", (it) => {
  it.effect("ignores Access headers when the feature toggle is off", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const resumed = yield* pairing.resumeBrowserSession(makeAccessRequest(signedHumanToken), {
        deviceType: "desktop",
      });
      expect(Option.isNone(resumed)).toBe(true);
    }).pipe(Effect.provide(layerBase(false))),
  );

  it.effect("rejects unverified and service-token identities when enabled", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const badResume = yield* pairing.resumeBrowserSession(makeAccessRequest("not.a.jwt"), {
        deviceType: "desktop",
      });
      expect(Option.isNone(badResume)).toBe(true);
      const serviceResume = yield* pairing.resumeBrowserSession(makeAccessRequest(serviceToken), {
        deviceType: "desktop",
      });
      expect(Option.isNone(serviceResume)).toBe(true);
    }).pipe(Effect.provide(layerBase(true))),
  );

  it.effect("requires pairing before resuming an unknown Access identity", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const resumed = yield* pairing.resumeBrowserSession(makeAccessRequest(signedHumanToken), {
        deviceType: "desktop",
      });
      expect(Option.isNone(resumed)).toBe(true);
    }).pipe(Effect.provide(layerBase(true))),
  );

  it.effect("resumes a browser session after pairing recorded the Access identity", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const sessions = yield* SessionStore.SessionStore;
      const request = makeAccessRequest(signedHumanToken);
      const first = yield* sessions.issue({
        method: "browser-session-cookie",
        subject: "paired-browser",
        scopes: ["orchestration:read"],
        client: { deviceType: "desktop" },
      });
      yield* pairing.recordPairing(request, first.sessionId);
      const resumed = yield* pairing.resumeBrowserSession(request, { deviceType: "mobile" });
      expect(Option.isSome(resumed)).toBe(true);
      if (Option.isSome(resumed)) {
        expect(resumed.value.response.authenticated).toBe(true);
        expect(resumed.value.response.scopes).toEqual(["orchestration:read"]);
        expect((yield* sessions.verify(resumed.value.sessionToken)).subject).toBe("paired-browser");
      }
    }).pipe(Effect.provide(layerBase(true))),
  );

  it.effect("identity revoke no-ops when the session is not bound to Cloudflare Access", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const sessions = yield* SessionStore.SessionStore;
      const unbound = yield* sessions.issue({
        method: "browser-session-cookie",
        subject: "unbound-browser",
        scopes: AuthStandardClientScopes,
        client: { deviceType: "desktop" },
      });
      yield* pairing.revokeCloudflareAccessIdentityForSession(unbound.sessionId);
      const active = yield* sessions.listActive();
      expect(active.some((entry) => entry.sessionId === unbound.sessionId)).toBe(true);
    }).pipe(Effect.provide(layerBase(true))),
  );

  it.effect("persists the Access identity key on the paired session row", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const sessions = yield* SessionStore.SessionStore;
      const authSessions = yield* AuthSessions.AuthSessionRepository;
      const request = makeAccessRequest(signedHumanToken);
      const session = yield* sessions.issue({
        method: "browser-session-cookie",
        subject: "paired-row",
        scopes: AuthStandardClientScopes,
        client: { deviceType: "desktop" },
      });
      yield* authSessions.setCloudflareAccessIdentityKey({
        sessionId: session.sessionId,
        value: `cf-access:${SUB}`,
      });
      yield* pairing.recordPairing(request, session.sessionId);
      const row = yield* authSessions.getById({ sessionId: session.sessionId });
      expect(Option.isSome(row)).toBe(true);
      expect(Option.getOrThrow(row).cloudflareAccessIdentityKey).toBe(`cf-access:${SUB}`);
    }).pipe(Effect.provide(layerBase(true))),
  );

  it.effect("dropping the Access identity revokes bound browsers and blocks resume", () =>
    Effect.gen(function* () {
      const pairing = yield* CloudflareAccessIdentityPairing.CloudflareAccessIdentityPairing;
      const sessions = yield* SessionStore.SessionStore;
      const request = makeAccessRequest(signedHumanToken);
      const first = yield* sessions.issue({
        method: "browser-session-cookie",
        subject: "browser-a",
        scopes: AuthStandardClientScopes,
        client: { deviceType: "desktop" },
      });
      yield* pairing.recordPairing(request, first.sessionId);
      const second = yield* pairing.resumeBrowserSession(request, { deviceType: "mobile" });
      expect(Option.isSome(second)).toBe(true);
      const secondSessionId = (yield* sessions.listActive()).find(
        (entry) => entry.sessionId !== first.sessionId,
      )?.sessionId;
      yield* pairing.revokeCloudflareAccessIdentityForSession(first.sessionId);
      const active = yield* sessions.listActive();
      expect(active.some((entry) => entry.sessionId === first.sessionId)).toBe(false);
      expect(active.some((entry) => entry.sessionId === secondSessionId)).toBe(false);
      const resumed = yield* pairing.resumeBrowserSession(request, { deviceType: "desktop" });
      expect(Option.isNone(resumed)).toBe(true);
    }).pipe(Effect.provide(layerBase(true))),
  );
});
