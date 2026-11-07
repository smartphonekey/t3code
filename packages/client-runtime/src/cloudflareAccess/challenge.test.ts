import { describe, expect, it } from "@effect/vitest";

import {
  cloudflareAccessLoginStartUrl,
  isCloudflareAccessChallengeResponse,
  isCloudflareAccessLoginUrl,
} from "./challenge.ts";

describe("cloudflareAccess challenge", () => {
  it("detects cloudflareaccess.com login URLs", () => {
    expect(
      isCloudflareAccessLoginUrl("https://team.cloudflareaccess.com/cdn-cgi/access/login"),
    ).toBe(true);
    expect(isCloudflareAccessLoginUrl("https://t3code.example.test/pair")).toBe(false);
  });

  it("detects 401 challenges", () => {
    const response = new Response(null, { status: 401 });
    expect(isCloudflareAccessChallengeResponse(response, "https://t3.example.test/foo")).toBe(true);
  });

  it("detects redirect challenges", () => {
    const response = new Response(null, {
      status: 302,
      headers: { location: "https://acme.cloudflareaccess.com/cdn-cgi/access/login" },
    });
    expect(isCloudflareAccessChallengeResponse(response, "https://t3.example.test/foo")).toBe(true);
    expect(cloudflareAccessLoginStartUrl(response, "https://t3.example.test/foo")).toBe(
      "https://acme.cloudflareaccess.com/cdn-cgi/access/login",
    );
  });

  it("detects HTML responses to well-known", () => {
    const response = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    expect(
      isCloudflareAccessChallengeResponse(
        response,
        "https://t3.example.test/.well-known/t3/environment",
      ),
    ).toBe(true);
    expect(
      isCloudflareAccessChallengeResponse(response, "https://t3.example.test/oauth/token"),
    ).toBe(false);
  });
});
