import type { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";

export interface CloudflareAccessLoginRequest {
  readonly origin: string;
  readonly startUrl: string;
}

export type CloudflareAccessLoginHandler = (
  request: CloudflareAccessLoginRequest,
) => Promise<CloudflareAccessSession>;

let handler: CloudflareAccessLoginHandler | null = null;

export function setCloudflareAccessLoginHandler(next: CloudflareAccessLoginHandler | null): void {
  handler = next;
}

export function requestCloudflareAccessLogin(
  request: CloudflareAccessLoginRequest,
): Promise<CloudflareAccessSession> {
  if (handler === null) {
    return Promise.reject(new Error("Cloudflare Access login is not available."));
  }
  return handler(request);
}
