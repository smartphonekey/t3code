// @effect-diagnostics-next-line nodeBuiltinImport:off -- JWT test fixtures
import * as NodeCrypto from "node:crypto";

import * as NodePlatformCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HttpClient from "effect/http/HttpClient";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Jwks from "effect/jose/Jwks";

import {
  cloudflareAccessIdentityKey,
  generateCloudflareAccessTestJwt,
  isHumanCloudflareAccessIdentity,
  verifyCloudflareAccessJwt,
  type CloudflareAccessJwtClaims,
} from "./CloudflareAccessJwt.ts";

const TEAM = "example.cloudflareaccess.com";
const AUD = "test-application-aud";
const SUB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const testKeyMaterial = Effect.sync(() => {
  const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-kid";
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const jwks = {
    keys: [{ ...publicJwk, kid, use: "sig", alg: "RS256" }],
  };
  return { privatePem, kid, jwks };
});

const humanClaims = {
  sub: SUB,
  aud: AUD,
  exp: 4_102_444_800,
  email: "person@example.com",
} satisfies CloudflareAccessJwtClaims;

it("rejects service-token shaped Cloudflare Access identities", () => {
  expect(isHumanCloudflareAccessIdentity({ ...humanClaims, common_name: "machine" })).toBe(false);
  expect(isHumanCloudflareAccessIdentity({ ...humanClaims, service_token_id: "svc-1" })).toBe(
    false,
  );
  expect(isHumanCloudflareAccessIdentity({ ...humanClaims, type: "service_token" })).toBe(false);
  expect(isHumanCloudflareAccessIdentity({ ...humanClaims, type: "non_identity" })).toBe(false);
  for (const extra of [
    { type: "app", sub: "", common_name: "service.access" },
    { type: "service-token" },
    { gateway_token_id: "gateway" },
    { auth_status: "non_identity" },
    { auth_status: "none" },
  ])
    expect(isHumanCloudflareAccessIdentity({ ...humanClaims, ...extra })).toBe(false);
  expect(isHumanCloudflareAccessIdentity(humanClaims)).toBe(true);
  expect(
    isHumanCloudflareAccessIdentity({
      ...humanClaims,
      type: "app",
      identity_nonce: "human-identity",
    }),
  ).toBe(true);
});

const layerHttpClient = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() =>
    Effect.die(new Error("Unexpected HttpClient request in CloudflareAccessJwt test")),
  ),
);

it.layer(Layer.mergeAll(NodeServices.layer, NodePlatformCrypto.layer, layerHttpClient))(
  "verifyCloudflareAccessJwt",
  (it) => {
    it.effect("verifies a human Access JWT when JWKS and AUD match", () =>
      Effect.gen(function* () {
        const { privatePem, kid, jwks } = yield* testKeyMaterial;
        const token = generateCloudflareAccessTestJwt({
          privateKeyPem: privatePem,
          kid,
          teamDomain: TEAM,
          aud: AUD,
          sub: SUB,
          email: "person@example.com",
          type: "app",
        });
        const claims = yield* verifyCloudflareAccessJwt({
          token,
          teamDomain: TEAM,
          applicationAud: AUD,
          fixedJwks: jwks as unknown as Jwks.KeySet,
        });
        expect(cloudflareAccessIdentityKey(claims)).toBe(`cf-access:${SUB}`);
      }),
    );

    it.effect("rejects a wrong audience, issuer, or signing key", () =>
      Effect.gen(function* () {
        const { privatePem, kid, jwks } = yield* testKeyMaterial;
        const other = yield* testKeyMaterial;
        for (const input of [
          { teamDomain: TEAM, aud: "other-aud", keys: jwks },
          { teamDomain: "other.cloudflareaccess.com", aud: AUD, keys: jwks },
          { teamDomain: TEAM, aud: AUD, keys: other.jwks },
        ]) {
          const token = generateCloudflareAccessTestJwt({
            privateKeyPem: privatePem,
            kid,
            teamDomain: input.teamDomain,
            aud: input.aud,
            sub: SUB,
          });
          const error = yield* verifyCloudflareAccessJwt({
            token,
            teamDomain: TEAM,
            applicationAud: AUD,
            fixedJwks: input.keys as unknown as Jwks.KeySet,
          }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(Error);
        }
      }),
    );
  },
);
