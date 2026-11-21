import { describe, expect, it } from "@effect/vitest";

import { CloudflareAccessSession } from "./credentials.ts";
import { cloudflareAccessRequestHeaders } from "./headers.ts";

describe("cloudflareAccessRequestHeaders", () => {
  it("builds cookie and jwt assertion headers", () => {
    const headers = cloudflareAccessRequestHeaders(
      new CloudflareAccessSession({
        cfAuthorization: "abc",
        cfAccessJwtAssertion: "jwt",
      }),
    );
    expect(headers.Cookie).toBe("CF_Authorization=abc; Cf-Access-Jwt-Assertion=jwt");
    expect(headers["cf-access-jwt-assertion"]).toBe("jwt");
  });
});
