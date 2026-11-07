import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ConnectionBlockedError } from "../connection/model.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";

export const layerNoop = Layer.succeed(
  ClientCapabilities.CloudflareAccessGateway,
  ClientCapabilities.CloudflareAccessGateway.of({
    read: () => Effect.succeedNone,
    persist: () => Effect.void,
    clear: () => Effect.void,
    authenticate: () =>
      Effect.fail(
        new ConnectionBlockedError({
          reason: "unsupported",
          detail: "Cloudflare Access login is not available on this client.",
        }),
      ),
  }),
);
