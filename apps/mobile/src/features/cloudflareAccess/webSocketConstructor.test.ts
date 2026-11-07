import { expect, it, vi } from "@effect/vitest";
import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import * as Effect from "effect/Effect";
import * as Socket from "effect/socket/Socket";

import { rememberCloudflareAccessSession } from "./sessionCache";
import { layer } from "./webSocketConstructor";

it.effect("carries the HTTPS login and T3 cookie into a native WSS handshake", () =>
  Effect.gen(function* () {
    const calls: Array<{
      url: string;
      protocols?: string | string[];
      options?: { headers?: Record<string, string> };
    }> = [];
    function NativeSocket(
      url: string,
      protocols?: string | string[],
      options?: { headers?: Record<string, string> },
    ) {
      calls.push({ url, protocols, options });
    }
    vi.stubGlobal("WebSocket", NativeSocket);
    rememberCloudflareAccessSession(
      "https://t3.example.test",
      new CloudflareAccessSession({ cfAuthorization: "access-token" }),
    );
    try {
      yield* Effect.gen(function* () {
        const construct = yield* Socket.WebSocketConstructor;
        construct("wss://t3.example.test/ws", {
          protocols: ["t3"],
          headers: { Cookie: "t3=session" },
        });
        expect(calls[0]?.protocols).toEqual(["t3"]);
        expect(calls[0]?.options?.headers?.cookie).toContain("t3=session");
        expect(calls[0]?.options?.headers?.cookie).toContain("CF_Authorization=access-token");
        construct("wss://other.example.test/ws", "t3");
        expect(calls[1]?.protocols).toBe("t3");
        expect(calls[1]?.options?.headers?.cookie).toBeUndefined();
      }).pipe(Effect.provide(layer));
    } finally {
      rememberCloudflareAccessSession("https://t3.example.test", undefined);
      vi.unstubAllGlobals();
    }
  }),
);
