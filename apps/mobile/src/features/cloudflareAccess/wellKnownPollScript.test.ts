import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";

import { wellKnownPollScript } from "./wellKnownPollScript";

it("posts a serialized bridge message after the credentialed environment probe succeeds", async () => {
  const posted = Promise.withResolvers<unknown>();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  NodeVM.runInNewContext(wellKnownPollScript("https://t3.example.test"), {
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ environmentId: "environment" }) };
    },
    window: { ReactNativeWebView: { postMessage: (value: unknown) => posted.resolve(value) } },
    setTimeout: () => {
      throw new Error("Unexpected retry after a successful probe");
    },
  });
  expect(await posted.promise).toBe(JSON.stringify({ type: "t3-environment-ready" }));
  expect(requests[0]?.url).toBe("https://t3.example.test/.well-known/t3/environment");
  expect(requests[0]?.init.credentials).toBe("include");
});
