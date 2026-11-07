import type { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import { useEffect, useRef, useState } from "react";

import { CloudflareAccessLoginSheet } from "./CloudflareAccessLoginSheet";
import { setCloudflareAccessLoginHandler, type CloudflareAccessLoginRequest } from "./loginBridge";

export function CloudflareAccessLoginCoordinator() {
  const [request, setRequest] = useState<CloudflareAccessLoginRequest | null>(null);
  type PendingLogin = {
    readonly resolve: (session: CloudflareAccessSession) => void;
    readonly reject: (error: Error) => void;
  };
  const pending = useRef<PendingLogin | null>(null);

  useEffect(() => {
    setCloudflareAccessLoginHandler((loginRequest) => {
      return new Promise<CloudflareAccessSession>((resolve, reject) => {
        pending.current = { resolve, reject };
        setRequest(loginRequest);
      });
    });
    return () => {
      setCloudflareAccessLoginHandler(null);
      pending.current?.reject(new Error("Cloudflare Access sign-in was interrupted."));
      pending.current = null;
    };
  }, []);

  const settle = (handler: (entry: PendingLogin) => void) => {
    const current = pending.current;
    if (current === null) {
      return;
    }
    pending.current = null;
    setRequest(null);
    handler(current);
  };

  return (
    <CloudflareAccessLoginSheet
      request={request}
      onComplete={(session) => settle((current) => current.resolve(session))}
      onCancel={() =>
        settle((current) => current.reject(new Error("Cloudflare Access sign-in was cancelled.")))
      }
    />
  );
}
