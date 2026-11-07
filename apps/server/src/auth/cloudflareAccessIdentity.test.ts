import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authScopeResponse, AuthStandardClientScopes } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CloudflareAccessIdentity from "./CloudflareAccessIdentity.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import {
  CLOUDFLARE_ACCESS_JWT_HEADER,
  CloudflareAccessJwtKeyResolver,
  isHumanCloudflareAccessIdentity,
  verifyCloudflareAccessJwt,
  type VerifyCloudflareAccessJwtInput,
} from "./cloudflareAccessJwt.ts";

type TestJwtPublicKey = NonNullable<VerifyCloudflareAccessJwtInput["resolvePublicKey"]>;

const TEAM = "acme.cloudflareaccess.com";
const AUD = "test-app-audience";

let testJwtPublicKey: TestJwtPublicKey | undefined;

const layerTestJwtResolver = Layer.succeed(CloudflareAccessJwtKeyResolver, {
  resolve: () => Effect.sync(() => testJwtPublicKey),
});

const enabledCloudflareAccessSettings = {
  enableCloudflareAccessIdentityPairing: true,
  cloudflareAccessTeamDomain: TEAM,
  cloudflareAccessApplicationAudience: AUD,
} as const;

const layerEnabled = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(ServerSettings.layerTest(enabledCloudflareAccessSettings)),
  Layer.provideMerge(CloudflareAccessIdentity.layerTest(enabledCloudflareAccessSettings)),
  Layer.provideMerge(layerTestJwtResolver),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-cf-access-auth-test-" })),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const layerDisabled = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(
    ServerSettings.layerTest({
      enableCloudflareAccessIdentityPairing: false,
      cloudflareAccessTeamDomain: TEAM,
      cloudflareAccessApplicationAudience: AUD,
    }),
  ),
  Layer.provideMerge(
    CloudflareAccessIdentity.layerTest({
      enableCloudflareAccessIdentityPairing: false,
      cloudflareAccessTeamDomain: TEAM,
      cloudflareAccessApplicationAudience: AUD,
    }),
  ),
  Layer.provide(ManagedPolicy.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerEnvironment.layerIdentity),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-cf-access-auth-test-off-" })),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const layerCfOnly = CloudflareAccessIdentity.layerTest({
  enableCloudflareAccessIdentityPairing: true,
  cloudflareAccessTeamDomain: TEAM,
  cloudflareAccessApplicationAudience: AUD,
}).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const signAccessJwt = (input: {
  readonly sub: string;
  readonly email?: string;
  readonly type?: string;
  readonly serviceTokenId?: string;
  readonly privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
}) =>
  Effect.promise(() =>
    new SignJWT({
      sub: input.sub,
      ...(input.email ? { email: input.email } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.serviceTokenId ? { service_token_id: input.serviceTokenId } : {}),
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(input.privateKey),
  );

const makeJwtFixture = Effect.fnUntraced(function* () {
  const { privateKey, publicKey } = yield* Effect.promise(() =>
    generateKeyPair("ES256", { extractable: true }),
  );
  const jwk = yield* Effect.promise(() => exportJWK(publicKey));
  const resolveJwtKey = yield* Effect.promise(async () => {
    const { importJWK } = await import("jose");
    return importJWK({ ...jwk, alg: "ES256" }, "ES256");
  });
  testJwtPublicKey = resolveJwtKey;
  const tokenFor = (payload: {
    readonly sub: string;
    readonly email?: string;
    readonly type?: string;
    readonly serviceTokenId?: string;
  }) => signAccessJwt({ ...payload, privateKey });
  return {
    privateKey,
    resolveJwtKey,
    tokenFor,
    headersFor: (token: string, extra?: Record<string, string>) => ({
      [CLOUDFLARE_ACCESS_JWT_HEADER]: token,
      ...extra,
    }),
    verify: (token: string) =>
      verifyCloudflareAccessJwt({
        token,
        teamDomain: TEAM,
        audience: AUD,
        resolvePublicKey: resolveJwtKey,
      }).pipe(Effect.orDie),
  };
});

const requestMetadata = {
  deviceType: "desktop" as const,
  browser: "Chrome",
  os: "macOS",
  ipAddress: "10.0.0.5",
};

const makeRequest = (
  headers: Record<string, string | undefined>,
  cookies: Record<string, string> = {},
) =>
  ({
    cookies,
    headers,
  }) as unknown as Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["getSessionState"]>[0];

it.effect("toggle off ignores Cloudflare Access headers", () =>
  Effect.gen(function* () {
    const fixture = yield* makeJwtFixture();
    const token = yield* fixture.tokenFor({ sub: "user-1", email: "user@example.com" });
    const cf = yield* CloudflareAccessIdentity.CloudflareAccessIdentity.pipe(
      Effect.provide(
        CloudflareAccessIdentity.layerTest({
          enableCloudflareAccessIdentityPairing: false,
          cloudflareAccessTeamDomain: TEAM,
          cloudflareAccessApplicationAudience: AUD,
        }).pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
      ),
    );
    const identity = yield* cf.verifyRequestIdentity(makeRequest(fixture.headersFor(token)), {
      resolvePublicKey: fixture.resolveJwtKey,
    });
    expect(Option.isNone(identity)).toBe(true);
  }),
);

it.effect("toggle on rejects service-token identities", () =>
  Effect.gen(function* () {
    const fixture = yield* makeJwtFixture();
    const token = yield* fixture.tokenFor({ sub: "svc-1", type: "app" });
    const cf = yield* CloudflareAccessIdentity.CloudflareAccessIdentity.pipe(
      Effect.provide(layerCfOnly),
    );
    const identity = yield* cf.verifyRequestIdentity(makeRequest(fixture.headersFor(token)), {
      resolvePublicKey: fixture.resolveJwtKey,
    });
    expect(Option.isNone(identity)).toBe(true);
  }).pipe(Effect.provide(layerCfOnly)),
);

it.effect("toggle on ignores forged email headers without a verified JWT", () =>
  Effect.gen(function* () {
    const cf = yield* CloudflareAccessIdentity.CloudflareAccessIdentity.pipe(
      Effect.provide(layerCfOnly),
    );
    const identity = yield* cf.verifyRequestIdentity(
      makeRequest({ "cf-access-authenticated-user-email": "fake@example.com" }),
    );
    expect(Option.isNone(identity)).toBe(true);
  }).pipe(Effect.provide(layerCfOnly)),
);

it.effect("toggle on rejects JWTs with the wrong signing key", () =>
  Effect.gen(function* () {
    const fixture = yield* makeJwtFixture();
    const other = yield* makeJwtFixture();
    const token = yield* other.tokenFor({ sub: "human-1", email: "human@example.com" });
    const exit = yield* Effect.exit(fixture.verify(token));
    expect(exit._tag).toBe("Failure");
  }),
);

it.effect("records a grant after pairing and skips pairing on a later browser", () =>
  Effect.gen(function* () {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const fixture = yield* makeJwtFixture();
    const token = yield* fixture.tokenFor({ sub: "human-1", email: "human@example.com" });
    const pairing = yield* serverAuth.issuePairingCredential();
    yield* serverAuth.createBrowserSession(
      pairing.credential,
      requestMetadata,
      makeRequest(fixture.headersFor(token)),
    );
    const laterToken = yield* fixture.tokenFor({ sub: "human-1", email: "human@example.com" });
    const session = yield* serverAuth.establishBrowserSessionFromCloudflareAccessIfGranted(
      makeRequest(fixture.headersFor(laterToken)),
      requestMetadata,
    );
    expect(Option.isSome(session)).toBe(true);
    if (Option.isSome(session)) {
      expect(session.value.response.authenticated).toBe(true);
      expect(session.value.response).toMatchObject(authScopeResponse(AuthStandardClientScopes));
    }
  }).pipe(Effect.provide(layerEnabled)),
);

it.effect("first-time Access identity still requires pairing", () =>
  Effect.gen(function* () {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const fixture = yield* makeJwtFixture();
    const token = yield* fixture.tokenFor({ sub: "new-human", email: "new@example.com" });
    const session = yield* serverAuth.establishBrowserSessionFromCloudflareAccessIfGranted(
      makeRequest(fixture.headersFor(token)),
      requestMetadata,
    );
    expect(Option.isNone(session)).toBe(true);
    const state = yield* serverAuth.getSessionState(makeRequest(fixture.headersFor(token)));
    expect(state.authenticated).toBe(false);
  }).pipe(Effect.provide(layerEnabled)),
);

it.effect("disabled toggle keeps stock pairing behavior", () =>
  Effect.gen(function* () {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const fixture = yield* makeJwtFixture();
    const token = yield* fixture.tokenFor({ sub: "user-off", email: "off@example.com" });
    const pairing = yield* serverAuth.issuePairingCredential();
    yield* serverAuth.createBrowserSession(
      pairing.credential,
      requestMetadata,
      makeRequest(fixture.headersFor(token)),
    );
    const session = yield* serverAuth.establishBrowserSessionFromCloudflareAccessIfGranted(
      makeRequest(fixture.headersFor(token)),
      requestMetadata,
    );
    expect(Option.isNone(session)).toBe(true);
  }).pipe(Effect.provide(layerDisabled)),
);

it("rejects non-human Access JWT payloads", () => {
  expect(isHumanCloudflareAccessIdentity({ sub: "x", type: "app" })).toBe(false);
  expect(isHumanCloudflareAccessIdentity({ sub: "x", service_token_id: "1" })).toBe(false);
  expect(isHumanCloudflareAccessIdentity({ sub: "human", email: "a@b.com" })).toBe(true);
});
