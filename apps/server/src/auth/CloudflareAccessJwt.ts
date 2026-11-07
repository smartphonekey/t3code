// @effect-diagnostics-next-line nodeBuiltinImport:off -- test key generation only
import * as NodeCrypto from "node:crypto";

import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as JoseError from "effect/jose/JoseError";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as Schema from "effect/Schema";

export const CF_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

export class CloudflareAccessJwtVerificationError extends Schema.TaggedError<CloudflareAccessJwtVerificationError>()(
  "CloudflareAccessJwtVerificationError",
  { message: Schema.String },
) {}

export const CloudflareAccessJwtClaims = Schema.Struct({
  sub: Schema.String,
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Number,
  iss: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
  common_name: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  identity_nonce: Schema.optionalKey(Schema.String),
  service_token_id: Schema.optionalKey(Schema.String),
});
export type CloudflareAccessJwtClaims = typeof CloudflareAccessJwtClaims.Type;

const decodeKeySet = Schema.decodeUnknownEffect(Jwks.KeySet);

const failJwtVerification = (message: string) =>
  Effect.fail(new CloudflareAccessJwtVerificationError({ message }));

function normalizeCloudflareAccessTeamDomain(teamDomain: string): string | null {
  const trimmed = teamDomain.trim().replace(/\/+$/u, "");
  if (trimmed.length === 0) return null;
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).host;
    }
  } catch {
    return null;
  }
  return trimmed;
}

function cloudflareAccessJwksUrl(teamDomain: string): string | null {
  const host = normalizeCloudflareAccessTeamDomain(teamDomain);
  return host === null ? null : `https://${host}/cdn-cgi/access/certs`;
}

export const isHumanCloudflareAccessIdentity = (claims: CloudflareAccessJwtClaims): boolean => {
  if (claims.sub.trim().length === 0) return false;
  if (claims.common_name !== undefined && claims.common_name.trim().length > 0) return false;
  if (claims.service_token_id !== undefined && claims.service_token_id.trim().length > 0) {
    return false;
  }
  const type = claims.type?.trim().toLowerCase();
  if (type === "service_token" || type === "non_identity") return false;
  return true;
};

export const cloudflareAccessIdentityKey = (claims: CloudflareAccessJwtClaims): string =>
  `cf-access:${claims.sub}`;

export const readCloudflareAccessJwtHeader = (
  headers: Readonly<Record<string, string | undefined>>,
): string | null => {
  const token = headers[CF_ACCESS_JWT_HEADER]?.trim();
  return token && token.length > 0 ? token : null;
};

export const verifyCloudflareAccessJwt = Effect.fn("verifyCloudflareAccessJwt")(function* (input: {
  readonly token: string;
  readonly teamDomain: string;
  readonly applicationAud: string;
  readonly jwksUrl?: string;
  readonly fixedJwks?: Jwks.KeySet;
}) {
  const http = yield* HttpClient.HttpClient;
  let keySet: { readonly keys: Jwks.KeySet; readonly expiresAt: number } | undefined;

  const fetchKeySet = Effect.gen(function* () {
    if (input.fixedJwks !== undefined) {
      return input.fixedJwks;
    }
    const jwksUri = input.jwksUrl ?? cloudflareAccessJwksUrl(input.teamDomain);
    if (jwksUri === null) {
      return yield* failJwtVerification("Cloudflare Access team domain is not configured.");
    }
    const response = yield* http.execute(HttpClientRequest.get(jwksUri)).pipe(
      Effect.filterOrFail(
        (res) => res.status === 200,
        () =>
          new CloudflareAccessJwtVerificationError({
            message: "Could not fetch Cloudflare Access JWKS.",
          }),
      ),
    );
    const body = yield* response.json;
    const keys = yield* decodeKeySet(body);
    const now = yield* Clock.currentTimeMillis;
    keySet = { keys, expiresAt: now + JWKS_CACHE_TTL_MS };
    return keys;
  });

  const verifyWith = (keys: Jwks.KeySet) =>
    Jwks.makeLocal(keys).pipe(
      Effect.flatMap((jwks) =>
        Jwt.verifyWithKeySet(CloudflareAccessJwtClaims, input.token, {
          algorithms: ["RS256", "ES256"],
          audience: input.applicationAud,
          clockTolerance: "60 seconds",
          requiredClaims: ["exp", "sub", "aud"],
        }).pipe(Effect.provideService(Jwks.Jwks, jwks)),
      ),
      Effect.flatMap((verified) => {
        const claims = { ...verified.registeredClaims, ...verified.claims };
        return isHumanCloudflareAccessIdentity(claims)
          ? Effect.succeed(claims)
          : failJwtVerification("Cloudflare Access identity is not a human IdP user.");
      }),
    );

  if (input.fixedJwks !== undefined) {
    return yield* verifyWith(input.fixedJwks);
  }

  const now = yield* Clock.currentTimeMillis;
  const keys =
    keySet !== undefined && keySet.expiresAt > now
      ? keySet.keys
      : yield* fetchKeySet.pipe(
          Effect.catch(() =>
            keySet === undefined
              ? failJwtVerification("Could not fetch Cloudflare Access JWKS.")
              : Effect.succeed(keySet.keys),
          ),
        );

  return yield* verifyWith(keys).pipe(
    Effect.catchIf(
      (error) => JoseError.isJoseError(error) && error.reason._tag === "KeyNotFound",
      () => fetchKeySet.pipe(Effect.flatMap(verifyWith)),
    ),
  );
});

/** @internal */
export const generateCloudflareAccessTestJwt = (input: {
  readonly privateKeyPem: string;
  readonly kid: string;
  readonly teamDomain: string;
  readonly aud: string;
  readonly sub: string;
  readonly email?: string;
  readonly common_name?: string;
  readonly type?: string;
  readonly service_token_id?: string;
  readonly exp?: number;
}) => {
  const key = NodeCrypto.createPrivateKey(input.privateKeyPem);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: input.kid })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: input.sub,
      aud: input.aud,
      iss: `https://${input.teamDomain}`,
      exp: input.exp ?? 4_102_444_800, // Test fixtures default to 2100-01-01.
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.common_name !== undefined ? { common_name: input.common_name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.service_token_id !== undefined ? { service_token_id: input.service_token_id } : {}),
    }),
  ).toString("base64url");
  const signature = NodeCrypto.sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    key,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
};
