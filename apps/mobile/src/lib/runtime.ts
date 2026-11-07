import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { HttpClient } from "effect/http";

import { makeCloudflareAccessAwareFetch } from "@t3tools/client-runtime/cloudflare-access";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { ClientCapabilities } from "@t3tools/client-runtime/platform";

import * as Dpop from "../features/cloud/dpop";
import * as CloudflareAccessGatewayLayer from "../features/cloudflareAccess/gateway";
import * as CloudflareAccessWebSocket from "../features/cloudflareAccess/webSocketConstructor";
import * as ManagedRelayLayer from "../features/cloud/managedRelayLayer";
import { resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import * as Tracing from "../features/observability/tracing";
import * as Persistence from "../persistence/layer";
import { disposeOnFoundationReplace, type FoundationHotModule } from "./foundation-fast-refresh";
import { whenProtectedDataAvailable } from "./protectedData";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

function configuredRelayUrl(): string {
  return resolveCloudPublicConfig().relay.url ?? "http://relay.invalid";
}

let runtimeRef: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> | null = null;

const layerHttpClient: Layer.Layer<
  HttpClient.HttpClient,
  never,
  ClientCapabilities.CloudflareAccessGateway
> = Layer.unwrap(
  Effect.gen(function* () {
    const gateway = yield* ClientCapabilities.CloudflareAccessGateway;
    const accessFetch = makeCloudflareAccessAwareFetch(
      fetch,
      (effect) => {
        if (runtimeRef === null) {
          throw new Error("The mobile runtime is not ready.");
        }
        return runtimeRef.runPromise(effect);
      },
      gateway,
    );
    return layerRemoteHttpClient(accessFetch);
  }),
);

type RuntimeLayerSource =
  | ReturnType<typeof ManagedRelayLayer.layer>
  | typeof Dpop.layer
  | typeof layerHttpClient
  | typeof Persistence.layer
  | typeof Tracing.layer
  | typeof CloudflareAccessGatewayLayer.layer
  | typeof CloudflareAccessWebSocket.layer;

const layerProvidedHttpClient = layerHttpClient.pipe(
  Layer.provide(CloudflareAccessGatewayLayer.layer),
);

const layerRuntime = Layer.merge(
  ManagedRelayLayer.layer(configuredRelayUrl()),
  CloudflareAccessWebSocket.layer,
).pipe(
  Layer.provideMerge(CloudflareAccessGatewayLayer.layer),
  Layer.provideMerge(Dpop.layer),
  Layer.provideMerge(layerProvidedHttpClient),
  Layer.provideMerge(Tracing.layer.pipe(Layer.provide(layerProvidedHttpClient))),
  Layer.provideMerge(Persistence.layer),
  Layer.provide(Layer.effectDiscard(Effect.promise(whenProtectedDataAvailable))),
);

export const runtime: ManagedRuntime.ManagedRuntime<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = ManagedRuntime.make(layerRuntime);
runtimeRef = runtime;

export const layer: Layer.Layer<
  Layer.Success<RuntimeLayerSource>,
  Layer.Error<RuntimeLayerSource>
> = Layer.effectContext(runtime.contextEffect);

disposeOnFoundationReplace(typeof module === "undefined" ? undefined : module.hot, () =>
  runtime.dispose(),
);
