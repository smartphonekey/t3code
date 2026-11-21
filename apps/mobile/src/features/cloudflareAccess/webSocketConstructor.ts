import { cloudflareAccessRequestHeaders } from "@t3tools/client-runtime/cloudflare-access";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import * as NativeWebSocket from "../../native/nativeWebSocket";
import { peekCloudflareAccessSession } from "./sessionCache";

function cloudflareAccessSessionFor(url: string) {
  try {
    const target = new URL(url);
    if (target.protocol === "wss:") target.protocol = "https:";
    else if (target.protocol === "ws:") target.protocol = "http:";
    return peekCloudflareAccessSession(target.origin);
  } catch {
    return undefined;
  }
}

// The native socket cannot send handshake headers, so only Access-protected origins use React
// Native's socket; every other origin keeps the native one.
export const layer = Layer.effect(
  Socket.WebSocketConstructor,
  Effect.gen(function* () {
    const native = yield* Socket.WebSocketConstructor;
    return (url: string, options?: Socket.WebSocketConstructorOptions) => {
      const session = cloudflareAccessSessionFor(url);
      if (session === undefined) return native(url, options);
      const nativeOptions =
        typeof options === "string" || Array.isArray(options) ? { protocols: options } : options;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(nativeOptions?.headers ?? {}))
        headers[name.toLowerCase()] = value;
      for (const [name, value] of Object.entries(cloudflareAccessRequestHeaders(session))) {
        const key = name.toLowerCase();
        headers[key] = key === "cookie" && headers[key] ? `${headers[key]}; ${value}` : value;
      }
      // React Native accepts handshake headers in its third constructor argument.
      const ReactNativeWebSocket: new (
        url: string,
        protocols?: string | string[],
        options?: { headers: Record<string, string> },
      ) => Socket.WebSocketLike = WebSocket;
      return new ReactNativeWebSocket(url, nativeOptions?.protocols, { headers });
    };
  }),
).pipe(Layer.provide(NativeWebSocket.layer));
