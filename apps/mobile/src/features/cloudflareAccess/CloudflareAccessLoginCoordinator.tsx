import { useSyncExternalStore } from "react";
import { CloudflareAccessLoginSheet } from "./CloudflareAccessLoginSheet";
import {
  cancelCloudflareAccessLogin,
  completeCloudflareAccessLogin,
  getCloudflareAccessLogin,
  subscribeCloudflareAccessLogin,
} from "./loginBridge";

export function CloudflareAccessLoginCoordinator() {
  const pending = useSyncExternalStore(
    subscribeCloudflareAccessLogin,
    getCloudflareAccessLogin,
    getCloudflareAccessLogin,
  );
  return (
    <CloudflareAccessLoginSheet
      request={pending?.request ?? null}
      onComplete={(session) => {
        if (pending !== null) completeCloudflareAccessLogin(pending, session);
      }}
      onCancel={() => {
        if (pending !== null) cancelCloudflareAccessLogin(pending);
      }}
    />
  );
}
