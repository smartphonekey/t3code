import type { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";

const sessionsByOrigin = new Map<string, CloudflareAccessSession>();

export function peekCloudflareAccessSession(origin: string): CloudflareAccessSession | undefined {
  return sessionsByOrigin.get(origin);
}

export function rememberCloudflareAccessSession(
  origin: string,
  session: CloudflareAccessSession | undefined,
): void {
  if (session === undefined) {
    sessionsByOrigin.delete(origin);
    return;
  }
  sessionsByOrigin.set(origin, session);
}
