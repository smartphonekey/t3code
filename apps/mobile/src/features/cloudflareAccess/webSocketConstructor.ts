import { cloudflareAccessRequestHeaders } from "@t3tools/client-runtime/cloudflare-access";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";

import { peekCloudflareAccessSession } from "./sessionCache";

function withAccessHeaders(
  options: Socket.WebSocketConstructorOptions | undefined,
  headerRecord: Record<string, string>,
): Socket.WebSocketConstructorOptions {
  if (options === undefined || typeof options === "string" || Array.isArray(options)) {
    return { headers: headerRecord };
  }
  return { ...options, headers: { ...options.headers, ...headerRecord } };
}

export const layer = Layer.effect(
  Socket.WebSocketConstructor,
  Effect.gen(function* () {
    const base = yield* Socket.WebSocketConstructor;
    return (url, options) => {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return base(url, options);
      }
      const session = peekCloudflareAccessSession(origin);
      if (session === undefined) {
        return base(url, options);
      }
      const accessHeaders = cloudflareAccessRequestHeaders(session);
      const headerRecord: Record<string, string> = {};
      if (accessHeaders.Cookie !== undefined) {
        headerRecord.cookie = accessHeaders.Cookie;
      }
      const jwt = accessHeaders["cf-access-jwt-assertion"];
      if (jwt !== undefined) {
        headerRecord["cf-access-jwt-assertion"] = jwt;
      }
      return base(url, withAccessHeaders(options, headerRecord));
    };
  }),
).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
