import { expect, it } from "vite-plus/test";
import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import {
  cancelCloudflareAccessLogin,
  completeCloudflareAccessLogin,
  getCloudflareAccessLogin,
  requestCloudflareAccessLogin,
  subscribeCloudflareAccessLogin,
} from "./loginBridge";

it("shares one login per origin, queues other origins, and ignores stale completions", async () => {
  const unsubscribe = subscribeCloudflareAccessLogin(() => {});
  const session = new CloudflareAccessSession({ cfAuthorization: "session" });
  const request = { origin: "https://first.test", startUrl: "https://first.test" };
  const second = { origin: "https://second.test", startUrl: "https://second.test" };
  try {
    const one = requestCloudflareAccessLogin(request);
    const same = requestCloudflareAccessLogin(request);
    const two = requestCloudflareAccessLogin(second);
    expect(same).toBe(one);
    const firstTicket = getCloudflareAccessLogin();
    if (firstTicket === null) throw new Error("Expected first login");
    expect(firstTicket.request.origin).toBe(request.origin);
    completeCloudflareAccessLogin(firstTicket, session);
    const secondTicket = getCloudflareAccessLogin();
    if (secondTicket === null) throw new Error("Expected second login");
    expect(secondTicket.request.origin).toBe(second.origin);
    completeCloudflareAccessLogin(secondTicket, session);
    expect(await Promise.all([one, same, two])).toEqual([session, session, session]);
    const rejected = requestCloudflareAccessLogin(request).catch((error: unknown) => error);
    const next = requestCloudflareAccessLogin(second);
    const oldTicket = getCloudflareAccessLogin();
    if (oldTicket === null) throw new Error("Expected pending login");
    cancelCloudflareAccessLogin(oldTicket);
    completeCloudflareAccessLogin(
      oldTicket,
      new CloudflareAccessSession({ cfAuthorization: "wrong-origin" }),
    );
    const current = getCloudflareAccessLogin();
    if (current === null) throw new Error("Expected queued login");
    expect(current.request.origin).toBe(second.origin);
    completeCloudflareAccessLogin(current, session);
    expect(await rejected).toBeInstanceOf(Error);
    expect(await next).toBe(session);
    const interrupted = requestCloudflareAccessLogin(request).catch((error: unknown) => error);
    unsubscribe();
    expect(await interrupted).toBeInstanceOf(Error);
    expect(getCloudflareAccessLogin()).toBeNull();
  } finally {
    unsubscribe();
  }
});
