import {
  AuthProvidersManageScope,
  EnvironmentAuthorizationError,
  nextWeeklySubscriptionReset,
  type ProviderInstanceId,
  type ProviderInstanceMutation,
  type ProviderSubscriptionMutation,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";
import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as Signature from "effect/crypto/Signature";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";
import { cloudAccountPublishableKey } from "../cloud/publicConfig.ts";
import { RequestAccount } from "../auth/RequestAccount.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";

const denied = (message: string) =>
  new EnvironmentAuthorizationError({ message, requiredScope: AuthProvidersManageScope });
const AccountClaims = Schema.Struct({ sub: Schema.NonEmptyString });

export class ProviderSubscriptions extends Context.Service<
  ProviderSubscriptions,
  {
    readonly authenticate: (token: string) => Effect.Effect<string, EnvironmentAuthorizationError>;
    readonly assertManage: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<void, EnvironmentAuthorizationError>;
    readonly revokeForAuthentication: (
      instanceId: ProviderInstanceId,
    ) => Effect.Effect<void, EnvironmentAuthorizationError>;
    readonly updateSettings: (input: {
      patch: ServerSettingsPatch;
      providerInstanceMutation?: ProviderInstanceMutation;
      providerSubscriptionMutation?: ProviderSubscriptionMutation;
    }) => Effect.Effect<
      import("@t3tools/contracts").ServerSettings,
      EnvironmentAuthorizationError | import("@t3tools/contracts").ServerSettingsError
    >;
  }
>()("t3/provider/ProviderSubscriptions") {}

export const layer = Layer.effect(
  ProviderSubscriptions,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const http = yield* Effect.serviceOption(HttpClient.HttpClient);
    const signature = yield* Effect.serviceOption(Signature.Signature);
    const publishableKey = yield* cloudAccountPublishableKey.pipe(Effect.option);
    const audience = yield* Config.String("T3CODE_CLERK_JWT_AUDIENCE").pipe(
      Config.withDefault("t3-code-relay"),
    );
    const writes = yield* Semaphore.make(1);
    const keySets = yield* Cache.make({
      capacity: 1,
      timeToLive: "10 minutes",
      lookup: Effect.fn("ProviderSubscriptions.fetchAccountKeys")(function* (issuer: string) {
        if (Option.isNone(http)) return yield* denied("Account verification is unavailable.");
        const response = yield* http.value.get(`${issuer}/.well-known/jwks.json`);
        if (response.status !== 200)
          return yield* denied("Could not verify your T3 Connect account.");
        return yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Jwks.KeySet)));
      }, Effect.timeout("5 seconds")),
    });
    const authenticate = Effect.fn("ProviderSubscriptions.authenticate")(
      function* (token: string) {
        if (Option.isNone(publishableKey))
          return yield* denied(
            "T3 Connect identity verification is not configured on this server.",
          );
        const issuer = yield* Effect.try({
          try: () =>
            clerkFrontendApiUrlFromPublishableKey(publishableKey.value).replace(/\/+$/u, ""),
          catch: () => denied("Invalid T3 Connect configuration."),
        });
        if (Option.isNone(signature)) return yield* denied("Account verification is unavailable.");
        const verify = Effect.gen(function* () {
          const keys = yield* Cache.get(keySets, issuer);
          const jwks = yield* Jwks.makeLocal(keys);
          const result = yield* Jwt.verifyWithKeySet(AccountClaims, token, {
            issuer,
            audience,
            algorithms: ["RS256"],
            requiredClaims: ["exp", "iat"],
          }).pipe(
            Effect.provideService(Jwks.Jwks, jwks),
            Effect.provideService(Signature.Signature, signature.value),
          );
          return result.claims.sub;
        });
        return yield* verify;
      },
      Effect.mapError(() =>
        denied("Your T3 Connect account could not be verified. Sign in again."),
      ),
    );
    const assertManage = Effect.fn("ProviderSubscriptions.assertManage")(
      function* (instanceId: ProviderInstanceId) {
        const account = yield* RequestAccount;
        const subscription = (yield* settings.getSettings).providerSubscriptions[instanceId];
        if (
          account !== undefined &&
          subscription !== undefined &&
          subscription.ownerUserId !== account.userId
        )
          return yield* denied("Only the subscription owner can change this provider account.");
      },
      Effect.mapError(() =>
        denied("Only the subscription owner can change this provider account."),
      ),
    );
    const mutate = Effect.fn("ProviderSubscriptions.mutate")(function* (
      mutation: ProviderSubscriptionMutation,
    ) {
      const account = yield* RequestAccount;
      if (!account?.userId)
        return yield* denied("Sign in to T3 Connect to manage your subscription.");
      const instance = yield* registry.getInstance(mutation.instanceId);
      if (instance === undefined)
        return yield* denied("This provider account is no longer available.");
      const current = (yield* settings.getSettings).providerSubscriptions[mutation.instanceId];
      if (current !== undefined && current.ownerUserId !== account.userId)
        return yield* denied("Only the subscription owner can change sharing.");
      if (mutation.action !== "claim" && current === undefined)
        return yield* denied("Claim this subscription before sharing it.");
      let sharedUntil: string | null = null;
      if (mutation.action === "share") {
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const snapshot = yield* instance.snapshot.getSnapshot;
        sharedUntil = nextWeeklySubscriptionReset(snapshot, now) ?? mutation.expiresAt ?? null;
        if (
          sharedUntil === null ||
          !Number.isFinite(Date.parse(sharedUntil)) ||
          Date.parse(sharedUntil) <= now
        )
          return yield* denied("The weekly reset is unavailable. Choose a future sharing expiry.");
      }
      return yield* settings.setProviderSubscription(
        mutation.instanceId,
        {
          ownerUserId: account.userId,
          sharedUntil: mutation.action === "claim" ? (current?.sharedUntil ?? null) : sharedUntil,
        },
        current?.ownerUserId ?? null,
      );
    });
    return ProviderSubscriptions.of({
      authenticate,
      assertManage,
      revokeForAuthentication: Effect.fn("ProviderSubscriptions.revokeForAuthentication")(
        function* (instanceId) {
          yield* assertManage(instanceId);
          const subscription = (yield* settings.getSettings).providerSubscriptions[instanceId];
          const account = yield* RequestAccount;
          if (subscription === undefined && account?.userId) {
            if ((yield* registry.getInstance(instanceId)) === undefined)
              return yield* denied("This provider account is no longer available.");
            yield* settings.setProviderSubscription(
              instanceId,
              { ownerUserId: account.userId, sharedUntil: null },
              null,
            );
            return;
          }
          if (subscription?.sharedUntil !== null && subscription !== undefined)
            yield* settings.setProviderSubscription(instanceId, {
              ...subscription,
              sharedUntil: null,
            });
        },
        writes.withPermits(1),
        Effect.mapError(() => denied("Could not revoke sharing before changing sign-in.")),
      ),
      updateSettings: Effect.fn("ProviderSubscriptions.updateSettings")(function* (input) {
        if (input.providerSubscriptionMutation !== undefined) {
          if (
            input.providerInstanceMutation !== undefined ||
            Object.values(input.patch).some((value) => value !== undefined)
          )
            return yield* denied(
              "Change subscription sharing separately from provider configuration.",
            );
          return yield* mutate(input.providerSubscriptionMutation);
        }
        const ids = new Set<ProviderInstanceId>(
          Object.keys(input.patch.providerInstances ?? {}) as ProviderInstanceId[],
        );
        if (input.providerInstanceMutation) ids.add(input.providerInstanceMutation.instanceId);
        if (input.patch.providerInstances !== undefined)
          for (const id of Object.keys((yield* settings.getSettings).providerInstances))
            ids.add(id as ProviderInstanceId);
        const before = yield* settings.getSettings;
        for (const id of ids) {
          yield* assertManage(id);
          const oldInstance = before.providerInstances[id];
          const nextInstance =
            input.providerInstanceMutation?.instanceId === id
              ? input.providerInstanceMutation.operation === "remove"
                ? undefined
                : input.providerInstanceMutation.instance
              : input.patch.providerInstances?.[id];
          const credentialsChanged =
            oldInstance === undefined ||
            nextInstance === undefined ||
            oldInstance.driver !== nextInstance.driver ||
            !Equal.equals(oldInstance.config, nextInstance.config) ||
            !Equal.equals(oldInstance.environment, nextInstance.environment);
          const subscription = before.providerSubscriptions[id];
          if (credentialsChanged && subscription?.sharedUntil != null)
            yield* settings.setProviderSubscription(id, { ...subscription, sharedUntil: null });
        }
        const result = yield* input.providerInstanceMutation === undefined
          ? settings.updateSettings(input.patch)
          : settings.updateProviderInstance(input.providerInstanceMutation, input.patch);
        const account = yield* RequestAccount;
        const mutation = input.providerInstanceMutation;
        if (mutation !== undefined && mutation.operation === "remove")
          return yield* settings.setProviderSubscription(mutation.instanceId, null);
        if (
          mutation !== undefined &&
          account?.userId &&
          result.providerSubscriptions[mutation.instanceId] === undefined
        )
          return yield* settings.setProviderSubscription(
            mutation.instanceId,
            {
              ownerUserId: account.userId,
              sharedUntil: null,
            },
            null,
          );
        return result;
      }, writes.withPermits(1)),
    });
  }),
);
