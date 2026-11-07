import type { CloudflareAccessSession } from "./credentials.ts";

export function cloudflareAccessRequestHeaders(
  session: CloudflareAccessSession,
): Readonly<Record<string, string>> {
  const cookieParts = [`CF_Authorization=${session.cfAuthorization}`];
  if (session.cfAccessJwtAssertion !== undefined) {
    cookieParts.push(`Cf-Access-Jwt-Assertion=${session.cfAccessJwtAssertion}`);
  }
  return {
    Cookie: cookieParts.join("; "),
    ...(session.cfAccessJwtAssertion !== undefined
      ? { "cf-access-jwt-assertion": session.cfAccessJwtAssertion }
      : {}),
  };
}
