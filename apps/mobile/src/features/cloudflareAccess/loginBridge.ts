import type { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";

export interface CloudflareAccessLoginRequest {
  readonly origin: string;
  readonly startUrl: string;
}
export interface CloudflareAccessLoginTicket {
  readonly request: CloudflareAccessLoginRequest;
}
interface PendingLogin extends CloudflareAccessLoginTicket {
  readonly resolve: (session: CloudflareAccessSession) => void;
  readonly reject: (error: Error) => void;
}
const listeners = new Set<() => void>();
const queue: PendingLogin[] = [];
const pendingByOrigin = new Map<string, Promise<CloudflareAccessSession>>();
let active: PendingLogin | null = null;
const notify = () => {
  for (const listener of listeners) listener();
};
const advance = () => {
  active = queue.shift() ?? null;
  notify();
};

export const getCloudflareAccessLogin = (): CloudflareAccessLoginTicket | null => active;
export function subscribeCloudflareAccessLogin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    const error = new Error("Cloudflare Access sign-in was interrupted.");
    active?.reject(error);
    for (const pending of queue.splice(0)) pending.reject(error);
    active = null;
    pendingByOrigin.clear();
  };
}
export function completeCloudflareAccessLogin(
  ticket: CloudflareAccessLoginTicket,
  session: CloudflareAccessSession,
): void {
  if (active !== ticket) return;
  pendingByOrigin.delete(active.request.origin);
  active.resolve(session);
  advance();
}
export function cancelCloudflareAccessLogin(ticket: CloudflareAccessLoginTicket): void {
  if (active !== ticket) return;
  pendingByOrigin.delete(active.request.origin);
  active.reject(new Error("Cloudflare Access sign-in was cancelled."));
  advance();
}
export function requestCloudflareAccessLogin(
  request: CloudflareAccessLoginRequest,
): Promise<CloudflareAccessSession> {
  const existing = pendingByOrigin.get(request.origin);
  if (existing !== undefined) return existing;
  if (listeners.size === 0)
    return Promise.reject(new Error("Cloudflare Access login is not available."));
  const pending = new Promise<CloudflareAccessSession>((resolve, reject) => {
    const entry = { request: { ...request }, resolve, reject };
    if (active === null) {
      active = entry;
      notify();
    } else queue.push(entry);
  });
  pendingByOrigin.set(request.origin, pending);
  const forget = () => {
    if (pendingByOrigin.get(request.origin) === pending) pendingByOrigin.delete(request.origin);
  };
  void pending.then(forget, forget);
  return pending;
}
