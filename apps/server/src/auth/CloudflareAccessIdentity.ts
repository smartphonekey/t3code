import type { AuthEnvironmentScope } from "@t3tools/contracts";
import type { ServerSettingsError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { HttpServerRequest } from "effect/http";

import * as AuthCloudflareAccessGrants from "../persistence/AuthCloudflareAccessGrants.ts";
import type { AuthCloudflareAccessGrantRepositoryError } from "../persistence/Errors.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  CloudflareAccessJwtKeyResolver,
  readCloudflareAccessJwtAssertion,
  verifyCloudflareAccessJwt,
  type CloudflareAccessVerifiedIdentity,
  type VerifyCloudflareAccessJwtInput,
} from "./cloudflareAccessJwt.ts";

export interface CloudflareAccessPairingConfig {
  readonly enabled: boolean;
  readonly teamDomain: string;
  readonly audience: string;
}

export interface CloudflareAccessIdentityGrant {
  readonly identity: CloudflareAccessVerifiedIdentity;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly sessionSubject: string;
}

type CloudflareAccessIdentityError = ServerSettingsError | AuthCloudflareAccessGrantRepositoryError;

export class CloudflareAccessIdentity extends Context.Service<
  CloudflareAccessIdentity,
  {
    readonly readConfig: () => Effect.Effect<
      CloudflareAccessPairingConfig,
      CloudflareAccessIdentityError
    >;
    readonly verifyRequestIdentity: (
      request: HttpServerRequest.HttpServerRequest,
      overrides?: Partial<Pick<VerifyCloudflareAccessJwtInput, "resolveKey" | "resolvePublicKey">>,
    ) => Effect.Effect<
      Option.Option<CloudflareAccessVerifiedIdentity>,
      CloudflareAccessIdentityError
    >;
    readonly recordGrantAfterPairing: (input: {
      readonly identity: CloudflareAccessVerifiedIdentity;
      readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
      readonly sessionSubject: string;
    }) => Effect.Effect<void, CloudflareAccessIdentityError>;
    readonly findGrantForRequest: (
      request: HttpServerRequest.HttpServerRequest,
      overrides?: Partial<Pick<VerifyCloudflareAccessJwtInput, "resolveKey" | "resolvePublicKey">>,
    ) => Effect.Effect<Option.Option<CloudflareAccessIdentityGrant>, CloudflareAccessIdentityError>;
  }
>()("t3/auth/CloudflareAccessIdentity") {}

const make = Effect.gen(function* () {
  const grants = yield* AuthCloudflareAccessGrants.AuthCloudflareAccessGrantRepository;

  const readConfig = Effect.fn("CloudflareAccessIdentity.readConfig")(function* () {
    const settingsOption = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
    if (Option.isNone(settingsOption)) {
      return {
        enabled: false,
        teamDomain: "",
        audience: "",
      } satisfies CloudflareAccessPairingConfig;
    }
    const value = yield* settingsOption.value.getSettings;
    return {
      enabled: value.enableCloudflareAccessIdentityPairing,
      teamDomain: value.cloudflareAccessTeamDomain,
      audience: value.cloudflareAccessApplicationAudience,
    } satisfies CloudflareAccessPairingConfig;
  });

  const resolveJwtVerificationMaterial = Effect.fn(
    "CloudflareAccessIdentity.resolveJwtVerificationMaterial",
  )(function* (
    teamDomain: string,
    overrides?: Partial<Pick<VerifyCloudflareAccessJwtInput, "resolveKey" | "resolvePublicKey">>,
  ) {
    if (overrides?.resolvePublicKey) {
      return { resolvePublicKey: overrides.resolvePublicKey } satisfies Partial<
        Pick<VerifyCloudflareAccessJwtInput, "resolvePublicKey">
      >;
    }
    if (overrides?.resolveKey) {
      return { resolveKey: overrides.resolveKey } satisfies Partial<
        Pick<VerifyCloudflareAccessJwtInput, "resolveKey">
      >;
    }
    const resolver = yield* Effect.serviceOption(CloudflareAccessJwtKeyResolver);
    if (Option.isSome(resolver)) {
      const resolved = yield* resolver.value.resolve(teamDomain).pipe(Effect.option);
      if (Option.isSome(resolved)) {
        if (typeof resolved.value === "function") {
          return {
            resolveKey: resolved.value as NonNullable<VerifyCloudflareAccessJwtInput["resolveKey"]>,
          };
        }
        return { resolvePublicKey: resolved.value };
      }
    }
    return {} as const;
  });

  const verifyRequestIdentity = Effect.fn("CloudflareAccessIdentity.verifyRequestIdentity")(
    function* (
      request: HttpServerRequest.HttpServerRequest,
      overrides?: Partial<Pick<VerifyCloudflareAccessJwtInput, "resolveKey" | "resolvePublicKey">>,
    ) {
      const config = yield* readConfig();
      if (!config.enabled) {
        return Option.none();
      }
      const token = readCloudflareAccessJwtAssertion(request.headers);
      if (!token) {
        return Option.none();
      }
      const verification = yield* resolveJwtVerificationMaterial(config.teamDomain, overrides);
      const identity = yield* verifyCloudflareAccessJwt({
        token,
        teamDomain: config.teamDomain,
        audience: config.audience,
        ...(verification.resolvePublicKey
          ? { resolvePublicKey: verification.resolvePublicKey }
          : {}),
        ...(verification.resolveKey ? { resolveKey: verification.resolveKey } : {}),
      }).pipe(Effect.option);
      return identity;
    },
  );

  const recordGrantAfterPairing = Effect.fn("CloudflareAccessIdentity.recordGrantAfterPairing")(
    function* (input: {
      readonly identity: CloudflareAccessVerifiedIdentity;
      readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
      readonly sessionSubject: string;
    }) {
      const config = yield* readConfig();
      if (!config.enabled) {
        return;
      }
      const now = yield* DateTime.now;
      yield* grants.upsert({
        identitySub: input.identity.sub,
        email: input.identity.email ?? null,
        scopes: [...input.scopes],
        sessionSubject: input.sessionSubject,
        pairedAt: DateTime.toUtc(now),
      });
    },
  );

  const findGrantForRequest = Effect.fn("CloudflareAccessIdentity.findGrantForRequest")(function* (
    request: HttpServerRequest.HttpServerRequest,
    overrides?: Partial<Pick<VerifyCloudflareAccessJwtInput, "resolveKey" | "resolvePublicKey">>,
  ) {
    const identityOption = yield* verifyRequestIdentity(request, overrides);
    if (Option.isNone(identityOption)) {
      return Option.none();
    }
    const identity = identityOption.value;
    const stored = yield* grants.findByIdentitySub(identity.sub);
    if (Option.isNone(stored)) {
      return Option.none();
    }
    const seenAt = yield* DateTime.now;
    yield* grants.touchLastSeen(identity.sub, DateTime.formatIso(seenAt));
    return Option.some({
      identity,
      scopes: stored.value.scopes,
      sessionSubject: stored.value.sessionSubject,
    } satisfies CloudflareAccessIdentityGrant);
  });

  return CloudflareAccessIdentity.of({
    readConfig,
    verifyRequestIdentity,
    recordGrantAfterPairing,
    findGrantForRequest,
  });
});

export const layer = Layer.effect(CloudflareAccessIdentity, make).pipe(
  Layer.provideMerge(AuthCloudflareAccessGrants.layer),
);

export const layerTest = (
  overrides?: Parameters<typeof ServerSettings.layerTest>[0],
  settingsLayer = ServerSettings.layerTest(overrides),
) =>
  Layer.effect(CloudflareAccessIdentity, make).pipe(
    Layer.provideMerge(AuthCloudflareAccessGrants.layer),
    Layer.provide(settingsLayer),
  );
