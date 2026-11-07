import {
  createRemoteJWKSet,
  importJWK,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

type CloudflareAccessJwtStaticVerifyKey = Uint8Array | Awaited<ReturnType<typeof importJWK>>;
type CloudflareAccessJwtVerificationKey = JWTVerifyGetKey | CloudflareAccessJwtStaticVerifyKey;
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const CLOUDFLARE_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export const CloudflareAccessVerifiedIdentity = Schema.Struct({
  sub: Schema.String,
  email: Schema.optional(Schema.String),
});
export type CloudflareAccessVerifiedIdentity = typeof CloudflareAccessVerifiedIdentity.Type;

export class CloudflareAccessJwtVerificationError extends Schema.TaggedError<CloudflareAccessJwtVerificationError>()(
  "CloudflareAccessJwtVerificationError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class CloudflareAccessJwtKeyResolver extends Context.Service<
  CloudflareAccessJwtKeyResolver,
  {
    readonly resolve: (
      teamDomain: string,
    ) => Effect.Effect<CloudflareAccessJwtVerificationKey | undefined>;
  }
>()("t3/auth/cloudflareAccessJwt/CloudflareAccessJwtKeyResolver") {}

const jwksCache = new Map<string, JWTVerifyGetKey>();

const normalizeTeamDomain = (teamDomain: string): string | undefined => {
  const trimmed = teamDomain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : undefined;
};

const cloudflareAccessJwksUrl = (teamDomain: string) => {
  const normalized = normalizeTeamDomain(teamDomain);
  if (!normalized) {
    return undefined;
  }
  return new URL(`https://${normalized}/cdn-cgi/access/certs`);
};

const resolveJwks = (teamDomain: string): JWTVerifyGetKey | undefined => {
  const url = cloudflareAccessJwksUrl(teamDomain);
  if (!url) {
    return undefined;
  }
  const cacheKey = url.toString();
  const existing = jwksCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const created = createRemoteJWKSet(url);
  jwksCache.set(cacheKey, created);
  return created;
};

export const isHumanCloudflareAccessIdentity = (payload: JWTPayload): boolean => {
  const type = typeof payload.type === "string" ? payload.type.toLowerCase() : undefined;
  if (type === "app" || type === "service-token" || type === "service_token") {
    return false;
  }
  if (payload.service_token_id !== undefined || payload.gateway_token_id !== undefined) {
    return false;
  }
  const authStatus =
    typeof payload.auth_status === "string" ? payload.auth_status.toLowerCase() : undefined;
  if (authStatus === "none" || authStatus === "non_identity") {
    return false;
  }
  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    return false;
  }
  return true;
};

export const readCloudflareAccessJwtAssertion = (
  headers: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const token = headers[CLOUDFLARE_ACCESS_JWT_HEADER];
  if (typeof token !== "string") {
    return undefined;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export interface VerifyCloudflareAccessJwtInput {
  readonly token: string;
  readonly teamDomain: string;
  readonly audience: string;
  readonly resolveKey?: JWTVerifyGetKey;
  readonly resolvePublicKey?: CloudflareAccessJwtVerificationKey;
}

export const verifyCloudflareAccessJwt = Effect.fn("cloudflareAccessJwt.verifyCloudflareAccessJwt")(
  function* (input: VerifyCloudflareAccessJwtInput) {
    const team = normalizeTeamDomain(input.teamDomain);
    if (!team) {
      return yield* new CloudflareAccessJwtVerificationError({
        reason: "Cloudflare Access team domain is not configured.",
      });
    }
    const audience = input.audience.trim();
    if (audience.length === 0) {
      return yield* new CloudflareAccessJwtVerificationError({
        reason: "Cloudflare Access application audience is not configured.",
      });
    }
    const verificationKey = input.resolvePublicKey ?? input.resolveKey ?? resolveJwks(team);
    if (!verificationKey) {
      return yield* new CloudflareAccessJwtVerificationError({
        reason: "Could not resolve Cloudflare Access JWKS.",
      });
    }
    const issuer = `https://${team}`;
    const verifyOptions = { issuer, audience };
    const { payload } = yield* Effect.tryPromise({
      try: () =>
        typeof verificationKey === "function"
          ? jwtVerify(input.token, verificationKey, verifyOptions)
          : jwtVerify(input.token, verificationKey, verifyOptions),
      catch: (cause) =>
        new CloudflareAccessJwtVerificationError({
          reason: "Cloudflare Access JWT verification failed.",
          ...(cause === undefined ? {} : { cause }),
        }),
    });
    if (!isHumanCloudflareAccessIdentity(payload)) {
      return yield* new CloudflareAccessJwtVerificationError({
        reason: "Cloudflare Access identity is not an allowed human IdP user.",
      });
    }
    const sub = payload.sub!.trim();
    const email =
      typeof payload.email === "string" && payload.email.trim().length > 0
        ? payload.email.trim()
        : undefined;
    return { sub, ...(email ? { email } : {}) } satisfies CloudflareAccessVerifiedIdentity;
  },
);
