import { cloudflareAccessRequestHeaders } from "@t3tools/client-runtime/cloudflare-access";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import { peekCloudflareAccessSession } from "./sessionCache";

export const layer = Layer.succeed(Socket.WebSocketConstructor, (url, options) => {
  const nativeOptions =
    typeof options === "string" || Array.isArray(options) ? { protocols: options } : options;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(nativeOptions?.headers ?? {}))
    headers[name.toLowerCase()] = value;
  let origin: string | undefined;
  try {
    const target = new URL(url);
    if (target.protocol === "wss:") target.protocol = "https:";
    else if (target.protocol === "ws:") target.protocol = "http:";
    origin = target.origin;
  } catch {
    origin = undefined;
  }
  const session = origin === undefined ? undefined : peekCloudflareAccessSession(origin);
  if (session !== undefined) {
    for (const [name, value] of Object.entries(cloudflareAccessRequestHeaders(session))) {
      const key = name.toLowerCase();
      headers[key] = key === "cookie" && headers[key] ? `${headers[key]}; ${value}` : value;
    }
  }
  // React Native accepts handshake headers in its third constructor argument.
  const NativeWebSocket: new (
    url: string,
    protocols?: string | string[],
    options?: { headers: Record<string, string> },
  ) => Socket.WebSocketLike = WebSocket;
  return new NativeWebSocket(url, nativeOptions?.protocols, { headers });
});
