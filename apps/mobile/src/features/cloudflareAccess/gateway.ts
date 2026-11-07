import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { ClientCapabilities } from "@t3tools/client-runtime/platform";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as MobileSecureStorage from "../../persistence/mobile-secure-storage";
import { requestCloudflareAccessLogin } from "./loginBridge";
import {
  clearCloudflareAccessSessionStorage,
  loadCloudflareAccessSession,
  saveCloudflareAccessSession,
} from "./storage";
import { rememberCloudflareAccessSession } from "./sessionCache";

const storageFailure = (cause: unknown) =>
  new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: cause instanceof Error ? cause.message : "Cloudflare Access storage failed.",
  });

export const layer = Layer.effect(
  ClientCapabilities.CloudflareAccessGateway,
  Effect.gen(function* () {
    const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
    const withStorage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(MobileSecureStorage.MobileSecureStorage, secureStorage),
        Effect.mapError((cause) => storageFailure(cause)),
      );

    const read = Effect.fn("mobile.cloudflareAccessGateway.read")((origin: string) =>
      withStorage(
        loadCloudflareAccessSession(origin).pipe(
          Effect.tap((session) =>
            Effect.sync(() => {
              if (Option.isSome(session)) {
                rememberCloudflareAccessSession(origin, session.value);
              }
            }),
          ),
        ),
      ),
    );

    const persist = Effect.fn("mobile.cloudflareAccessGateway.persist")(
      (origin: string, session: CloudflareAccessSession) =>
        withStorage(
          saveCloudflareAccessSession(origin, session).pipe(
            Effect.tap(() => Effect.sync(() => rememberCloudflareAccessSession(origin, session))),
          ),
        ),
    );

    const clear = Effect.fn("mobile.cloudflareAccessGateway.clear")((origin: string) =>
      withStorage(
        clearCloudflareAccessSessionStorage(origin).pipe(
          Effect.tap(() => Effect.sync(() => rememberCloudflareAccessSession(origin, undefined))),
        ),
      ),
    );

    const authenticate = Effect.fn("mobile.cloudflareAccessGateway.authenticate")(
      function* (input: { readonly origin: string; readonly startUrl: string }) {
        const session = yield* Effect.tryPromise({
          try: () => requestCloudflareAccessLogin(input),
          catch: (cause) =>
            new ConnectionBlockedError({
              reason: "authentication",
              detail: cause instanceof Error ? cause.message : "Cloudflare Access sign-in failed.",
            }),
        });
        yield* withStorage(saveCloudflareAccessSession(input.origin, session));
        rememberCloudflareAccessSession(input.origin, session);
        return session;
      },
    );

    return ClientCapabilities.CloudflareAccessGateway.of({
      read,
      persist,
      clear,
      authenticate,
    });
  }),
).pipe(Layer.provide(MobileSecureStorage.layer));
