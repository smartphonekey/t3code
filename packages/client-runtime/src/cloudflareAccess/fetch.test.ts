import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ClientCapabilities from "../platform/capabilities.ts";
import { CloudflareAccessSession } from "./credentials.ts";
import { makeCloudflareAccessAwareFetch } from "./fetch.ts";

const session = new CloudflareAccessSession({
  cfAuthorization: "token-value",
});

describe("makeCloudflareAccessAwareFetch", () => {
  it("passes through when no challenge and no saved session", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = ClientCapabilities.CloudflareAccessGateway.of({
      read: () => Effect.succeedNone,
      persist: () => Effect.void,
      clear: () => Effect.void,
      authenticate: () => Effect.die("unexpected"),
    });
    const fetchFn = makeCloudflareAccessAwareFetch(
      (input, init) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(Response.json({ ok: true }));
      },
      (effect) => Effect.runPromise(effect),
      gateway,
    );

    await fetchFn("https://t3.example.test/.well-known/t3/environment");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.headers).toBeUndefined();
  });

  it("attaches saved session headers", async () => {
    const gateway = ClientCapabilities.CloudflareAccessGateway.of({
      read: () => Effect.succeed(Option.some(session)),
      persist: () => Effect.void,
      clear: () => Effect.void,
      authenticate: () => Effect.die("unexpected"),
    });
    let headers: Headers | undefined;
    const fetchFn = makeCloudflareAccessAwareFetch(
      (_input, init) => {
        headers = new Headers(init?.headers);
        return Promise.resolve(Response.json({ environmentId: "env" }));
      },
      (effect) => Effect.runPromise(effect),
      gateway,
    );

    await fetchFn("https://t3.example.test/.well-known/t3/environment");
    expect(headers?.get("cookie")).toContain("CF_Authorization=token-value");
  });

  it("re-authenticates after a challenge", async () => {
    let authenticated = false;
    let hasSession = false;
    const gateway = ClientCapabilities.CloudflareAccessGateway.of({
      read: () => Effect.succeed(hasSession ? Option.some(session) : Option.none()),
      persist: (_origin, value) =>
        Effect.sync(() => {
          hasSession = true;
          return value;
        }).pipe(Effect.asVoid),
      clear: () =>
        Effect.sync(() => {
          hasSession = false;
        }),
      authenticate: () => {
        authenticated = true;
        hasSession = true;
        return Effect.succeed(session);
      },
    });
    let calls = 0;
    const fetchFn = makeCloudflareAccessAwareFetch(
      (_input, init) => {
        calls += 1;
        const cookie = new Headers(init?.headers).get("cookie");
        if (cookie?.includes("CF_Authorization")) {
          return Promise.resolve(Response.json({ environmentId: "env" }));
        }
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" },
          }),
        );
      },
      (effect) => Effect.runPromise(effect),
      gateway,
    );

    const response = await fetchFn("https://t3.example.test/.well-known/t3/environment");
    expect(authenticated).toBe(true);
    expect(calls).toBe(2);
    expect((await response.json()).environmentId).toBe("env");
  });
});
