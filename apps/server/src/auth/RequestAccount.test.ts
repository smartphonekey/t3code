import { expect, it } from "@effect/vitest";
import {
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";

import * as RequestAccount from "./RequestAccount.ts";
import * as RpcAuthorization from "./RpcAuthorization.ts";

const denied = (message: string) =>
  new EnvironmentAuthorizationError({ message, requiredScope: AuthProvidersManageScope });

it.effect.each([undefined, "cf-access:alice"])(
  "binds verified request identities with owner %s, rejects invalid account proofs and runs the guard as the caller",
  (ownerUserId) =>
    Effect.gen(function* () {
      const group = WsRpcGroup.omit(
        ...[...WsRpcGroup.requests.keys()].filter(
          (
            tag,
          ): tag is Exclude<
            keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES,
            typeof WS_METHODS.serverUpdateSettings
          > => tag !== WS_METHODS.serverUpdateSettings,
        ),
      );
      const guarded: Array<string> = [];
      const client = yield* RpcTest.makeClient(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayerHandler(WS_METHODS.serverUpdateSettings, () =>
              Effect.map(RequestAccount.RequestAccount, (account) => ({
                ...DEFAULT_SERVER_SETTINGS,
                branchNamePrefix: account?.ownerUserId ?? account?.userId ?? "anonymous",
              })),
            ),
            RpcAuthorization.layer([AuthSettingsWriteScope, AuthProvidersManageScope]).pipe(
              RequestAccount.bindRpc(
                {
                  authenticate: (token) =>
                    token === "signed-alice"
                      ? Effect.succeed("alice")
                      : Effect.fail(denied("Invalid account proof")),
                  guardRpc: (method, payload) =>
                    Effect.flatMap(RequestAccount.RequestAccount, (account) => {
                      guarded.push(`${method}:${account?.userId ?? "anonymous"}`);
                      return JSON.stringify(payload).includes("blocked")
                        ? Effect.fail(denied("Guard refused"))
                        : Effect.void;
                    }),
                },
                ownerUserId,
              ),
            ),
          ),
        ),
      );
      expect((yield* client[WS_METHODS.serverUpdateSettings]({ patch: {} })).branchNamePrefix).toBe(
        ownerUserId ?? "anonymous",
      );
      expect(
        (yield* client[WS_METHODS.serverUpdateSettings](
          { patch: {} },
          { headers: { "x-t3-account-token": "signed-alice" } },
        )).branchNamePrefix,
      ).toBe(ownerUserId ?? "alice");
      expect(
        (yield* client[WS_METHODS.serverUpdateSettings](
          { patch: {} },
          { headers: { "x-t3-account-token": "forged-bob" } },
        ).pipe(Effect.flip))._tag,
      ).toBe("EnvironmentAuthorizationError");
      expect(
        (yield* client[WS_METHODS.serverUpdateSettings]({
          patch: { branchNamePrefix: "blocked" },
        }).pipe(Effect.flip)).message,
      ).toBe("Guard refused");
      expect(guarded).toEqual([
        `${WS_METHODS.serverUpdateSettings}:anonymous`,
        `${WS_METHODS.serverUpdateSettings}:alice`,
        `${WS_METHODS.serverUpdateSettings}:anonymous`,
      ]);
    }).pipe(Effect.scoped),
);
