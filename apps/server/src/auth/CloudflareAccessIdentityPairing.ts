import {
  type AuthBrowserSessionResult,
  type AuthClientMetadata,
  type AuthSessionId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { authScopeResponse } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Jwks from "effect/jose/Jwks";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Signature from "effect/crypto/Signature";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as AuthCloudflareAccessIdentities from "../persistence/AuthCloudflareAccessIdentities.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SessionStore from "./SessionStore.ts";
import {
  cloudflareAccessIdentityKey,
  readCloudflareAccessJwtHeader,
  verifyCloudflareAccessJwt,
} from "./CloudflareAccessJwt.ts";

export interface CloudflareAccessIdentityPairingConfig {
  readonly enabled: boolean;
  readonly teamDomain: string;
  readonly applicationAud: string;
}

export interface CloudflareAccessBrowserSessionBootstrap {
  readonly response: AuthBrowserSessionResult;
  readonly sessionToken: string;
}

/** @internal Overrides JWKS fetch during tests. */
export const CloudflareAccessJwtTestJwks = Context.Reference<
  { readonly keys: Jwks.KeySet } | undefined
>("t3/test/CloudflareAccessJwtTestJwks", {
  defaultValue: () => undefined,
});

export class CloudflareAccessPairingError extends Schema.TaggedError<CloudflareAccessPairingError>()(
  "CloudflareAccessPairingError",
  { cause: Schema.Defect() },
) {}

const mapPairingError = Effect.mapError(
  (cause: unknown) => new CloudflareAccessPairingError({ cause }),
);

export class CloudflareAccessIdentityPairing extends Context.Service<
  CloudflareAccessIdentityPairing,
  {
    readonly readConfig: () => Effect.Effect<
      CloudflareAccessIdentityPairingConfig,
      CloudflareAccessPairingError
    >;
    readonly verifyRequestIdentity: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<
      Option.Option<{
        readonly identityKey: string;
        readonly subject: string;
        readonly email?: string;
      }>,
      CloudflareAccessPairingError
    >;
    readonly recordPairing: (
      request: HttpServerRequest.HttpServerRequest,
      sessionId: AuthSessionId,
    ) => Effect.Effect<void, CloudflareAccessPairingError>;
    readonly getSessionOwnerUserId: (
      request: HttpServerRequest.HttpServerRequest,
      sessionId: AuthSessionId,
    ) => Effect.Effect<string | null, CloudflareAccessPairingError>;
    readonly resumeBrowserSession: (
      request: HttpServerRequest.HttpServerRequest,
      client: AuthClientMetadata,
    ) => Effect.Effect<
      Option.Option<CloudflareAccessBrowserSessionBootstrap>,
      CloudflareAccessPairingError
    >;
    readonly sessionHasStoredCloudflareAccessIdentity: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<boolean, CloudflareAccessPairingError>;
    readonly revokeCloudflareAccessIdentityForSession: (
      sessionId: AuthSessionId,
    ) => Effect.Effect<void, CloudflareAccessPairingError>;
  }
>()("t3/auth/CloudflareAccessIdentityPairing") {}

const emptyConfig = (): CloudflareAccessIdentityPairingConfig => ({
  enabled: false,
  teamDomain: "",
  applicationAud: "",
});

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const http = yield* HttpClient.HttpClient;
  const signature = yield* Signature.Signature;
  const sessions = yield* SessionStore.SessionStore;
  const authSessions = yield* AuthSessions.AuthSessionRepository;
  const identities = yield* AuthCloudflareAccessIdentities.AuthCloudflareAccessIdentityRepository;

  const readConfig: CloudflareAccessIdentityPairing["Service"]["readConfig"] = Effect.fn(
    "CloudflareAccessIdentityPairing.readConfig",
  )(function* () {
    const current = yield* settings.getSettings;
    const teamDomain = current.cloudflareAccessTeamDomain.trim();
    const applicationAud = current.cloudflareAccessApplicationAud.trim();
    if (!current.enableCloudflareAccessIdentityPairing) {
      return emptyConfig();
    }
    if (teamDomain.length === 0 || applicationAud.length === 0) {
      return { enabled: false, teamDomain, applicationAud };
    }
    return { enabled: true, teamDomain, applicationAud };
  }, mapPairingError);

  const verifyRequestIdentity: CloudflareAccessIdentityPairing["Service"]["verifyRequestIdentity"] =
    Effect.fn("CloudflareAccessIdentityPairing.verifyRequestIdentity")(function* (request) {
      const config = yield* readConfig();
      if (!config.enabled) {
        return Option.none();
      }
      const token = readCloudflareAccessJwtHeader(request.headers);
      if (token === null) {
        return Option.none();
      }
      const testJwks = yield* CloudflareAccessJwtTestJwks;
      const claims = yield* verifyCloudflareAccessJwt({
        token,
        teamDomain: config.teamDomain,
        applicationAud: config.applicationAud,
        ...(testJwks !== undefined ? { fixedJwks: testJwks.keys } : {}),
      }).pipe(
        Effect.option,
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(Signature.Signature, signature),
      );
      if (Option.isNone(claims)) {
        return Option.none();
      }
      return Option.some({
        identityKey: cloudflareAccessIdentityKey(claims.value),
        subject: claims.value.sub,
        ...(claims.value.email !== undefined ? { email: claims.value.email } : {}),
      });
    }, mapPairingError);

  const bindSessionToIdentity = (sessionId: AuthSessionId, identityKey: string) =>
    authSessions.setCloudflareAccessIdentityKey({
      sessionId,
      value: identityKey,
    });

  const getSessionOwnerUserId = Effect.fn("CloudflareAccessIdentityPairing.getSessionOwnerUserId")(
    function* (request: HttpServerRequest.HttpServerRequest, sessionId: AuthSessionId) {
      const config = yield* readConfig();
      if (!config.enabled) return null;
      if (readCloudflareAccessJwtHeader(request.headers) !== null) {
        return Option.getOrNull(
          Option.map(yield* verifyRequestIdentity(request), (identity) => identity.identityKey),
        );
      }
      const session = yield* authSessions.getById({ sessionId });
      return Option.isSome(session) ? (session.value.cloudflareAccessIdentityKey ?? null) : null;
    },
    mapPairingError,
  );

  const recordPairing: CloudflareAccessIdentityPairing["Service"]["recordPairing"] = Effect.fn(
    "CloudflareAccessIdentityPairing.recordPairing",
  )(function* (request, sessionId) {
    const identity = yield* verifyRequestIdentity(request);
    if (Option.isNone(identity)) {
      return;
    }
    const pairedSession = yield* authSessions.getById({ sessionId });
    if (Option.isNone(pairedSession)) return;
    const pairedAt = DateTime.toUtc(yield* DateTime.now);
    yield* identities.upsert({
      identityKey: identity.value.identityKey,
      subject: identity.value.subject,
      email: identity.value.email ?? null,
      pairedAt,
      scopes: pairedSession.value.scopes,
      sessionSubject: pairedSession.value.subject,
    });
    yield* bindSessionToIdentity(sessionId, identity.value.identityKey);
  }, mapPairingError);

  const resumeBrowserSession: CloudflareAccessIdentityPairing["Service"]["resumeBrowserSession"] =
    Effect.fn("CloudflareAccessIdentityPairing.resumeBrowserSession")(function* (request, client) {
      const identity = yield* verifyRequestIdentity(request);
      if (Option.isNone(identity)) {
        return Option.none();
      }
      const existing = yield* identities.getByIdentityKey({ key: identity.value.identityKey });
      if (Option.isNone(existing) || existing.value.scopes.length === 0) {
        return Option.none();
      }
      const session = yield* sessions.issue({
        method: "browser-session-cookie",
        subject: existing.value.sessionSubject,
        scopes: existing.value.scopes,
        cloudflareAccessIdentityKey: identity.value.identityKey,
        client: {
          ...client,
          ...(identity.value.email ? { label: identity.value.email } : {}),
        },
      });
      return Option.some({
        response: {
          authenticated: true,
          ...authScopeResponse(session.scopes),
          sessionMethod: "browser-session-cookie",
          expiresAt: DateTime.toUtc(session.expiresAt),
        } satisfies AuthBrowserSessionResult,
        sessionToken: session.token,
      });
    }, mapPairingError);

  const sessionHasStoredCloudflareAccessIdentity: CloudflareAccessIdentityPairing["Service"]["sessionHasStoredCloudflareAccessIdentity"] =
    Effect.fn("CloudflareAccessIdentityPairing.sessionHasStoredCloudflareAccessIdentity")(
      function* (sessionId) {
        const config = yield* readConfig();
        if (!config.enabled) {
          return false;
        }
        const row = yield* authSessions.getById({ sessionId });
        if (Option.isNone(row) || row.value.cloudflareAccessIdentityKey == null) {
          return false;
        }
        const stored = yield* identities.getByIdentityKey({
          key: row.value.cloudflareAccessIdentityKey,
        });
        return Option.isSome(stored);
      },
      mapPairingError,
    );

  const revokeCloudflareAccessIdentityForSession: CloudflareAccessIdentityPairing["Service"]["revokeCloudflareAccessIdentityForSession"] =
    Effect.fn("CloudflareAccessIdentityPairing.revokeCloudflareAccessIdentityForSession")(
      function* (sessionId) {
        const config = yield* readConfig();
        if (!config.enabled) {
          return;
        }
        const row = yield* authSessions.getById({ sessionId });
        if (Option.isNone(row) || row.value.cloudflareAccessIdentityKey == null) {
          return;
        }
        const key = row.value.cloudflareAccessIdentityKey;
        const now = yield* DateTime.now;
        const rows = yield* authSessions.listActive({ now, connectedSessionIds: [] });
        const sessionIds = rows
          .filter((row) => row.cloudflareAccessIdentityKey === key)
          .map((row) => row.sessionId);
        yield* Effect.forEach(sessionIds, (revokedSessionId) => sessions.revoke(revokedSessionId), {
          discard: true,
        });
        yield* identities.deleteByIdentityKey({ key });
      },
      mapPairingError,
    );

  return CloudflareAccessIdentityPairing.of({
    readConfig,
    verifyRequestIdentity,
    recordPairing,
    getSessionOwnerUserId,
    resumeBrowserSession,
    sessionHasStoredCloudflareAccessIdentity,
    revokeCloudflareAccessIdentityForSession,
  });
});

export const layer = Layer.effect(CloudflareAccessIdentityPairing, make).pipe(
  Layer.provideMerge(AuthCloudflareAccessIdentities.layer),
  Layer.provideMerge(SessionStore.layer),
);

export const applyCloudflareAccessSessionState = (
  state: AuthSessionState,
  resumed: CloudflareAccessBrowserSessionBootstrap,
): AuthSessionState => ({
  ...resumed.response,
  auth: state.auth,
});
