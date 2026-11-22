import { type EnvironmentAuthorizationError, RpcScopeAuthorization } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class RequestAccount extends Context.Reference<
  { readonly userId: string | null; readonly ownerUserId?: string } | undefined
>("t3/auth/RequestAccount", { defaultValue: () => undefined }) {}

/**
 * Wraps the scope check so every RPC that passes it runs as the caller's account. An RPC route
 * that skips this has no account and no provider subscription guard, so pipe every
 * `RpcAuthorization.layer` through it.
 */
export const bindRpc =
  (
    account: {
      readonly authenticate: (
        token: string,
      ) => Effect.Effect<string, EnvironmentAuthorizationError>;
      readonly guardRpc: (
        method: string,
        payload: unknown,
      ) => Effect.Effect<void, EnvironmentAuthorizationError>;
    },
    ownerUserId?: string,
  ) =>
  (authorization: Layer.Layer<RpcScopeAuthorization>) =>
    Layer.effect(
      RpcScopeAuthorization,
      Effect.gen(function* () {
        const authorize = yield* RpcScopeAuthorization;
        return RpcScopeAuthorization.of((effect, options) =>
          authorize(
            Effect.gen(function* () {
              const token = options.headers["x-t3-account-token"];
              const userId = token === undefined ? null : yield* account.authenticate(token);
              return yield* account.guardRpc(options.rpc._tag, options.payload).pipe(
                Effect.andThen(effect),
                Effect.provideService(RequestAccount, {
                  userId,
                  ...(ownerUserId === undefined ? {} : { ownerUserId }),
                }),
              );
            }),
            options,
          ),
        );
      }),
    ).pipe(Layer.provide(authorization));
