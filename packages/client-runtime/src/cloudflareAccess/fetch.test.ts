import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ClientCapabilities from "../platform/capabilities.ts";
import { CloudflareAccessSession } from "./credentials.ts";
import { fetchWithCloudflareAccess } from "./fetch.ts";

const session = new CloudflareAccessSession({ cfAuthorization: "token-value" });
describe("Cloudflare Access fetch", () => {
  it.effect("passes through without a challenge or saved session", () =>
    Effect.gen(function* () {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
      const gateway = ClientCapabilities.CloudflareAccessGateway.of({
        read: () => Effect.succeedNone,
        persist: () => Effect.void,
        clear: () => Effect.void,
        authenticate: () => Effect.die("Unexpected login"),
      });
      yield* fetchWithCloudflareAccess(
        (input, init) => {
          calls.push({ url: String(input), init });
          return Promise.resolve(Response.json({ ok: true }));
        },
        gateway,
        "https://t3.example.test/.well-known/t3/environment",
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init?.headers).toBeUndefined();
    }),
  );
  it.effect("attaches the saved session without losing T3 cookies or DPoP headers", () =>
    Effect.gen(function* () {
      const gateway = ClientCapabilities.CloudflareAccessGateway.of({
        read: () => Effect.succeedSome(session),
        persist: () => Effect.void,
        clear: () => Effect.void,
        authenticate: () => Effect.die("Unexpected login"),
      });
      let headers = new Headers();
      yield* fetchWithCloudflareAccess(
        (_input, init) => {
          headers = new Headers(init?.headers);
          return Promise.resolve(Response.json({ environmentId: "env" }));
        },
        gateway,
        new Request("https://t3.example.test/.well-known/t3/environment", {
          headers: { authorization: "DPoP signed-token", cookie: "t3=session" },
        }),
        { headers: { dpop: "signed-proof" } },
      );
      expect(headers.get("cookie")).toContain("CF_Authorization=token-value");
      expect(headers.get("cookie")).toContain("t3=session");
      expect(headers.get("authorization")).toBe("DPoP signed-token");
      expect(headers.get("dpop")).toBe("signed-proof");
    }),
  );
  it.effect("re-authenticates after a challenge and replays the request body", () =>
    Effect.gen(function* () {
      let authenticated = false;
      let hasSession = false;
      const gateway = ClientCapabilities.CloudflareAccessGateway.of({
        read: () => Effect.succeed(hasSession ? Option.some(session) : Option.none()),
        persist: () => Effect.void,
        clear: () =>
          Effect.sync(() => {
            hasSession = false;
          }),
        authenticate: () =>
          Effect.sync(() => {
            authenticated = true;
            hasSession = true;
            return session;
          }),
      });
      const bodies: string[] = [];
      const response = yield* fetchWithCloudflareAccess(
        async (input, init) => {
          bodies.push(await new Request(input, init).text());
          if (new Headers(init?.headers).get("cookie")?.includes("CF_Authorization"))
            return Response.json({ environmentId: "env" });
          return new Response(null, {
            status: 302,
            headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" },
          });
        },
        gateway,
        new Request("https://t3.example.test/.well-known/t3/environment", {
          method: "POST",
          body: "request-body",
          headers: { "content-type": "text/plain" },
        }),
      );
      expect(authenticated).toBe(true);
      expect(bodies).toEqual(["request-body", "request-body"]);
      expect((yield* Effect.promise(() => response.json())).environmentId).toBe("env");
    }),
  );
});
